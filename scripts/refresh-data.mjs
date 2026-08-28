import fs from "node:fs/promises";
import path from "node:path";
import { fetchOfficialPatch } from "./sources/official.mjs";
import { fetchDataTFTMetadata } from "./sources/datatft.mjs";
import { fetchDataJComps } from "./sources/dataj.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const HISTORY_DIR = path.join(DATA_DIR, "history");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const STATUS_PATH = path.join(DATA_DIR, "source-status.json");
const COMPS_PATH = path.join(DATA_DIR, "comps.json");
const LIBRARY_PATH = path.join(DATA_DIR, "comp-library.json");

const normalizeName = (value = "") => value.toLowerCase().replace(/[\s·・\-_/]/g, "").replace(/[()（）]/g, "");
const performance = (comp) => comp.top4Rate * 0.65 + comp.winRate * 0.35;
const trendLabel = (delta) => delta >= 2 ? "surging" : delta >= 0.5 ? "up" : delta <= -0.5 ? "down" : "flat";

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

function findEnrichment(name, library) {
  const target = normalizeName(name);
  return library.find((entry) => {
    const names = [entry.name, ...(entry.aliases ?? [])].map(normalizeName);
    return names.includes(target);
  }) ?? null;
}

async function find24hBaseline(patch, rankBand, nowMs) {
  let files = [];
  try { files = await fs.readdir(HISTORY_DIR); } catch { return null; }
  const candidates = [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const snapshot = await readJson(path.join(HISTORY_DIR, file));
    if (!snapshot || snapshot.patch !== patch || snapshot.rankBand !== rankBand || !snapshot.fetchedAt) continue;
    const ageHours = (nowMs - Date.parse(snapshot.fetchedAt)) / 3_600_000;
    if (ageHours >= 12 && ageHours <= 36) candidates.push({ snapshot, distance: Math.abs(ageHours - 24) });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.snapshot ?? null;
}

function mergeMetrics(stats, library, baseline, patch, fetchedAt) {
  const baselineMap = new Map((baseline?.comps ?? []).map((comp) => [normalizeName(comp.name), comp]));
  return stats.map((raw) => {
    const enrichment = findEnrichment(raw.name, library);
    const before = baselineMap.get(normalizeName(raw.name));
    const trend24h = before ? Number((performance(raw) - performance(before)).toFixed(2)) : 0;
    return {
      ...raw,
      patch,
      rankBand: "all",
      trend: trendLabel(trend24h),
      trend24h,
      coreUnits: enrichment?.coreUnits ?? [],
      flexUnits: enrichment?.flexUnits ?? [],
      keyItems: enrichment?.keyItems ?? [],
      itemCarriers: enrichment?.itemCarriers ?? {},
      stagePlan: enrichment?.stagePlan ?? ["该阵容由实时数据新发现，运营与核心牌仍待补全。"],
      dataSource: "dataj",
      fetchedAt,
      needsEnrichment: !enrichment
    };
  });
}

await fs.mkdir(HISTORY_DIR, { recursive: true });
const [official, datatft, dataj] = await Promise.all([
  fetchOfficialPatch(),
  fetchDataTFTMetadata(),
  fetchDataJComps()
]);

const fetchedAt = new Date().toISOString();
const authoritativePatch = official.patch || datatft.patch || dataj.patch || null;
const versionsAgree = Boolean(dataj.ok && authoritativePatch && dataj.patch === authoritativePatch);
const sourceStatus = {
  fetchedAt,
  authoritativePatch,
  liveCompDataAccepted: versionsAgree,
  sources: { official, datatft, dataj },
  rankCoverage: ["all"],
  targetRankCoverage: false,
  note: versionsAgree
    ? "实时阵容统计已通过版本一致性校验。当前 DataJ 适配器提供全段位阵容统计；DataTFT 已验证存在段位筛选，但 V0.2 不猜测其未公开内部 API。"
    : "阵容统计源与当前国服版本不一致或抓取失败，本轮拒绝覆盖排行榜，保留上一份已验证快照。"
};
await fs.writeFile(STATUS_PATH, JSON.stringify(sourceStatus, null, 2) + "\n", "utf8");

if (!versionsAgree) {
  console.warn(`snapshot rejected: authoritative=${authoritativePatch}, dataj=${dataj.patch}, ok=${dataj.ok}`);
  process.exit(0);
}

const library = await readJson(LIBRARY_PATH, []);
const baseline = await find24hBaseline(authoritativePatch, "all", Date.parse(fetchedAt));
const comps = mergeMetrics(dataj.comps, library, baseline, authoritativePatch, fetchedAt);

const snapshot = {
  schemaVersion: 2,
  season: "S18",
  patch: authoritativePatch,
  fetchedAt,
  isLive: true,
  rankBand: "all",
  rankCoverage: ["all"],
  targetRankCoverage: false,
  totalGames: dataj.totalGames,
  sampleSizeMethod: "estimated: totalGames × lobby appearance rate",
  source: "dataj",
  sourceUrl: dataj.url,
  patchAuthority: official.ok ? official.id : datatft.id,
  comps
};

await fs.writeFile(LATEST_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
await fs.writeFile(COMPS_PATH, JSON.stringify(comps, null, 2) + "\n", "utf8");
const historyName = fetchedAt.replace(/[:.]/g, "-") + ".json";
await fs.writeFile(path.join(HISTORY_DIR, historyName), JSON.stringify(snapshot, null, 2) + "\n", "utf8");

console.log(`accepted patch ${authoritativePatch}: ${comps.length} comps, ${dataj.totalGames ?? "?"} games`);
