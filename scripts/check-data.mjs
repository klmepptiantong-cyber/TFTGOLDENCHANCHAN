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

  if (raw.totalGames && comp.sampleSizeSource === "estimated-from-play-rate" && comp.sampleSize > raw.totalGames) {
    errors.push(`${comp.name}: estimated sampleSize exceeds totalGames; check percentage conversion`);
  }
  if (raw.totalGames && comp.sampleSizeSource === "dataj-sampleCount" && comp.sampleSize > raw.totalGames * 8) {
    errors.push(`${comp.name}: source sampleSize exceeds theoretical 8-player observations per game`);
  }

  if (comp.enrichmentStatus === "partial") {
    if (!Array.isArray(comp.coreUnits) || comp.coreUnits.length === 0) errors.push(`${comp.name}: partial enrichment missing coreUnits`);
    if (!Array.isArray(comp.enrichmentVerifiedFields) || !comp.enrichmentVerifiedFields.includes("coreUnits")) {
      errors.push(`${comp.name}: partial enrichment must declare verified coreUnits`);
    }
  }

  if (comp.enrichmentStatus === "full") {
    if (!Array.isArray(comp.coreUnits) || comp.coreUnits.length === 0) errors.push(`${comp.name}: full enrichment missing coreUnits`);
    if (!Array.isArray(comp.keyItems) || comp.keyItems.length === 0) errors.push(`${comp.name}: full enrichment missing keyItems`);
    if (!comp.itemCarriers || Object.keys(comp.itemCarriers).length === 0) errors.push(`${comp.name}: full enrichment missing itemCarriers`);
    if (!Array.isArray(comp.stagePlan) || comp.stagePlan.length === 0) errors.push(`${comp.name}: full enrichment missing stagePlan`);
    if (comp.needsEnrichment === true) errors.push(`${comp.name}: full enrichment cannot still need enrichment`);
  }

  const verified = new Set(comp.enrichmentVerifiedFields ?? []);
  if (comp.sourceEquipmentNamesComplete) {
    const coverage = comp.sourceEquipmentNameCoverage;
    if (!coverage || !Number.isInteger(coverage.mapped) || !Number.isInteger(coverage.total) || coverage.total <= 0 || coverage.mapped !== coverage.total) {
      errors.push(`${comp.name}: complete source equipment mapping requires mapped === total > 0`);
    }
  }

  if (verified.has("keyItems")) {
    if (!Array.isArray(comp.keyItems) || comp.keyItems.length === 0) {
      errors.push(`${comp.name}: verified keyItems must be non-empty`);
    } else {
      for (const item of comp.keyItems) {
        if (typeof item !== "string" || !item.trim() || /^\d+$/.test(item.trim())) {
          errors.push(`${comp.name}: verified keyItems must contain equipment names, not IDs`);
        }
      }
    }
  }

  if (verified.has("itemCarriers")) {
    const entries = comp.itemCarriers && typeof comp.itemCarriers === "object" ? Object.entries(comp.itemCarriers) : [];
    if (!entries.length) errors.push(`${comp.name}: verified itemCarriers must be non-empty`);
    for (const [hero, items] of entries) {
      if (!hero.trim() || !Array.isArray(items) || items.length === 0) {
        errors.push(`${comp.name}: invalid verified item carrier ${hero || "unknown"}`);
        continue;
      }
      for (const item of items) {
        if (typeof item !== "string" || !item.trim() || /^\d+$/.test(item.trim())) {
          errors.push(`${comp.name}: itemCarriers must contain equipment names, not IDs`);
        }
        if (Array.isArray(comp.keyItems) && !comp.keyItems.includes(item)) {
          errors.push(`${comp.name}: carrier item ${item} missing from keyItems`);
        }
      }
    }
  }

  if (comp.stagePlanSource === "derived-economy-v1") {
    if (comp.enrichmentStatus !== "full" || comp.needsEnrichment !== false) {
      errors.push(`${comp.name}: derived stage plan must only promote a fully ready comp`);
    }
    if (!new Set(["high", "medium"]).has(comp.stagePlanConfidence)) {
      errors.push(`${comp.name}: derived stage plan confidence must be high or medium`);
    }
    if (!Array.isArray(comp.stagePlanEvidence) || comp.stagePlanEvidence.length < 3) {
      errors.push(`${comp.name}: derived stage plan needs auditable evidence`);
    }
    if (!verified.has("stagePlanDerived")) {
      errors.push(`${comp.name}: derived stage plan must declare stagePlanDerived`);
    }
    if (!comp.sourceEquipmentNamesComplete || !verified.has("keyItems") || !verified.has("itemCarriers")) {
      errors.push(`${comp.name}: derived stage promotion requires complete verified equipment semantics`);
    }
  }
}

try {
  const queue = JSON.parse(await fs.readFile(queueFile, "utf8"));
  if (!Array.isArray(queue.items)) errors.push("enrichment queue items must be an array");
  if (queue.pendingCount !== queue.items?.length) errors.push("enrichment queue pendingCount mismatch");
  if (queue.partialCount !== undefined && queue.partialCount !== queue.items?.filter((item) => item.status === "partial").length) {
    errors.push("enrichment queue partialCount mismatch");
  }
  for (const item of queue.items ?? []) {
    if (!new Set(["pending", "partial"]).has(item.status)) errors.push(`${item.name ?? "unknown"}: enrichment queue status invalid`);
    if (item.priority < 0 || item.priority > 100) errors.push(`${item.name ?? "unknown"}: enrichment priority out of range`);
    if (!Array.isArray(item.missing) || item.missing.length === 0) errors.push(`${item.name ?? "unknown"}: enrichment queue missing fields must be non-empty`);
    const verified = new Set(item.verifiedFields ?? []);
    for (const field of ["coreUnits", "flexUnits", "keyItems", "itemCarriers"]) {
      if (verified.has(field) && item.missing?.includes(field)) errors.push(`${item.name ?? "unknown"}: ${field} cannot be both verified and missing`);
    }
    const stageReady = verified.has("stagePlan") || verified.has("stagePlanDerived");
    if (stageReady && item.missing?.includes("stagePlan")) errors.push(`${item.name ?? "unknown"}: stagePlan cannot be both ready and missing`);
  }
} catch (error) {
  if (raw.enrichmentPending !== undefined) errors.push(`enrichment queue missing/invalid: ${error instanceof Error ? error.message : String(error)}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`snapshot OK: patch=${raw.patch}, live=${raw.isLive}, comps=${raw.comps.length}, fetchedAt=${raw.fetchedAt}, parser=${raw.parserMode ?? "n/a"}, enrichmentPending=${raw.enrichmentPending ?? "n/a"}, enrichmentPartial=${raw.enrichmentPartial ?? "n/a"}`);
