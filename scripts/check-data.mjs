import fs from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
const file = path.join(dataDir, "latest.json");
const queueFile = path.join(dataDir, "enrichment-queue.json");
const raw = JSON.parse(await fs.readFile(file, "utf8"));
const errors = [];

if (raw.schemaVersion !== 2) errors.push("schemaVersion must be 2");
if (!raw.patch) errors.push("patch missing");
if (!raw.fetchedAt || Number.isNaN(Date.parse(raw.fetchedAt))) errors.push("fetchedAt invalid");
if (!Array.isArray(raw.comps)) errors.push("comps must be an array");
if (raw.totalGames !== null && raw.totalGames !== undefined && raw.totalGames < 0) errors.push("totalGames out of range");

for (const comp of raw.comps ?? []) {
  for (const key of ["name", "tier", "avgPlace", "top4Rate", "winRate", "playRate", "sampleSize"]) {
    if (comp[key] === undefined || comp[key] === null) errors.push(`${comp.name ?? "unknown"}: ${key} missing`);
  }
  if (comp.top4Rate < 0 || comp.top4Rate > 100) errors.push(`${comp.name}: top4Rate out of range`);
  if (comp.winRate < 0 || comp.winRate > 100) errors.push(`${comp.name}: winRate out of range`);
  if (comp.playRate < 0 || comp.playRate > 100) errors.push(`${comp.name}: playRate out of range`);
  if (!Number.isInteger(comp.sampleSize) || comp.sampleSize < 0) errors.push(`${comp.name}: sampleSize must be a non-negative integer`);
  if (raw.totalGames && comp.sampleSize > raw.totalGames) errors.push(`${comp.name}: sampleSize exceeds totalGames; check percentage conversion`);
}

try {
  const queue = JSON.parse(await fs.readFile(queueFile, "utf8"));
  if (!Array.isArray(queue.items)) errors.push("enrichment queue items must be an array");
  if (queue.pendingCount !== queue.items?.length) errors.push("enrichment queue pendingCount mismatch");
  for (const item of queue.items ?? []) {
    if (item.status !== "pending") errors.push(`${item.name ?? "unknown"}: enrichment queue status must be pending`);
    if (item.priority < 0 || item.priority > 100) errors.push(`${item.name ?? "unknown"}: enrichment priority out of range`);
  }
} catch (error) {
  if (raw.enrichmentPending !== undefined) errors.push(`enrichment queue missing/invalid: ${error instanceof Error ? error.message : String(error)}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`snapshot OK: patch=${raw.patch}, live=${raw.isLive}, comps=${raw.comps.length}, fetchedAt=${raw.fetchedAt}, enrichmentPending=${raw.enrichmentPending ?? "n/a"}`);
