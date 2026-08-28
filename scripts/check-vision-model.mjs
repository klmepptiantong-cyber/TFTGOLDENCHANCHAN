import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const manifestPath = path.join(root, "vision", "model-manifest.json");
const fail = (message) => {
  console.error(`[vision-model] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(manifestPath)) fail("missing vision/model-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1) fail("unsupported manifest schemaVersion");
if (!manifest.id || manifest.game !== "金铲铲之战" || manifest.dataset?.region !== "CN") {
  fail("manifest must target the China-server game dataset");
}
if (manifest.dataset?.currentSeasonOnly !== true || manifest.dataset?.splitUnit !== "session") {
  fail("dataset must be current-season-only and split by session");
}
if (manifest.dataset?.hardNegativesRequired !== true) fail("hard negatives must be required");

const thresholds = manifest.thresholds ?? {};
for (const key of [
  "perClassPrecisionMin",
  "perClassRecallMin",
  "unknownRecallMin",
  "boardExactAccuracyMin",
  "falseWriteRateMax",
  "cpuP95MsMax",
  "minTrainSessions",
  "minValidationSessions",
  "minTestSessions"
]) {
  if (!Number.isFinite(thresholds[key])) fail(`missing numeric threshold: ${key}`);
}

if (manifest.status !== "verified") {
  if (manifest.status !== "blocked") fail("status must be blocked or verified");
  if (manifest.precisionUse !== "blocked") fail("blocked model must keep precisionUse=blocked");
  if (manifest.metrics !== null) fail("blocked manifest must not carry production metrics as trusted output");
  console.log(`[vision-model] blocked as expected: ${manifest.reason ?? "no reason"}`);
  process.exit(0);
}

if (manifest.precisionUse !== "verified") fail("verified model requires precisionUse=verified");
const modelPath = path.join(root, manifest.modelPath ?? "");
const classesPath = path.join(root, manifest.classesPath ?? "");
const reportPath = path.join(root, manifest.reportPath ?? "");
for (const [label, file] of [["model", modelPath], ["classes", classesPath], ["report", reportPath]]) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`verified ${label} file missing`);
}
const digest = crypto.createHash("sha256").update(fs.readFileSync(modelPath)).digest("hex");
if (!manifest.modelSha256 || digest !== String(manifest.modelSha256).toLowerCase()) fail("model SHA-256 mismatch");

const classes = JSON.parse(fs.readFileSync(classesPath, "utf8"));
if (!Array.isArray(classes) || classes.length < 10 || !classes.includes("__unknown__")) {
  fail("classes must include champion classes plus __unknown__");
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const metrics = report.metrics ?? manifest.metrics ?? {};
const sessions = report.sessions ?? {};
if ((sessions.train ?? 0) < thresholds.minTrainSessions) fail("not enough train sessions");
if ((sessions.validation ?? 0) < thresholds.minValidationSessions) fail("not enough validation sessions");
if ((sessions.test ?? 0) < thresholds.minTestSessions) fail("not enough test sessions");
if ((metrics.minPerClassPrecision ?? 0) < thresholds.perClassPrecisionMin) fail("per-class precision gate failed");
if ((metrics.minPerClassRecall ?? 0) < thresholds.perClassRecallMin) fail("per-class recall gate failed");
if ((metrics.unknownRecall ?? 0) < thresholds.unknownRecallMin) fail("unknown rejection gate failed");
if ((metrics.boardExactAccuracy ?? 0) < thresholds.boardExactAccuracyMin) fail("board exact-composition gate failed");
if ((metrics.falseWriteRate ?? 1) > thresholds.falseWriteRateMax) fail("false-write gate failed");
if ((metrics.cpuP95Ms ?? Number.POSITIVE_INFINITY) > thresholds.cpuP95MsMax) fail("CPU latency gate failed");
if (report.splitUnit !== "session") fail("report must confirm session-level split");
if (report.currentSeasonOnly !== true || report.region !== "CN") fail("report dataset provenance mismatch");
console.log(`[vision-model] verified model ${manifest.id} passed production gates`);
