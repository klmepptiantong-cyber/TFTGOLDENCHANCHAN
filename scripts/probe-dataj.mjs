import * as cheerio from "cheerio";
import { fetchText } from "./lib/http.mjs";

const urls = [
  "https://www.dataj.cc/comp",
  "https://www.dataj.cc/database",
  "https://www.dataj.cc/equip",
  "https://www.dataj.cc/comp/91"
];

const needles = [
  "equipId",
  "equipName",
  "equipmentId",
  "equipmentName",
  "stage",
  "level",
  "运营",
  "过渡",
  "搜牌",
  "升人口"
];

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
      // Ignore non-JSON flight chunks.
    }
  });
  return payloads;
}

function collectEquipmentPairs(payloads) {
  const pairs = new Map();
  const patterns = [
    /\"equipId\"\s*:\s*\"?(\d+)\"?[\s\S]{0,260}?\"equipName\"\s*:\s*\"([^\"]+)\"/g,
    /\"equipName\"\s*:\s*\"([^\"]+)\"[\s\S]{0,260}?\"equipId\"\s*:\s*\"?(\d+)\"?/g,
    /\"id\"\s*:\s*\"?(\d+)\"?[\s\S]{0,180}?\"name\"\s*:\s*\"([^\"]+)\"/g
  ];

  for (const payload of payloads) {
    for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
      const pattern = patterns[patternIndex];
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(payload)) !== null) {
        const [id, name] = patternIndex === 1 ? [match[2], match[1]] : [match[1], match[2]];
        if (!/^\d+$/.test(String(id)) || !name || name.length > 60) continue;
        if (!pairs.has(String(id))) pairs.set(String(id), name);
        if (pairs.size >= 250) return pairs;
      }
    }
  }
  return pairs;
}

for (const url of urls) {
  const html = await fetchText(url, { retries: 1, timeoutMs: 20000 });
  const $ = cheerio.load(html);
  const payloads = nextFlightPayloads(html);
  const pairs = collectEquipmentPairs(payloads);

  console.log(`\n===== PAGE ${url} BYTES=${html.length} FLIGHT=${payloads.length} =====`);
  console.log(`TITLE=${$("title").text().replace(/\s+/g, " ").trim()}`);
  console.log(`EQUIPMENT_PAIRS=${JSON.stringify([...pairs.entries()].slice(0, 120))}`);

  for (const needle of needles) {
    const contexts = [];
    for (const payload of payloads) {
      let from = 0;
      while (contexts.length < 5) {
        const index = payload.indexOf(needle, from);
        if (index < 0) break;
        contexts.push(payload.slice(Math.max(0, index - 260), Math.min(payload.length, index + 620)).replace(/\s+/g, " "));
        from = index + needle.length;
      }
      if (contexts.length >= 5) break;
    }
    if (contexts.length) console.log(`NEEDLE ${needle} ${JSON.stringify(contexts)}`);
  }

  const pageText = $.root().text().replace(/\s+/g, " ").trim();
  for (const word of ["运营", "过渡", "搜牌", "升人口"]) {
    const index = pageText.indexOf(word);
    if (index >= 0) {
      console.log(`TEXT_CTX ${word} ${pageText.slice(Math.max(0, index - 220), index + 700)}`);
    }
  }
}
