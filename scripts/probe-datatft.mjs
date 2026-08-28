import * as cheerio from "cheerio";
import { fetchText } from "./lib/http.mjs";

const BASE = "https://jcc.datatft.com";
const PAGE = `${BASE}/explorer`;

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function contextMatches(text, pattern, radius = 260) {
  const out = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    out.push(text.slice(Math.max(0, index - radius), Math.min(text.length, index + match[0].length + radius)));
  }
  return uniq(out);
}

function quotedLiterals(js) {
  const values = [];
  const pattern = /(["'`])((?:\\.|(?!\1).){1,240})\1/g;
  let match;
  while ((match = pattern.exec(js)) !== null) values.push(match[2]);
  return uniq(values);
}

const html = await fetchText(PAGE, { retries: 1, timeoutMs: 20000 });
const $ = cheerio.load(html);
const scriptSrcs = uniq($("script[src]").map((_, el) => $(el).attr("src")).get())
  .map((src) => new URL(src, BASE).toString());

console.log(`PAGE_BYTES=${html.length}`);
console.log(`SCRIPT_COUNT=${scriptSrcs.length}`);
for (const src of scriptSrcs) console.log(`SCRIPT ${src}`);

for (const src of scriptSrcs.slice(-30)) {
  try {
    const js = await fetchText(src, { retries: 0, timeoutMs: 20000 });
    if (!/(explorer|rank|grandmaster|宗师|api|fetch\(|axios|baseURL)/i.test(js)) continue;

    console.log(`\n=== BUNDLE ${src} (${js.length}) ===`);

    const literals = quotedLiterals(js);
    const hosts = literals.filter((v) => /https?:\/\//i.test(v) && /datatft|api/i.test(v));
    const relative = literals.filter((v) => /^\//.test(v) && v.length < 180);
    const suspicious = literals.filter((v) => /(explor|stat|rank|match|search|query|hero|equip|augment|comp|lineup|team|filter|version|patch)/i.test(v) && v.length < 180);

    for (const value of uniq(hosts)) console.log(`HOST ${value}`);
    for (const value of uniq(relative).slice(0, 300)) console.log(`REL ${value}`);
    for (const value of uniq(suspicious).slice(0, 400)) console.log(`LIT ${value}`);

    const contextSpecs = [
      ["BASEURL", /baseURL/ig],
      ["AXIOS_CREATE", /axios\.create/ig],
      ["CREATE_CALL", /\.create\(\{[^}]{0,120}(?:baseURL|timeout|headers)/ig],
      ["FETCH", /fetch\(/ig],
      ["XHR", /XMLHttpRequest/ig],
      ["GRANDMASTER_KEY", /grandmasterAndAbove/ig],
      ["PLATINUM_KEY", /platinumAndAbove/ig],
      ["EXPLORER", /explorer/ig],
      ["RANK_PARAM", /(?:rank|tier)(?:Type|Level|Key|Id|Band|Range)?\s*[:=]/ig],
      ["REQUEST", /request\s*\(/ig],
      ["POST", /\.post\(/ig],
      ["GET", /\.get\(/ig]
    ];

    for (const [label, pattern] of contextSpecs) {
      const contexts = contextMatches(js, pattern).slice(0, label === "GET" || label === "POST" ? 50 : 80);
      console.log(`${label}_COUNT=${contexts.length}`);
      for (const value of contexts) console.log(`${label}_CTX ${value.replace(/\s+/g, " ").slice(0, 800)}`);
    }
  } catch (error) {
    console.log(`SCRIPT_ERROR ${src} ${error instanceof Error ? error.message : String(error)}`);
  }
}
