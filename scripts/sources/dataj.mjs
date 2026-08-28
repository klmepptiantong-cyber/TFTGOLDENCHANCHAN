import * as cheerio from "cheerio";
import { fetchText } from "../lib/http.mjs";

const URL = "https://www.dataj.cc/comp";
const EQUIP_URL = "https://www.dataj.cc/equip";

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

function extractRows(html, keys) {
  for (const payload of nextFlightPayloads(html)) {
    for (const key of keys) {
      const marker = `\"${key}\":`;
      let searchFrom = 0;
      while (searchFrom < payload.length) {
        const markerIndex = payload.indexOf(marker, searchFrom);
        if (markerIndex < 0) break;
        const arrayStart = payload.indexOf("[", markerIndex + marker.length);
        if (arrayStart < 0) break;
        const json = extractBalancedJson(payload, arrayStart);
        if (json) {
          try {
            const rows = JSON.parse(json);
            if (Array.isArray(rows) && rows.length >= 3) return rows;
          } catch {
            // Keep looking through later occurrences/flight chunks.
          }
        }
        searchFrom = markerIndex + marker.length;
      }
    }
  }
  return [];
}

function extractInitialRows(html) {
  return extractRows(html, ["initialRows", "initialCompRows"]);
}

function equipmentCatalog(html) {
  const rows = extractRows(html, ["initialRows", "initialEquipRows"]);
  const namesById = new Map();
  const picturesById = new Map();
  const heroPicturesById = new Map();

  for (const row of rows) {
    if (row?.equipId != null && row?.name) {
      const id = String(row.equipId);
      const name = String(row.name).trim();
      if (id && name) namesById.set(id, name);
      if (id && typeof row.picture === "string" && /^https:\/\//.test(row.picture)) {
        picturesById.set(id, row.picture);
      }
    }

    for (const hero of row?.recommendedHeroes ?? []) {
      const heroId = hero?.heroId == null ? "" : String(hero.heroId);
      const picture = typeof hero?.picture === "string" ? hero.picture : "";
      if (heroId && /^https:\/\//.test(picture) && !heroPicturesById.has(heroId)) {
        heroPicturesById.set(heroId, picture);
      }
    }
  }

  return { namesById, picturesById, heroPicturesById };
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

function resolveEquipment(idsByHero, catalog) {
  const namesByHero = {};
  const picturesById = {};
  const picturesByName = {};
  let mapped = 0;
  let total = 0;

  for (const [hero, ids] of Object.entries(idsByHero ?? {})) {
    const names = [];
    for (const rawId of ids ?? []) {
      total += 1;
      const id = String(rawId);
      const name = catalog.namesById.get(id);
      const picture = catalog.picturesById.get(id);
      if (!name) continue;
      mapped += 1;
      if (!names.includes(name)) names.push(name);
      if (picture) {
        picturesById[id] = picture;
        picturesByName[name] = picture;
      }
    }
    if (names.length) namesByHero[hero] = names;
  }

  return {
    namesByHero,
    picturesById,
    picturesByName,
    mapped,
    total,
    complete: total > 0 && mapped === total
  };
}

function structuredComps(rows, catalog = { namesById: new Map(), picturesById: new Map(), heroPicturesById: new Map() }) {
  return rows
    .filter((row) => row && row.name && Number.isFinite(Number(row.avgPlacement)))
    .map((row) => {
      const heroes = Array.isArray(row.heroes) ? row.heroes : [];
      const core = heroes.filter((hero) => hero.isCore || hero.isCarry || hero.isSubCarry);
      const flex = heroes.filter((hero) => !core.includes(hero));
      const equipmentIdsByHero = groupEquipmentByHero(row);
      const resolvedEquipment = resolveEquipment(equipmentIdsByHero, catalog);
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
        sourceEquipmentIdsByHero: equipmentIdsByHero,
        sourceEquipmentNamesByHero: resolvedEquipment.namesByHero,
        sourceEquipmentPicturesById: resolvedEquipment.picturesById,
        sourceEquipmentPicturesByName: resolvedEquipment.picturesByName,
        sourceEquipmentNamesComplete: resolvedEquipment.complete,
        sourceEquipmentNameCoverage: {
          mapped: resolvedEquipment.mapped,
          total: resolvedEquipment.total
        },
        sourceLineup: heroes.map((hero) => ({
          name: String(hero.heroName),
          heroId: String(hero.heroId),
          isCore: Boolean(hero.isCore),
          isCarry: Boolean(hero.isCarry),
          isSubCarry: Boolean(hero.isSubCarry),
          price: hero.price ?? null,
          targetStars: hero.heroStarNum ?? null,
          picture: catalog.heroPicturesById.get(String(hero.heroId)) ?? null
        }))
      };
    });
}

function parsePage(html, catalog = { namesById: new Map(), picturesById: new Map(), heroPicturesById: new Map() }) {
  const text = pageText(html);
  const compact = text.replace(/\s+/g, "");
  const patchMatch = compact.match(/版本([0-9]+(?:\.[0-9]+)?[a-z]?)[（(]([\d,]+)局[)）]/i);
  const patch = patchMatch?.[1] ?? null;
  const totalGames = patchMatch ? Number(patchMatch[2].replace(/\D/g, "")) : null;

  const rows = extractInitialRows(html);
  const structured = structuredComps(rows, catalog);
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
      sourceEquipmentNamesByHero: {},
      sourceEquipmentPicturesById: {},
      sourceEquipmentPicturesByName: {},
      sourceEquipmentNamesComplete: false,
      sourceEquipmentNameCoverage: { mapped: 0, total: 0 },
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
    const [html, equipHtmlResult] = await Promise.all([
      fetchText(URL),
      fetchText(EQUIP_URL).catch(() => null)
    ]);
    const catalog = equipHtmlResult ? equipmentCatalog(equipHtmlResult) : { namesById: new Map(), picturesById: new Map(), heroPicturesById: new Map() };
    const parsed = parsePage(html, catalog);
    const ok = Boolean(parsed.patch && parsed.comps.length >= 3);
    const structuredCompsWithEquipment = parsed.comps.filter((comp) => comp.sourceEquipmentNamesComplete).length;
    const compsWithHeroPictures = parsed.comps.filter((comp) => (comp.sourceLineup ?? []).some((hero) => hero.picture)).length;
    return {
      id: "dataj",
      ok,
      url: URL,
      equipmentUrl: EQUIP_URL,
      equipmentDictionaryOk: catalog.namesById.size > 0,
      equipmentDictionarySize: catalog.namesById.size,
      equipmentPictureCount: catalog.picturesById.size,
      heroPictureCount: catalog.heroPicturesById.size,
      compsWithHeroPictures,
      structuredCompsWithEquipment,
      fetchedAt: new Date().toISOString(),
      mode: "comp-stats-lineups-equipment-and-pictures",
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
      equipmentUrl: EQUIP_URL,
      equipmentDictionaryOk: false,
      equipmentDictionarySize: 0,
      equipmentPictureCount: 0,
      heroPictureCount: 0,
      compsWithHeroPictures: 0,
      structuredCompsWithEquipment: 0,
      fetchedAt: new Date().toISOString(),
      mode: "comp-stats-lineups-equipment-and-pictures",
      rankBand: "all",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}