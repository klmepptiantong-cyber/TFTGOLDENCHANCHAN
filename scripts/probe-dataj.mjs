import * as cheerio from "cheerio";
import { fetchText } from "./lib/http.mjs";

const urls = ["https://www.dataj.cc/", "https://www.dataj.cc/comp"];
const needles = ["莲华阿狸", "重装琉斯", "重装女警", "7野怪鸡哥", "赌蛇女", "巨龙95", "永森95"];

for (const url of urls) {
  const html = await fetchText(url, { retries: 1, timeoutMs: 20000 });
  const $ = cheerio.load(html);
  console.log(`\n===== PAGE ${url} BYTES=${html.length} =====`);

  const links = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href.startsWith("/comp/")) return;
    links.push({ href, text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 160) });
  });
  console.log(`COMP_LINKS=${JSON.stringify(links.slice(0, 100))}`);

  const rawCompPaths = [...new Set(html.match(/\/comp\/\d+/g) ?? [])];
  console.log(`RAW_COMP_PATHS=${JSON.stringify(rawCompPaths.slice(0, 100))}`);

  for (const needle of needles) {
    const indexes = [];
    let from = 0;
    while (true) {
      const index = html.indexOf(needle, from);
      if (index < 0) break;
      indexes.push(index);
      from = index + needle.length;
      if (indexes.length >= 6) break;
    }
    console.log(`\n--- ${needle} occurrences=${indexes.length} ---`);
    for (const index of indexes) {
      console.log(html.slice(Math.max(0, index - 900), Math.min(html.length, index + 1600)).replace(/\s+/g, " "));
    }
  }

  $("script").each((index, el) => {
    const text = $(el).text();
    if (!needles.some((needle) => text.includes(needle))) return;
    console.log(`\nSCRIPT_WITH_COMP index=${index} bytes=${text.length}`);
    for (const needle of needles) {
      const pos = text.indexOf(needle);
      if (pos >= 0) console.log(`SCRIPT_CTX ${needle} ${text.slice(Math.max(0, pos - 700), Math.min(text.length, pos + 1500)).replace(/\s+/g, " ")}`);
    }
  });
}
