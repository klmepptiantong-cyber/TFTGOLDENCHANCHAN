import "./v083.css";
import {
  analyzeVisionDataset,
  type VisionBoardValidationSnapshot,
  type VisionDatasetBatch,
  type VisionDatasetQaResult
} from "../../lib/vision-dataset";
import { buildPixelSlotMap, nearestPixelSlot, type PixelSlot } from "../../lib/slot-pixel";
import { selectBoardVisionLayout, type BoardVisionFrameState } from "../../lib/board-vision";

const SESSION_KEY = "tftgolden.vision.dataset.session.v082";

type CaptureFrame = {
  window_id: string;
  title: string;
  width: number;
  height: number;
  captured_at_ms: number;
  data_url: string;
};

let importedBatches: unknown[] = [];
let boardSnapshots: VisionBoardValidationSnapshot[] = [];
let qa: VisionDatasetQaResult = analyzeVisionDataset([]);
let latestObserved: BoardVisionFrameState | null = null;
let validationCaptureArmed = false;
let importing = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function currentSessionId(): string {
  return sessionStorage.getItem(SESSION_KEY) || `qa-${Date.now()}`;
}

function currentInputs(): unknown[] {
  if (!boardSnapshots.length) return importedBatches;
  const validationBatch: VisionDatasetBatch = {
    schemaVersion: 2,
    project: "TFTGOLDENCHANCHAN",
    region: "CN",
    season: "S18",
    splitUnit: "session",
    currentSeasonOnly: true,
    exportedAt: Date.now(),
    samples: [],
    boardSnapshots
  };
  return [...importedBatches, validationBatch];
}

function refreshQa() {
  qa = analyzeVisionDataset(currentInputs());
  render();
}

function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("qa_capture_decode_failed"));
    image.src = dataUrl;
  });
}

function cropSlot(image: HTMLImageElement, slot: PixelSlot): string | null {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;
  const sx = Math.max(0, Math.floor((slot.cx - slot.width * 0.62) * sourceWidth));
  const sy = Math.max(0, Math.floor((slot.cy - slot.height * 0.76) * sourceHeight));
  const sw = Math.max(8, Math.min(sourceWidth - sx, Math.ceil(slot.width * 1.24 * sourceWidth)));
  const sh = Math.max(8, Math.min(sourceHeight - sy, Math.ceil(slot.height * 1.35 * sourceHeight)));
  if (sw <= 7 || sh <= 7) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, sx, sy, sw, sh, 0, 0, 128, 128);
  return canvas.toDataURL("image/png");
}

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function render() {
  const report = qa.report;
  const status = byId<HTMLElement>("v083-qa-status");
  if (status) {
    if (!importedBatches.length && !boardSnapshots.length) {
      status.textContent = "等待导入 V0.8.2 数据批次";
      status.dataset.kind = "warn";
    } else if (report.conflictingFingerprints || report.crossSessionDuplicateFingerprints) {
      status.textContent = "BLOCKED：存在标签冲突 / 跨 Session 重复";
      status.dataset.kind = "bad";
    } else if (report.productionCoverageReady) {
      status.textContent = "数据覆盖达到生产评估数量门槛";
      status.dataset.kind = "ok";
    } else if (report.candidateTrainingReady) {
      status.textContent = "可训练候选模型 · 尚未达到生产覆盖";
      status.dataset.kind = "ok";
    } else {
      status.textContent = "数据积累中 · 尚未达到候选训练门槛";
      status.dataset.kind = "warn";
    }
  }

  const summary = byId<HTMLElement>("v083-qa-summary");
  if (summary) {
    summary.textContent = `批次${report.inputBatches} · Session ${report.sessions} · 有效样本${report.acceptedSamples} · 标签${report.labels} · UNKNOWN ${report.unknownSamples}/${report.unknownSessions}局`;
  }
  const leakage = byId<HTMLElement>("v083-qa-leakage");
  if (leakage) {
    leakage.textContent = `冲突指纹${report.conflictingFingerprints} · 跨Session重复${report.crossSessionDuplicateFingerprints} · 精确重复${report.exactDuplicateSamples} · 拒绝${report.rejectedSamples}`;
  }
  const board = byId<HTMLElement>("v083-board-validation");
  if (board) board.textContent = `整盘验证快照：${report.validBoardSnapshots} · 当前本机新增${boardSnapshots.length}`;

  const coverage = byId<HTMLElement>("v083-label-coverage");
  if (coverage) {
    const lowest = Object.entries(report.perLabel)
      .filter(([label]) => label !== "__unknown__")
      .sort(([, a], [, b]) => a.sessions - b.sessions || a.samples - b.samples)
      .slice(0, 6)
      .map(([label, value]) => `${label}:${value.sessions}局/${value.samples}图/${percent(value.averageConfidence)}`)
      .join(" · ");
    coverage.textContent = lowest ? `低覆盖标签：${lowest}` : "低覆盖标签：暂无数据";
  }

  const importButton = byId<HTMLButtonElement>("v083-import");
  if (importButton) importButton.disabled = importing;
  const cleanButton = byId<HTMLButtonElement>("v083-export-clean");
  if (cleanButton) cleanButton.disabled = report.acceptedSamples === 0 && report.validBoardSnapshots === 0;
  const reportButton = byId<HTMLButtonElement>("v083-export-report");
  if (reportButton) reportButton.disabled = report.inputBatches === 0 && report.validBoardSnapshots === 0;
  const validationButton = byId<HTMLButtonElement>("v083-capture-board");
  if (validationButton) validationButton.textContent = validationCaptureArmed ? "等待完整棋盘下一帧…" : "采一帧整盘验证";
}

