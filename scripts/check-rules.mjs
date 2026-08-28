import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const file = path.join(root, "rules", "S18", "18.1b.json");
const rules = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [];

if (rules.season !== "S18" || rules.patch !== "18.1b") errors.push("unexpected season/patch");
if (!rules.verification?.status) errors.push("verification.status missing");
if (!rules.verification?.precisionUse) errors.push("verification.precisionUse missing");

for (const cost of ["1", "2", "3", "4", "5"]) {
  const value = Number(rules.poolSizeByCost?.[cost]);
  if (!Number.isFinite(value) || value <= 0) errors.push(`invalid pool size for ${cost}-cost`);
}

const precisionAllowed = rules.verification?.status === "verified" && rules.verification?.precisionUse === "allowed";
if (precisionAllowed) {
  if (!rules.shopOddsByLevel || Object.keys(rules.shopOddsByLevel).length === 0) {
    errors.push("precise EV cannot be allowed without shop odds");
  }
  if (!Array.isArray(rules.sources) || rules.sources.length < 2) {
    errors.push("verified rules require at least two provenance entries");
  }
} else if (rules.verification?.precisionUse !== "blocked") {
  errors.push("non-verified rules must explicitly block precision use");
}

if (errors.length) {
  console.error("rule gate failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`rules OK: ${rules.season} ${rules.patch}, status=${rules.verification.status}, precision=${rules.verification.precisionUse}`);
