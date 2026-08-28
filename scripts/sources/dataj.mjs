import * as cheerio from "cheerio";
import { fetchText } from "../lib/http.mjs";

const URL = "https://www.dataj.cc/comp";

const slugify = (value) => value
  .trim()
  .toLowerCase()
  .replace(/\s+/g, "-")
  .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
  .slice(0, 80);

function pageText(html) {
  const $ = cheerio.load(html);
  return $.root().text().replace(/\u00a0/g, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractBalancedJson(text, start) {
  const open = text[start];
  const close = open === "[" ? "]" : open === "{" ? "}" : null;
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function nextFlightPayloads(html) {
  const $ = cheerio.load(html);
  const payloads = [];
  $("script").each((_, el) => {
    const script = $(el).text().trim();
    const marker = "self.__next_f.push(";
    if (!script.startsWith(marker)) return;
    let body = script.slice(marker.length);
    if (body.endsWith(";")) body = body.slice(0, -1);
    if (body.endsWith(")")) body = body.slice(0, -1);
    try {
      const tuple = JSON.parse(body);
      if (Array.isArray(tuple) && typeof tuple[1] === "string") payloads.push(tuple[1]);
    } catch {
      // Ignore unrelated/non-JSON flight chunks. The page-text parser remains a fallback.
    }
  });
  return payloads;
}

function extractInitialRows(html) {
  for (const payload of nextFlightPayloads(html)) {
    for (const key of ["initialRows", "initialCompRows"]) {
      const marker = `\"${key}\":`;
      const markerIndex = payload.indexOf(marker);
      if (markerIndex < 0) continue;
      const arrayStart = payload.indexOf("[", markerIndex + marker.length);
      if (arrayStart < 0) continue;
      const json = extractBalancedJson(payload, arrayStart);
      if (!json) continue;
      try {
        const rows = JSON.parse(json);
        if (Array.isArray(rows) && rows.length >= 3) return rows;
      } catch {
        // Keep looking through other flight chunks.
      }
    }
  }
  return [];
}

function groupEquipmentByHero(row) {
  const heroNameById = new Map((row.heroes ?? []).map((hero) => [String(hero.heroId), hero.heroName]));
  const grouped = {};
  for (const equip of row.equips ?? []) {
    const heroName = heroNameById.get(String(equip.heroId)) ?? String(equip.heroId);
    if (!grouped[heroName]) grouped[heroName] = [];
    const equipId = String(equip.equipId);
    if (!grouped[heroName].includes(equipId)) grouped[heroName].push(equipId);
  }
  return grouped;
}

function structuredComps(rows) {
  return rows
    .filter((row) => row && row.name && Number.isFinite(Number(row.avgPlacement)))
    .map((row) => {
      const heroes = Array.isArray(row.heroes) ? row.heroes : [];
      const core = heroes.filter((hero) => hero.isCore || hero.isCarry || hero.isSubCarry);
      const flex = heroes.filter((hero) => !core.includes(hero));
      return {
        id: `dataj-${slugify(row.name)}`,
        datajCompId: row.compId ? String(row.compId) : null,
        name: String(row.name),
        tier: String(row.tier ?? "D"),
        avgPlace: Number(row.avgPlacement),
        playRate: Number(row.pickRate ?? 0),
        winRate: Number(row.topRate ?? 0),
        top4Rate: Number(row.top4Rate ?? 0),
        sampleSize: Math.max(0, Math.round(Number(row.sampleCount ?? 0))),
        sampleSizeSource: row.sampleCount != null ? "dataj-sampleCount" : "unknown",
        sourceCoreUnits: core.map((hero) => String(hero.heroName)).filter(Boolean),
        sourceFlexUnits: flex.map((hero) => String(hero.heroName)).filter(Boolean),
        sourceCarries: heroes
          .filter((hero) => hero.isCarry || hero.isSubCarry)
          .map((hero) => ({
            name: String(hero.heroName),
            role: hero.isCarry ? "carry" : "subcarry",
            targetStars: hero.heroStarNum ?? null,
            price: hero.price ?? null
          })),
        sourceTraits: (row.traits ?? []).map((trait) => String(trait.name)).filter(Boolean),
        sourceEquipmentIdsByHero: groupEquipmentByHero(row),
        sourceLineup: heroes.map((hero) => ({
          name: String(hero.heroName),
          heroId: String(hero.heroId),
          isCore: Boolean(hero.isCore),
          isCarry: Boolean(hero.isCarry),
          isSubCarry: Boolean(hero.isSubCarry),
          price: hero.price ?? null,
          targetStars: hero.heroStarNum ?? null
        }))
      };
    });
}

function parsePage(html) {
  const text = pageText(html);
  const compact = text.replace(/\s+/g, "");
  const patchMatch = compact.match(/版本([0-9]+(?:\.[0-9]+)?[a-z]?)[（(]([\d,]+)局[)）]/i);
  const patch = patchMatch?.[1] ?? null;
  const totalGames = patchMatch ? Number(patchMatch[2].replace(/\D/g, "")) : null;

  const rows = extractInitialRows(html);
  const structured = structuredComps(rows);
  if (structured.length >= 3) {
    return {
      patch,
      totalGames,
      comps: structured,
      parserMode: "structured-next-flight",
      parserDebug: undefined
    };
  }

  const comps = [];
  const pattern = /([SABCD])([^SABCD]{1,60}?)平均(?:排名|名次)([\d.]+)出场率([\d.]+)%?登顶率([\d.]+)%前四率([\d.]+)%/g;
  let match;
  while ((match = pattern.exec(compact)) !== null) {
    const [, tier, rawName, avgPlace, playRate, winRate, top4Rate] = match;
    const name = rawName.replace(/^New/i, "").trim();
    if (!name || name.includes("阵容排行") || name.includes("最小样本")) continue;
    const play = Number(playRate);
    comps.push({
      id: `dataj-${slugify(name)}`,
      name,
      tier,
      avgPlace: Number(avgPlace),
      playRate: play,
      winRate: Number(winRate),
      top4Rate: Number(top4Rate),
      sampleSize: totalGames ? Math.max(1, Math.round(totalGames * play / 100)) : 0,
      sampleSizeSource: "estimated-from-play-rate",
      sourceCoreUnits: [],
      sourceFlexUnits: [],
      sourceCarries: [],
      sourceTraits: [],
      sourceEquipmentIdsByHero: {},
      sourceLineup: []
    });
  }

  return {
    patch,
    totalGames,
    comps,
    parserMode: "compact-text-fallback",
    parserDebug: comps.length ? undefined : compact.slice(Math.max(0, compact.indexOf("平均排名") - 160), compact.indexOf("平均排名") + 700)
  };
}

export async function fetchDataJComps() {
  try {
    const html = await fetchText(URL);
    const parsed = parsePage(html);
    const ok = Boolean(parsed.patch && parsed.comps.length >= 3);
    return {
      id: "dataj",
      ok,
      url: URL,
      fetchedAt: new Date().toISOString(),
      mode: "comp-stats-and-lineups",
      rankBand: "all",
      ...parsed,
      error: ok ? undefined : `parse incomplete: patch=${parsed.patch ?? "none"}, comps=${parsed.comps.length}`
    };
  } catch (error) {
    return {
      id: "dataj",
      ok: false,
      patch: null,
      totalGames: null,
      comps: [],
      url: URL,
      fetchedAt: new Date().toISOString(),
      mode: "comp-stats-and-lineups",
      rankBand: "all",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
