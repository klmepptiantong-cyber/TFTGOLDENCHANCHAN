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

function parsePage(html) {
  const text = pageText(html);
  const compact = text.replace(/\s+/g, "");
  const patchMatch = compact.match(/版本([0-9]+(?:\.[0-9]+)?[a-z]?)[（(]([\d,]+)局[)）]/i);
  const patch = patchMatch?.[1] ?? null;
  const totalGames = patchMatch ? Number(patchMatch[2].replace(/\D/g, "")) : null;

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
      // DataJ exposes play rate as a percentage (for example 1.26 = 1.26%).
      // Convert to a fraction before estimating the number of games represented.
      sampleSize: totalGames ? Math.max(1, Math.round(totalGames * play / 100)) : 0
    });
  }

  return {
    patch,
    totalGames,
    comps,
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
      mode: "comp-stats",
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
      mode: "comp-stats",
      rankBand: "all",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
