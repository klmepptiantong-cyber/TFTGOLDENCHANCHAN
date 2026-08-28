import fs from "node:fs/promises";
import path from "node:path";

const file = path.join(process.cwd(), "data", "latest.json");
const raw = JSON.parse(await fs.readFile(file, "utf8"));
const errors = [];

if (raw.schemaVersion !== 2) errors.push("schemaVersion must be 2");
if (!raw.patch) errors.push("patch missing");
if (!raw.fetchedAt || Number.isNaN(Date.parse(raw.fetchedAt))) errors.push("fetchedAt invalid");
if (!Array.isArray(raw.comps)) errors.push("comps must be an array");

for (const comp of raw.comps ?? []) {
  for (const key of ["name", "tier", "avgPlace", "top4Rate", "winRate", "playRate", "sampleSize"]) {
    if (comp[key] === undefined || comp[key] === null) errors.push(`${comp.name ?? "unknown"}: ${key} missing`);
  }
  if (comp.top4Rate < 0 || comp.top4Rate > 100) errors.push(`${comp.name}: top4Rate out of range`);
  if (comp.winRate < 0 || comp.winRate > 100) errors.push(`${comp.name}: winRate out of range`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`snapshot OK: patch=${raw.patch}, live=${raw.isLive}, comps=${raw.comps.length}, fetchedAt=${raw.fetchedAt}`);
