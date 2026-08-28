import "./v082.css";
import manifestJson from "../../vision/model-manifest.json";
import { buildPixelSlotMap, nearestPixelSlot, type PixelSlot } from "../../lib/slot-pixel";
import { selectBoardVisionLayout, type BoardVisionFrameState } from "../../lib/board-vision";
import { modelRuntimeAllowed, type VisionModelManifest } from "../../lib/vision-model";

const manifest = manifestJson as VisionModelManifest;
const MAX_BATCH_SAMPLES = 500;
const SAMPLE_INTERVAL_MS = 4500;
const MAX_LABEL_AGE_MS = 4500;
const SESSION_KEY = "tftgolden.vision.dataset.session.v082";

type CaptureFrame = {
  window_id: string;
  title: string;
  width: number;
  height: number;
  captured_at_ms: number;
  data_url: string;
};

type DatasetSample = {
  schemaVersion: 1;
  sessionId: string;
  capturedAt: number;
  sourceWindow: string;
  region: "CN";
  season: "S18";
  label: string;
  labelSource: "ocr-slot" | "manual-unknown";
  labelConfidence: number;
  zone: "board" | "bench";
  slotId: string;
  layoutId: string;
  imageDataUrl: string;
};

let sessionId = sessionStorage.getItem(SESSION_KEY) || newSessionId();
let samples: DatasetSample[] = [];
let latestObserved: BoardVisionFrameState | null = null;
let lastSaved = new Map<string, number>();
let autoCollect = true;
let collectUnknownOnce = false;
let exportCount = 0;

