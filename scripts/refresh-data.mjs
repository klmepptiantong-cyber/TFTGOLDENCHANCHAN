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
const PATCH_LOCK_PATH = path.join(DATA_DIR, "patch-authority.json");
const ENRICHMENT_QUEUE_PATH = path.join(DATA_DIR, "enrichment-queue.json");
const RANK_CAPABILITY_PATH = path.join(DATA_DIR, "rank-capability.json");

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

function verifiedSourceItems(raw) {
  if (!raw.sourceEquipmentNamesComplete) return { keyItems: [], itemCarriers: {}, verified: false };
  const itemCarriers = {};
  const keyItems = [];

  for (const [hero, rawItems] of Object.entries(raw.sourceEquipmentNamesByHero ?? {})) {
    const items = [...new Set((rawItems ?? []).map((item) => String(item).trim()).filter(Boolean))];
    if (!items.length) continue;
    itemCarriers[hero] = items;
    for (const item of items) if (!keyItems.includes(item)) keyItems.push(item);
  }

  return {
    keyItems,
    itemCarriers,
    verified: keyItems.length > 0 && Object.keys(itemCarriers).length > 0
  };
}

function deriveEconomyStagePlan(raw) {
  const carries = (raw.sourceCarries ?? []).filter((carry) => Number.isFinite(Number(carry?.price)));
  const primary = carries.find((carry) => carry.role === "carry") ?? carries[0];
  if (!primary) return { verified: false, plan: [], confidence: "low", evidence: [] };

  const price = Number(primary.price);
  if (!Number.isInteger(price) || price < 1 || price > 5) {
    return { verified: false, plan: [], confidence: "low", evidence: [] };
  }

  const targetStars = Number.isFinite(Number(primary.targetStars)) ? Number(primary.targetStars) : null;
  const targetLevel = Math.min(9, price + 4);
  const evidence = [
    `DataJ carry=${primary.name}`,
    `cost=${price}`,
    `targetStars=${targetStars ?? "unspecified"}`
  ];

  if (targetStars !== null && targetStars >= 3 && price <= 3) {
    return {
      verified: true,
      confidence: "high",
      evidence,
      plan: [
        `${primary.name} 为 ${price} 费主C且源数据目标 ${targetStars} 星：优先在 ${targetLevel} 人口作为主要搜牌层，先完成主C追三，再继续升人口。`,
        `追三阶段以保经济和补核心两星为主；主C达标后再升人口，按实时阵容表补齐高费功能牌与前排。`
      ]
    };
  }

  if (price === 5) {
    return {
      verified: true,
      confidence: "medium",
      evidence,
      plan: [
        `${primary.name} 为 5 费主C且源数据未要求追三：路线以高人口成型为主，经济与血量允许时优先升到 9 人口再集中寻找主C。`,
        `中期只做保血性质的必要搜牌；主C与关键前排两星后，再用剩余经济补齐阵容表中的高费功能位。`
      ]
    };
  }

  if (price === 4) {
    return {
      verified: true,
      confidence: "medium",
      evidence,
      plan: [
        `${primary.name} 为 4 费主C且源数据未要求追三：以 8 人口作为主要成型搜牌层，低人口阶段优先保血和积累升级经济。`,
        `8 人口先完成主C与核心前排两星，再根据血量和经济决定继续补质量或升 9 增加高费功能位。`
      ]
    };
  }

  return {
    verified: true,
    confidence: "medium",
    evidence,
    plan: [
      `${primary.name} 为 ${price} 费主C且源数据未要求追三：以 ${targetLevel} 人口作为首个稳定质量层，优先完成主C两星和核心羁绊。`,
      `质量稳定后继续升人口补齐阵容；除非源数据明确要求三星，否则不把大量经济消耗在无目标的低费追三。`
    ]
  };
}

