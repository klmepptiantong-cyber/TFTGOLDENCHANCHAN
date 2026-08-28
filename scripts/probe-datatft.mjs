import * as cheerio from "cheerio";
import { fetchText } from "./lib/http.mjs";

const BASE = "https://jcc.datatft.com";
const PAGE = `${BASE}/explorer`;

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function contextMatches(text, pattern, radius = 360) {
  const out = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    out.push(text.slice(Math.max(0, index - radius), Math.min(text.length, index + match[0].length + radius)));
  }
  return uniq(out);
}

function quotedLiterals(js) {
  const values = [];
  const pattern = /(["'`])([^\n\r]{1,220}?)\1/g;
  let match;
  while ((match = pattern.exec(js)) !== null) values.push(match[2]);
  return uniq(values);
}

function printFocusedBundle(label, src, js) {
  console.log(`\n=== ${label} ${src} (${js.length}) ===`);
  const literals = quotedLiterals(js);
  const paths = literals.filter((v) => /^\/[A-Za-z0-9_?&=\-./{}:[\]]+/.test(v) && v.length < 220);
  const keys = literals.filter((v) => /(rank|tier|version|patch|day|time|server|region|filter|query|stat|match|hero|unit|comp|augment|equip|result)/i.test(v) && v.length < 160);
  for (const value of uniq(paths).slice(0, 160)) console.log(`PATH ${value}`);
  for (const value of uniq(keys).slice(0, 160)) console.log(`KEY ${value}`);

  const specs = [
    ["IMPORT", /^import[^;]+;?/g],
    ["API_PATH", /\/(?:explore|explorer|statistics|stat|query|search|match|hero|unit|comp|augment|equip|result)[A-Za-z0-9_?&=\-./{}:[\]]*/ig],
    ["GRANDMASTER", /grandmaster/ig],
    ["RANK", /(?:rank|tier)(?:Type|Level|Key|Id|Band|Range)?\s*[:=]/ig],
    ["VERSION", /(?:version|patch)(?:Id|Key|Name|Code)?\s*[:=]/ig],
    ["CALL", /[A-Za-z_$][\w$]*\s*\(\s*["'`]\/[A-Za-z]/g],
    ["AWAIT", /await\s+[A-Za-z_$][\w$]*\s*\(/ig],
    ["PAYLOAD", /(?:filter|conditions|condition|params|payload|body|data)\s*[:=]/ig]
  ];
  for (const [name, pattern] of specs) {
    const contexts = contextMatches(js, pattern).slice(0, 40);
    console.log(`${name}_COUNT=${contexts.length}`);
    for (const value of contexts) console.log(`${name}_CTX ${value.replace(/\s+/g, " ").slice(0, 1000)}`);
  }
}

const html = await fetchText(PAGE, { retries: 1, timeoutMs: 20000 });
const $ = cheerio.load(html);
const scriptSrcs = uniq($("script[src]").map((_, el) => $(el).attr("src")).get())
  .map((src) => new URL(src, BASE).toString());

console.log(`PAGE_BYTES=${html.length}`);
console.log(`SCRIPT_COUNT=${scriptSrcs.length}`);

for (const src of scriptSrcs) {
  try {
    const js = await fetchText(src, { retries: 0, timeoutMs: 20000 });
    console.log(`MAIN ${src} ${js.length}`);

    for (const value of contextMatches(js, /baseURL="https:\/\/api\.datatft\.com"/ig).slice(0, 2)) {
      console.log(`BASE_CTX ${value.replace(/\s+/g, " ").slice(0, 1200)}`);
    }
    for (const value of contextMatches(js, /TS=Gi\.filter\([^)]*grandmaster[^)]*\)/ig).slice(0, 2)) {
      console.log(`JCC_RANK_CTX ${value.replace(/\s+/g, " ").slice(0, 1400)}`);
    }

    const assetMatches = js.match(/assets\/(?:ExplorerView|FilterResult|FilterSelect|StatisticsListResult|Match-|CompView|CompRankView)[A-Za-z0-9_.\-]+\.js/g) ?? [];
    const assets = uniq(assetMatches);
    console.log(`FOCUSED_ASSETS=${assets.length}`);

    for (const asset of assets) {
      const assetUrl = new URL(`/${asset}`, BASE).toString();
      try {
        const chunk = await fetchText(assetUrl, { retries: 0, timeoutMs: 20000 });
        printFocusedBundle(asset, assetUrl, chunk);
      } catch (error) {
        console.log(`CHUNK_ERROR ${assetUrl} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.log(`SCRIPT_ERROR ${src} ${error instanceof Error ? error.message : String(error)}`);
  }
}
