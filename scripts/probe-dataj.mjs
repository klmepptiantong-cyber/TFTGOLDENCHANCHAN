import { fetchText } from "./lib/http.mjs";

const url = "https://www.dataj.cc/comp";
const html = await fetchText(url, { retries: 1, timeoutMs: 20000 });
console.log(`PAGE_BYTES=${html.length}`);
for (const needle of ["赌蛇女", "7野怪鸡哥", "神器天使", "剑圣大嘴"]) {
  const index = html.indexOf(needle);
  console.log(`\n=== ${needle} INDEX=${index} ===`);
  if (index >= 0) console.log(html.slice(Math.max(0, index - 1800), Math.min(html.length, index + 2800)).replace(/\s+/g, " "));
}
