import * as cheerio from "cheerio";
import { fetchText } from "./lib/http.mjs";

const BASE = "https://jcc.datatft.com";
const PAGE = `${BASE}/explorer`;

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function contextMatches(text, pattern, radius = 180) {
  const out = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    out.push(text.slice(Math.max(0, index - radius), Math.min(text.length, index + match[0].length + radius)));
  }
  return uniq(out);
}

const html = await fetchText(PAGE, { retries: 1, timeoutMs: 20000 });
const $ = cheerio.load(html);
const scriptSrcs = uniq($("script[src]").map((_, el) => $(el).attr("src")).get())
  .map((src) => new URL(src, BASE).toString());

console.log(`PAGE_BYTES=${html.length}`);
console.log(`SCRIPT_COUNT=${scriptSrcs.length}`);
for (const src of scriptSrcs) console.log(`SCRIPT ${src}`);

const candidates = [];
for (const src of scriptSrcs.slice(-30)) {
  try {
    const js = await fetchText(src, { retries: 0, timeoutMs: 15000 });
    if (!/(explorer|rank|grandmaster|宗师|api|fetch\(|axios)/i.test(js)) continue;
    const apiPaths = uniq([
      ...(js.match(/https?:\\?\/\\?\/[^"'`\\\s)]+/g) ?? []),
      ...(js.match(/\/(?:api|explorer|stats|rank|match|data)[A-Za-z0-9_?&=\-./{}:[\]]*/gi) ?? [])
    ]).slice(0, 80);
    const contexts = [
      ...contextMatches(js, /grandmaster/ig),
      ...contextMatches(js, /宗师/ig),
      ...contextMatches(js, /explorer/ig),
      ...contextMatches(js, /rank/ig)
    ].slice(0, 40);
    if (apiPaths.length || contexts.length) {
      candidates.push({ src, bytes: js.length, apiPaths, contexts });
    }
  } catch (error) {
    console.log(`SCRIPT_ERROR ${src} ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`CANDIDATE_BUNDLES=${candidates.length}`);
for (const bundle of candidates) {
  console.log(`\n=== BUNDLE ${bundle.src} (${bundle.bytes}) ===`);
  for (const value of bundle.apiPaths) console.log(`PATH ${value}`);
  for (const value of bundle.contexts) console.log(`CTX ${value.replace(/\s+/g, " ").slice(0, 500)}`);
}