function mergeMetrics(stats, library, baseline, patch, fetchedAt) {
  const baselineMap = new Map((baseline?.comps ?? []).map((comp) => [normalizeName(comp.name), comp]));
  return stats.map((raw) => {
    const enrichment = findEnrichment(raw.name, library);
    const sourceCoreUnits = Array.isArray(raw.sourceCoreUnits) ? raw.sourceCoreUnits : [];
    const sourceFlexUnits = Array.isArray(raw.sourceFlexUnits) ? raw.sourceFlexUnits : [];
    const hasVerifiedRoster = sourceCoreUnits.length > 0;
    const sourceItems = verifiedSourceItems(raw);
    const derivedStagePlan = deriveEconomyStagePlan(raw);
    const before = baselineMap.get(normalizeName(raw.name));
    const trend24h = before ? Number((performance(raw) - performance(before)).toFixed(2)) : 0;
    const autoReady = !enrichment && hasVerifiedRoster && sourceItems.verified && derivedStagePlan.verified;
    const enrichmentStatus = enrichment || autoReady ? "full" : hasVerifiedRoster ? "partial" : "pending";
    const sourceCompUrl = raw.datajCompId ? `https://www.dataj.cc/comp/${raw.datajCompId}` : null;
    const sourceVerifiedFields = ["coreUnits", "flexUnits", "carries", "traits", "equipmentIds"];
    if (sourceItems.verified) sourceVerifiedFields.push("keyItems", "itemCarriers");
    if (derivedStagePlan.verified) sourceVerifiedFields.push("stagePlanDerived");

    return {
      ...raw,
      patch,
      rankBand: "all",
      trend: trendLabel(trend24h),
      trend24h,
      coreUnits: enrichment?.coreUnits ?? sourceCoreUnits,
      flexUnits: enrichment?.flexUnits ?? sourceFlexUnits,
      keyItems: enrichment?.keyItems ?? sourceItems.keyItems,
      itemCarriers: enrichment?.itemCarriers ?? sourceItems.itemCarriers,
      stagePlan: enrichment?.stagePlan ?? (derivedStagePlan.verified ? derivedStagePlan.plan : [
        sourceItems.verified
          ? "阵容英雄与推荐装备已由公开结构化数据核验；运营节奏仍待可审计规则或可信来源补全。"
          : "阵容英雄结构已由公开数据自动补全；关键装备名称与运营节奏仍待可信来源补全。"
      ]),
      stagePlanSource: enrichment ? "library-curated" : derivedStagePlan.verified ? "derived-economy-v1" : undefined,
      stagePlanConfidence: enrichment ? "high" : derivedStagePlan.confidence,
      stagePlanEvidence: enrichment ? ["data/comp-library.json"] : derivedStagePlan.evidence,
      dataSource: "dataj",
      sourceCompUrl,
      fetchedAt,
      enrichmentStatus,
      enrichmentVerifiedFields: enrichment
        ? ["coreUnits", "flexUnits", "keyItems", "itemCarriers", "stagePlan"]
        : hasVerifiedRoster
          ? sourceVerifiedFields
          : [],
      needsEnrichment: enrichmentStatus !== "full"
    };
  });
}

function enrichmentPriority(comp) {
  const playSignal = Math.min(35, comp.playRate * 18);
  const top4Signal = Math.max(0, comp.top4Rate - 45) * 0.9;
  const winSignal = Math.max(0, comp.winRate - 8) * 0.8;
  const trendSignal = Math.max(0, comp.trend24h ?? 0) * 2;
  return Math.max(0, Math.min(100, Math.round(playSignal + top4Signal + winSignal + trendSignal)));
}

function missingEnrichmentFields(comp) {
  const verified = new Set(comp.enrichmentVerifiedFields ?? []);
  const stageReady = verified.has("stagePlan") || verified.has("stagePlanDerived");
  return ["coreUnits", "flexUnits", "keyItems", "itemCarriers", "stagePlan"]
    .filter((field) => field === "stagePlan" ? !stageReady : !verified.has(field));
}

function buildEnrichmentQueue(comps, previousQueue, patch, fetchedAt, sourceUrl) {
  const previous = new Map(
    (previousQueue?.items ?? []).map((item) => [normalizeName(item.name), item])
  );

  const items = comps
    .filter((comp) => comp.needsEnrichment)
    .map((comp) => {
      const before = previous.get(normalizeName(comp.name));
      return {
        id: comp.id,
        name: comp.name,
        patch,
        status: comp.enrichmentStatus === "partial" ? "partial" : "pending",
        priority: enrichmentPriority(comp),
        firstSeenAt: before?.firstSeenAt ?? fetchedAt,
        lastSeenAt: fetchedAt,
        source: comp.dataSource,
        sourceUrl: comp.sourceCompUrl ?? sourceUrl,
        verifiedFields: comp.enrichmentVerifiedFields ?? [],
        metrics: {
          tier: comp.tier,
          avgPlace: comp.avgPlace,
          playRate: comp.playRate,
          winRate: comp.winRate,
          top4Rate: comp.top4Rate,
          sampleSize: comp.sampleSize,
          sampleSizeSource: comp.sampleSizeSource,
          trend24h: comp.trend24h
        },
        missing: missingEnrichmentFields(comp)
      };
    })
    .sort((a, b) => b.priority - a.priority || b.metrics.playRate - a.metrics.playRate);

  return {
    schemaVersion: 2,
    patch,
    generatedAt: fetchedAt,
    pendingCount: items.length,
    partialCount: items.filter((item) => item.status === "partial").length,
    items
  };
}

await fs.mkdir(HISTORY_DIR, { recursive: true });
const patchLock = await readJson(PATCH_LOCK_PATH);
const rankCapability = await readJson(RANK_CAPABILITY_PATH, {
  verifiedPublicBands: [],
  requestedTargetBands: ["platinum+", "emerald+", "diamond+", "master+"],
  targetBandsPubliclyAvailable: false,
  dataIngested: false
});
const [official, datatft, dataj] = await Promise.all([
  fetchOfficialPatch(),
  fetchDataTFTMetadata(),
  fetchDataJComps()
]);

const fetchedAt = new Date().toISOString();
const authority = official.ok && official.patch
  ? { id: official.id, patch: official.patch, url: official.url, mode: "live-official" }
  : datatft.ok && datatft.patch
    ? { id: datatft.id, patch: datatft.patch, url: datatft.url, mode: "live-secondary" }
    : patchLock?.patch
      ? { id: `${patchLock.source}-lock`, patch: patchLock.patch, url: patchLock.sourceUrl, mode: "verified-lock" }
      : null;

