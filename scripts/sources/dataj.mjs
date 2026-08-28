import * as cheerio from "cheerio";
import { fetchText } from "../lib/http.mjs";

const URL = "https://www.dataj.cc/comp";

const slugify = (value) => value
  .trim()
  .toLowerCase()
  .replace(/\s+/g, "-")
  .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
  .slice(0, 80);

function parsePage(html) {
  const $ = cheerio.load(html);
  const text = $.root().text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const patchMatch = text.match(/版本\s*([0-9]+(?:\.[0-9]+)?[a-z]?)\s*[（(]\s*([\d,]+)\s*局\s*[)）]/i);
  const patch = patchMatch?.[1] ?? null;
  const totalGames = patchMatch ? Number(patchMatch[2].replace(/,/g, "")) : null;

  const comps = [];
  const pattern = /(?:^|\s)([SABCD])\s*([^\d]{2,40}?)\s*平均排名\s*([\d.]+)\s*出场率\s*([\d.]+)\s*登顶率\s*([\d.]+)%\s*前四率\s*([\d.]+)%/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const [, tier, rawName, avgPlace, playRate, winRate, top4Rate] = match;
    const name = rawName.trim().replace(/^New\s*/i, "").trim();
    const play = Number(playRate);
    comps.push({
      id: `dataj-${slugify(name)}`,
      name,
      tier,
      avgPlace: Number(avgPlace),
      playRate: play,
      winRate: Number(winRate),
      top4Rate: Number(top4Rate),
      sampleSize: totalGames ? Math.max(1, Math.round(totalGames * play)) : 0
    });
  }

  return { patch, totalGames, comps };
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
