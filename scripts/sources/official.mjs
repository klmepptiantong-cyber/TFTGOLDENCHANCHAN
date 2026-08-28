import * as cheerio from "cheerio";
import { fetchText } from "../lib/http.mjs";

const URLS = [
  "https://www.taptap.cn/moment/841982769956390376",
  "https://www.taptap.cn/forum/g213275",
  "https://www.taptap.cn/app/176937/topic?group_label_id=521740"
];

function extractPatch(html) {
  const $ = cheerio.load(html);
  const text = $.root().text().replace(/\s+/g, " ");
  const matches = [...text.matchAll(/《金铲铲之战》\s*([0-9]+(?:\.[0-9]+)?[a-z]?)版本/gi)];
  return matches[0]?.[1] ?? null;
}

export async function fetchOfficialPatch() {
  const errors = [];
  for (const url of URLS) {
    try {
      const html = await fetchText(url);
      const patch = extractPatch(html);
      if (patch) {
        return {
          id: "official-taptap",
          ok: true,
          patch,
          url,
          fetchedAt: new Date().toISOString(),
          mode: "patch-authority"
        };
      }
      errors.push(`${url}: patch not found`);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    id: "official-taptap",
    ok: false,
    patch: null,
    url: URLS[0],
    fetchedAt: new Date().toISOString(),
    mode: "patch-authority",
    error: errors.join(" | ")
  };
}