const authoritativePatch = authority?.patch ?? null;
const versionsAgree = Boolean(dataj.ok && authoritativePatch && dataj.patch === authoritativePatch);
const rankCoverage = ["all"];
const rankStatus = {
  ingestedBands: rankCoverage,
  verifiedPublicBands: rankCapability.verifiedPublicBands ?? [],
  requestedTargetBands: rankCapability.requestedTargetBands ?? [],
  targetRankCoverage: false,
  semantics: rankCapability.semantics ?? "cumulative-and-above",
  cnPublicSelectorLockedTo: rankCapability.cnPublicSelectorLockedTo ?? null,
  note: rankCapability.note ?? null
};
const sourceStatus = {
  fetchedAt,
  authoritativePatch,
  patchAuthority: authority,
  liveCompDataAccepted: versionsAgree,
  sources: { official, datatft, dataj },
  rankCoverage,
  rankStatus,
  targetRankCoverage: false,
  note: versionsAgree
    ? `实时阵容统计已通过独立版本校验（${authority?.mode}）。DataJ 当前提供全段位阵容统计、公开序列化阵容结构与装备名称字典；运营节奏仅在可由主C费用/目标星级审计推导时生成，并明确标记 derived-economy-v1。DataTFT 国服公共页面已验证宗师及以上能力，但铂金→大师目标分段并未在国服公共选择器中开放，因此不伪造分段数据。`
    : "阵容统计源未通过独立国服版本校验或抓取失败，本轮拒绝覆盖排行榜，保留上一份已验证快照。"
};
await fs.writeFile(STATUS_PATH, JSON.stringify(sourceStatus, null, 2) + "\n", "utf8");

if (!versionsAgree) {
  console.warn(`snapshot rejected: authoritative=${authoritativePatch}, authority=${authority?.id ?? "none"}, dataj=${dataj.patch}, ok=${dataj.ok}`);
  process.exit(0);
}

const library = await readJson(LIBRARY_PATH, []);
const baseline = await find24hBaseline(authoritativePatch, "all", Date.parse(fetchedAt));
const comps = mergeMetrics(dataj.comps, library, baseline, authoritativePatch, fetchedAt);
const previousQueue = await readJson(ENRICHMENT_QUEUE_PATH, { items: [] });
const enrichmentQueue = buildEnrichmentQueue(comps, previousQueue, authoritativePatch, fetchedAt, dataj.url);

const snapshot = {
  schemaVersion: 2,
  season: patchLock?.season ?? "S18",
  patch: authoritativePatch,
  fetchedAt,
  isLive: true,
  rankBand: "all",
  rankCoverage,
  verifiedPublicRankBands: rankStatus.verifiedPublicBands,
  targetRankCoverage: false,
  totalGames: dataj.totalGames,
  parserMode: dataj.parserMode,
  sampleSizeMethod: dataj.parserMode === "structured-next-flight"
    ? "source-provided DataJ sampleCount; play-rate estimate only if structured data is unavailable"
    : "fallback estimate: totalGames × lobby appearance rate percentage / 100",
  source: "dataj",
  sourceUrl: dataj.url,
  patchAuthority: authority?.id ?? "unknown",
  enrichmentPending: enrichmentQueue.pendingCount,
  enrichmentPartial: enrichmentQueue.partialCount,
  comps
};

sourceStatus.enrichmentQueue = {
  path: "data/enrichment-queue.json",
  pendingCount: enrichmentQueue.pendingCount,
  partialCount: enrichmentQueue.partialCount,
  highestPriority: enrichmentQueue.items[0]?.name ?? null
};

await fs.writeFile(STATUS_PATH, JSON.stringify(sourceStatus, null, 2) + "\n", "utf8");
await fs.writeFile(ENRICHMENT_QUEUE_PATH, JSON.stringify(enrichmentQueue, null, 2) + "\n", "utf8");
await fs.writeFile(LATEST_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
await fs.writeFile(COMPS_PATH, JSON.stringify(comps, null, 2) + "\n", "utf8");
const historyName = fetchedAt.replace(/[:.]/g, "-") + ".json";
await fs.writeFile(path.join(HISTORY_DIR, historyName), JSON.stringify(snapshot, null, 2) + "\n", "utf8");

const equipmentReady = comps.filter((comp) => comp.enrichmentVerifiedFields?.includes("keyItems")).length;
const derivedStageReady = comps.filter((comp) => comp.stagePlanSource === "derived-economy-v1" && !comp.needsEnrichment).length;
console.log(`accepted patch ${authoritativePatch} via ${authority?.id}: ${comps.length} comps, ${dataj.totalGames ?? "?"} games, parser=${dataj.parserMode}, enrichment pending=${enrichmentQueue.pendingCount}, partial=${enrichmentQueue.partialCount}, source-items=${equipmentReady}, derived-stage=${derivedStageReady}`);