async function importFiles(files: FileList | null) {
  if (!files?.length || importing) return;
  importing = true;
  render();
  try {
    const parsed: unknown[] = [];
    for (const file of Array.from(files)) {
      try {
        parsed.push(JSON.parse(await file.text()));
      } catch {
        parsed.push({ invalidFile: file.name });
      }
    }
    importedBatches.push(...parsed);
    refreshQa();
  } finally {
    importing = false;
    render();
  }
}

async function captureValidationBoard(frame: CaptureFrame) {
  if (!validationCaptureArmed || !latestObserved || !latestObserved.board.complete) return;
  const expectedLevel = latestObserved.board.expectedSlots;
  const entities = latestObserved.board.entities;
  if (!expectedLevel || entities.length !== expectedLevel) return;

  const image = await imageFromDataUrl(frame.data_url);
  const layout = selectBoardVisionLayout({ width: image.naturalWidth, height: image.naturalHeight });
  if (!layout.supported) return;
  const slots = buildPixelSlotMap(layout).filter((slot) => slot.zone === "board");
  const used = new Set<string>();
  const units: VisionBoardValidationSnapshot["units"] = [];

  for (const entity of entities) {
    if (entity.confidence < 0.82) return;
    const slot = nearestPixelSlot(entity, slots, 0.078);
    if (!slot || used.has(slot.id)) return;
    const imageDataUrl = cropSlot(image, slot);
    if (!imageDataUrl) return;
    used.add(slot.id);
    units.push({ slotId: slot.id, label: entity.hero, imageDataUrl });
  }
  if (units.length !== expectedLevel) return;

  validationCaptureArmed = false;
  boardSnapshots.push({
    schemaVersion: 1,
    snapshotId: `board-${currentSessionId()}-${Number(frame.captured_at_ms)}`,
    sessionId: currentSessionId(),
    capturedAt: Number(frame.captured_at_ms),
    expectedLevel,
    layoutId: layout.id,
    units
  });
  refreshQa();
}

function mountPanel() {
  if (byId("dataset-qa-v083")) return;
  const host = byId<HTMLElement>("vision-panel");
  if (!host) {
    window.setTimeout(mountPanel, 120);
    return;
  }
  const ruleStatus = host.querySelector(".v060-rule-status");
  const block = document.createElement("div");
  block.id = "dataset-qa-v083";
  block.className = "v083-block";
  block.innerHTML = `
    <div class="v083-head">
      <div>
        <strong>V0.8.3 DATA QA / EVAL</strong>
        <span id="v083-qa-status" data-kind="warn">初始化数据质检…</span>
      </div>
      <button id="v083-import" type="button">导入批次</button>
      <input id="v083-files" type="file" accept="application/json,.json" multiple hidden />
    </div>
    <div class="v083-states">
      <div id="v083-qa-summary">批次0 · Session 0 · 有效样本0</div>
      <div id="v083-qa-leakage">冲突指纹0 · 跨Session重复0</div>
      <div id="v083-board-validation">整盘验证快照：0</div>
      <div id="v083-label-coverage">低覆盖标签：暂无数据</div>
    </div>
    <div class="v083-actions">
      <button id="v083-capture-board" type="button">采一帧整盘验证</button>
      <button id="v083-export-clean" type="button" disabled>导出清洗数据集</button>
      <button id="v083-export-report" type="button" disabled>导出 QA 报告</button>
      <button id="v083-clear" type="button">清空本次QA</button>
    </div>
    <small class="v083-note">兼容 V0.8.2 JSON。完全相同 crop 的冲突标签与跨 Session 重复会从清洗数据中剔除；整盘验证只在 V0.8 Board Vision 已确认完整人口且每个英雄置信度≥82%时采集。</small>
  `;
  host.insertBefore(block, ruleStatus ?? null);

  const input = byId<HTMLInputElement>("v083-files");
  byId<HTMLButtonElement>("v083-import")?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", () => {
    void importFiles(input.files);
    input.value = "";
  });
  byId<HTMLButtonElement>("v083-capture-board")?.addEventListener("click", () => {
    validationCaptureArmed = !validationCaptureArmed;
    render();
  });
  byId<HTMLButtonElement>("v083-export-clean")?.addEventListener("click", () => {
    downloadJson(`tftgolden-v083-clean-${Date.now()}.json`, qa.cleaned);
  });
  byId<HTMLButtonElement>("v083-export-report")?.addEventListener("click", () => {
    downloadJson(`tftgolden-v083-qa-${Date.now()}.json`, qa.report);
  });
  byId<HTMLButtonElement>("v083-clear")?.addEventListener("click", () => {
    importedBatches = [];
    boardSnapshots = [];
    validationCaptureArmed = false;
    refreshQa();
  });
  render();
}

function boot() {
  mountPanel();
  window.addEventListener("tft-board-vision-state", (event) => {
    const detail = (event as CustomEvent<{ observed?: BoardVisionFrameState }>).detail;
    if (detail?.observed) latestObserved = detail.observed;
  });
  window.addEventListener("tft-vision-frame", (event) => {
    const frame = (event as CustomEvent<CaptureFrame>).detail;
    if (frame?.data_url && validationCaptureArmed) void captureValidationBoard(frame);
  });
}

boot();
