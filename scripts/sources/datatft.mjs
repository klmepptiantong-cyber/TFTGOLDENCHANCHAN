import * as cheerio from "cheerio";
import { fetchText } from "../lib/http.mjs";

const URL = "https://jcc.datatft.com/explorer";

export async function fetchDataTFTMetadata() {
  try {
    const html = await fetchText(URL);
    const $ = cheerio.load(html);
    const text = $.root().text().replace(/\s+/g, " ");
    const patch = text.match(/版本\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?[a-z]?)/i)?.[1] ?? null;
    const rankLabel = text.match(/(宗师及以上|大师及以上|钻石及以上|翡翠及以上|铂金及以上)/)?.[1] ?? null;

    return {
      id: "datatft",
      ok: Boolean(patch),
      patch,
      url: URL,
      fetchedAt: new Date().toISOString(),
      mode: "metadata-only",
      rankLabel,
      supportsRankFilter: Boolean(rankLabel),
      note: "公开页面可验证版本与段位筛选能力；V0.2 暂不猜测未公开的内部统计 API。"
    };
  } catch (error) {
    return {
      id: "datatft",
      ok: false,
      patch: null,
      url: URL,
      fetchedAt: new Date().toISOString(),
      mode: "metadata-only",
      supportsRankFilter: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