function newSessionId(): string {
  const id = `match-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("dataset_capture_decode_failed"));
    image.src = dataUrl;
  });
}

function cropSlot(image: HTMLImageElement, slot: PixelSlot): string | null {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
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

function canSave(key: string, capturedAt: number): boolean {
  const previous = lastSaved.get(key) ?? 0;
  return capturedAt - previous >= SAMPLE_INTERVAL_MS;
}

function pushSample(sample: DatasetSample) {
  if (samples.length >= MAX_BATCH_SAMPLES) samples.splice(0, samples.length - MAX_BATCH_SAMPLES + 1);
  samples.push(sample);
  lastSaved.set(`${sample.sessionId}:${sample.slotId}:${sample.label}`, sample.capturedAt);
}

function labeledSlots(slots: PixelSlot[], capturedAt: number) {
  if (!latestObserved || Math.abs(capturedAt - latestObserved.capturedAt) > MAX_LABEL_AGE_MS) return [];
  const entities = [...latestObserved.board.entities, ...latestObserved.bench.entities]
    .filter((entity) => entity.confidence >= 0.8);
  return entities.flatMap((entity) => {
    const slot = nearestPixelSlot(entity, slots, 0.08);
    return slot ? [{ slot, hero: entity.hero, confidence: entity.confidence }] : [];
  });
}

function render() {
  const status = byId<HTMLElement>("v082-model-status");
  const allowed = modelRuntimeAllowed(manifest);
  if (status) {
    status.textContent = allowed ? `ONNX ${manifest.id}：VERIFIED` : `ONNX ${manifest.id}：BLOCKED`;
    status.dataset.kind = allowed ? "ok" : "warn";
  }
  const batch = byId<HTMLElement>("v082-batch-status");
  if (batch) batch.textContent = `训练批次：${samples.length}/${MAX_BATCH_SAMPLES} 样本 · session ${sessionId.slice(-8)} · 已导出${exportCount}次`;
  const toggle = byId<HTMLButtonElement>("v082-auto-collect");
  if (toggle) {
    toggle.textContent = autoCollect ? "可信样本采集 ON" : "可信样本采集 OFF";
    toggle.dataset.enabled = autoCollect ? "1" : "0";
  }
  const unknown = byId<HTMLButtonElement>("v082-unknown-once");
  if (unknown) unknown.textContent = collectUnknownOnce ? "等待下一帧采集 UNKNOWN…" : "下一帧手工采 UNKNOWN";
  const exportButton = byId<HTMLButtonElement>("v082-export-batch");
  if (exportButton) exportButton.disabled = samples.length === 0;
}

function exportBatch() {
  if (!samples.length) return;
  const payload = {
    schemaVersion: 1,
    project: "TFTGOLDENCHANCHAN",
    region: "CN",
    season: "S18",
    splitUnit: "session",
    currentSeasonOnly: true,
    exportedAt: Date.now(),
    manifestId: manifest.id,
    samples
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tftgolden-v082-dataset-${Date.now()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  exportCount += 1;
  render();
}

async function collectFrame(frame: CaptureFrame) {
  if ((!autoCollect && !collectUnknownOnce) || !frame.data_url) return;
  const image = await imageFromDataUrl(frame.data_url);
  const layout = selectBoardVisionLayout({ width: image.naturalWidth, height: image.naturalHeight });
  if (!layout.supported) return;
  const slots = buildPixelSlotMap(layout);
  const labels = labeledSlots(slots, Number(frame.captured_at_ms));
  const occupied = new Set(labels.map(({ slot }) => slot.id));

  if (autoCollect) {
    for (const { slot, hero, confidence } of labels) {
      const key = `${sessionId}:${slot.id}:${hero}`;
      if (!canSave(key, Number(frame.captured_at_ms))) continue;
      const imageDataUrl = cropSlot(image, slot);
      if (!imageDataUrl) continue;
      pushSample({
        schemaVersion: 1,
        sessionId,
        capturedAt: Number(frame.captured_at_ms),
        sourceWindow: frame.window_id,
        region: "CN",
        season: "S18",
        label: hero,
        labelSource: "ocr-slot",
        labelConfidence: confidence,
        zone: slot.zone,
        slotId: slot.id,
        layoutId: layout.id,
        imageDataUrl
      });
    }
  }

  if (collectUnknownOnce) {
    collectUnknownOnce = false;
    const candidates = slots.filter((slot) => !occupied.has(slot.id)).slice(0, 8);
    for (const slot of candidates) {
      const imageDataUrl = cropSlot(image, slot);
      if (!imageDataUrl) continue;
      pushSample({
        schemaVersion: 1,
        sessionId,
        capturedAt: Number(frame.captured_at_ms),
        sourceWindow: frame.window_id,
        region: "CN",
        season: "S18",
        label: "__unknown__",
        labelSource: "manual-unknown",
        labelConfidence: 1,
        zone: slot.zone,
        slotId: slot.id,
        layoutId: layout.id,
        imageDataUrl
      });
    }
  }
  render();
}

function mountPanel() {
  if (byId("vision-model-v082")) return;
  const host = byId<HTMLElement>("vision-panel");
  if (!host) {
    window.setTimeout(mountPanel, 120);
    return;
  }
  const ruleStatus = host.querySelector(".v060-rule-status");
  const block = document.createElement("div");
  block.id = "vision-model-v082";
  block.className = "v082-block";
  block.innerHTML = `
    <div class="v082-head">
      <div>
        <strong>V0.8.2 ONNX DATA / GATE</strong>
        <span id="v082-model-status" data-kind="warn">读取模型门禁…</span>
      </div>
      <button id="v082-auto-collect" type="button"></button>
    </div>
    <div id="v082-batch-status" class="v082-batch">训练批次：0样本</div>
    <div class="v082-actions">
      <button id="v082-unknown-once" type="button">下一帧手工采 UNKNOWN</button>
      <button id="v082-export-batch" type="button" disabled>导出训练批次 JSON</button>
      <button id="v082-new-session" type="button">新训练 Session</button>
    </div>
    <small class="v082-note">自动样本只接受 V0.8 高置信 OCR + 槽位一致标签。UNKNOWN 只在你明确点击后采集未标注槽位。模型 manifest 未通过 session 级验证、误写率和 CPU 门禁前保持 BLOCKED，不参与自动写入。</small>
  `;
  host.insertBefore(block, ruleStatus ?? null);
  byId<HTMLButtonElement>("v082-auto-collect")?.addEventListener("click", () => {
    autoCollect = !autoCollect;
    render();
  });
  byId<HTMLButtonElement>("v082-unknown-once")?.addEventListener("click", () => {
    collectUnknownOnce = !collectUnknownOnce;
    render();
  });
  byId<HTMLButtonElement>("v082-export-batch")?.addEventListener("click", exportBatch);
  byId<HTMLButtonElement>("v082-new-session")?.addEventListener("click", () => {
    sessionId = newSessionId();
    lastSaved.clear();
    render();
  });
  byId<HTMLButtonElement>("reset-match")?.addEventListener("click", () => {
    window.setTimeout(() => {
      sessionId = newSessionId();
      lastSaved.clear();
      render();
    }, 0);
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
    if (frame?.data_url) void collectFrame(frame);
  });
}

boot();
