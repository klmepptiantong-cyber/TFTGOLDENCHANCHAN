import "./v081.css";
import {
  addPixelPrototype,
  buildPixelSlotMap,
  classifyPixelFeature,
  emptyPixelPrototypeStore,
  fusePixelFrames,
  nearestPixelSlot,
  safePixelCandidateReady,
  sanitizePixelPrototypeStore,
  type FusedPixelState,
  type PixelFeature,
  type PixelFrameState,
  type PixelPrototypeStore,
  type PixelSlot
} from "../../lib/slot-pixel";
import {
  selectBoardVisionLayout,
  type BoardVisionFrameState
} from "../../lib/board-vision";

const STORE_KEY = "tftgolden.vision.pixel.prototypes.v081";
const LEARN_KEY = "tftgolden.vision.pixel.autoLearn.v081";
const ANALYZE_INTERVAL_MS = 1400;
const LABEL_MAX_AGE_MS = 5000;

let store = loadStore();
let autoLearn = localStorage.getItem(LEARN_KEY) !== "false";
let latestObserved: BoardVisionFrameState | null = null;
let pixelFrames: PixelFrameState[] = [];
let fused: FusedPixelState = fusePixelFrames([]);
let lastAnalyzeAt = 0;
let analyzing = false;
let lastWindowId = "";
let clearArmedUntil = 0;

type CaptureFrame = {
  window_id: string;
  title: string;
  width: number;
  height: number;
  captured_at_ms: number;
  data_url: string;
};

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function loadStore(): PixelPrototypeStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? sanitizePixelPrototypeStore(JSON.parse(raw)) : emptyPixelPrototypeStore();
  } catch {
    return emptyPixelPrototypeStore();
  }
}

function persistStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function currentLevel(): number | null {
  const level = Number(byId<HTMLInputElement>("level")?.value);
  return Number.isInteger(level) && level >= 1 && level <= 10 ? level : null;
}

function prototypeStats(): { heroes: number; samples: number } {
  const values = Object.values(store.heroes);
  return {
    heroes: values.length,
    samples: values.reduce((sum, prototype) => sum + prototype.samples.length, 0)
  };
}

function parseUnits(value: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const token of value.split(/[，,;；\n]/).map((part) => part.trim()).filter(Boolean)) {
    const [hero, rawCopies] = token.split(/[=＝]/, 2);
    if (!hero?.trim()) continue;
    const copies = Number(rawCopies ?? "1");
    result[hero.trim()] = Number.isFinite(copies) && copies > 0 ? Math.max(1, Math.round(copies)) : 1;
  }
  return result;
}

function serializeUnits(value: Record<string, number>): string {
  return Object.entries(value)
    .filter(([, copies]) => copies > 0)
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([hero, copies]) => `${hero}=${copies}`)
    .join(", ");
}

function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("pixel_capture_decode_failed"));
    image.src = dataUrl;
  });
}

function extractPixelFeature(image: HTMLImageElement, slot: PixelSlot): PixelFeature | null {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;
  const x = Math.max(0, Math.floor((slot.cx - slot.width / 2) * sourceWidth));
  const y = Math.max(0, Math.floor((slot.cy - slot.height / 2) * sourceHeight));
  const width = Math.max(4, Math.min(sourceWidth - x, Math.ceil(slot.width * sourceWidth)));
  const height = Math.max(4, Math.min(sourceHeight - y, Math.ceil(slot.height * sourceHeight)));
  if (width <= 3 || height <= 3) return null;

  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

  const grid = 6;
  const vector: number[] = [];
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const x0 = Math.floor(gx * canvas.width / grid);
      const x1 = Math.floor((gx + 1) * canvas.width / grid);
      const y0 = Math.floor(gy * canvas.height / grid);
      const y1 = Math.floor((gy + 1) * canvas.height / grid);
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) {
          const index = (py * canvas.width + px) * 4;
          red += pixels[index];
          green += pixels[index + 1];
          blue += pixels[index + 2];
          count += 1;
        }
      }
      vector.push(red / Math.max(1, count) / 255, green / Math.max(1, count) / 255, blue / Math.max(1, count) / 255);
    }
  }

  let lumaSum = 0;
  let lumaSquared = 0;
  let saturationSum = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  for (let py = 0; py < canvas.height; py += 1) {
    for (let px = 0; px < canvas.width; px += 1) {
      const index = (py * canvas.width + px) * 4;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const luma = red * 0.299 + green * 0.587 + blue * 0.114;
      lumaSum += luma;
      lumaSquared += luma * luma;
      saturationSum += (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
      if (px + 1 < canvas.width) {
        const right = index + 4;
        const rightLuma = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
        edgeSum += Math.abs(luma - rightLuma);
        edgeCount += 1;
      }
      if (py + 1 < canvas.height) {
        const down = index + canvas.width * 4;
        const downLuma = pixels[down] * 0.299 + pixels[down + 1] * 0.587 + pixels[down + 2] * 0.114;
        edgeSum += Math.abs(luma - downLuma);
        edgeCount += 1;
      }
    }
  }
  const count = canvas.width * canvas.height;
  const mean = lumaSum / count;
  const variance = Math.max(0, lumaSquared / count - mean * mean);
  const std = Math.sqrt(variance);
  const saturation = saturationSum / count;
  const edge = edgeCount ? edgeSum / edgeCount : 0;
  const energy = clamp01(std / 72 * 0.42 + saturation * 0.34 + edge / 80 * 0.24);
  return { vector, energy };
}

function labelsAreFresh(capturedAt: number): boolean {
  if (!latestObserved) return false;
  return Math.abs(capturedAt - latestObserved.capturedAt) <= LABEL_MAX_AGE_MS;
}

function enrollFromOcr(
  capturedAt: number,
  slots: PixelSlot[],
  features: Map<string, PixelFeature>
): number {
  if (!autoLearn || !latestObserved || !labelsAreFresh(capturedAt)) return 0;
  let added = 0;
  const entities = [...latestObserved.board.entities, ...latestObserved.bench.entities];
  for (const entity of entities) {
    if (entity.confidence < 0.76) continue;
    const slot = nearestPixelSlot(entity, slots, 0.082);
    if (!slot) continue;
    const feature = features.get(slot.id);
    if (!feature || feature.energy < 0.18) continue;
    const next = addPixelPrototype(store, entity.hero, feature.vector, capturedAt);
    if (!next.added) continue;
    store = next.store;
    added += 1;
  }
  if (added) persistStore();
  return added;
}

function applyPixelCandidate(): boolean {
  if (!safePixelCandidateReady(fused)) return false;
  const input = byId<HTMLTextAreaElement>("units");
  if (!input || document.activeElement === input) return false;
  const existing = parseUnits(input.value);
  const next: Record<string, number> = {};
  for (const [hero, identities] of Object.entries(fused.board)) {
    next[hero] = Math.max(identities, existing[hero] ?? 0);
  }
  const serialized = serializeUnits(next);
  if (!serialized || serialized === input.value) return false;
  input.value = serialized;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function render() {
  const stats = prototypeStats();
  const status = byId<HTMLElement>("v081-status");
  if (status) {
    if (!stats.samples) {
      status.textContent = "等待高置信 OCR 自动采集当前赛季像素样本";
      status.dataset.kind = "warn";
    } else if (safePixelCandidateReady(fused)) {
      status.textContent = "像素候选已通过多帧安全门禁";
      status.dataset.kind = "ok";
    } else {
      status.textContent = "本地学习中 · 像素结果仅候选";
      status.dataset.kind = "warn";
    }
  }

  const statsNode = byId<HTMLElement>("v081-prototype-stats");
  if (statsNode) statsNode.textContent = `prototype：${stats.heroes}英雄 / ${stats.samples}样本`;
  const boardNode = byId<HTMLElement>("v081-pixel-board");
  if (boardNode) {
    const board = Object.entries(fused.board)
      .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
      .map(([hero, identities]) => identities > 1 ? `${hero}×${identities}` : hero)
      .join(" · ");
    boardNode.textContent = `场上像素：${board || "暂无可信候选"} · ${percent(fused.confidence)} · 稳定${fused.exactSamples}帧`;
  }
  const benchNode = byId<HTMLElement>("v081-pixel-bench");
  if (benchNode) {
    const bench = Object.entries(fused.bench)
      .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
      .map(([hero, identities]) => identities > 1 ? `${hero}×${identities}` : hero)
      .join(" · ");
    benchNode.textContent = `备战像素：${bench || "暂无可信候选"}`;
  }

  const learnButton = byId<HTMLButtonElement>("v081-auto-learn");
  if (learnButton) {
    learnButton.textContent = autoLearn ? "OCR→像素学习 ON" : "OCR→像素学习 OFF";
    learnButton.dataset.enabled = autoLearn ? "1" : "0";
  }
  const applyButton = byId<HTMLButtonElement>("v081-apply-pixel");
  if (applyButton) applyButton.disabled = !safePixelCandidateReady(fused);
}

function mountPanel() {
  if (byId("slot-pixel-v081")) return;
  const host = byId<HTMLElement>("vision-panel");
  if (!host) {
    window.setTimeout(mountPanel, 120);
    return;
  }
  const ruleStatus = host.querySelector(".v060-rule-status");
  const block = document.createElement("div");
  block.id = "slot-pixel-v081";
  block.className = "v081-block";
  block.innerHTML = `
    <div class="v081-head">
      <div>
        <strong>V0.8.1 SLOT PIXEL</strong>
        <span id="v081-status" data-kind="warn">初始化本地像素学习…</span>
      </div>
      <button id="v081-auto-learn" type="button"></button>
    </div>
    <div class="v081-states">
      <div id="v081-prototype-stats">prototype：0英雄 / 0样本</div>
      <div id="v081-pixel-board">场上像素：暂无可信候选</div>
      <div id="v081-pixel-bench">备战像素：暂无可信候选</div>
    </div>
    <div class="v081-actions">
      <button id="v081-apply-pixel" type="button" disabled>应用场上像素候选</button>
      <button id="v081-clear-learning" type="button">清空本地像素学习</button>
    </div>
    <small class="v081-note">当前为自举 prototype 分类器：只用你本机当前国服截图学习。应用按钮仅在场上可信身份数=人口、同一槽位结果连续≥3帧且融合置信度≥82%时开放；不会自动覆盖。</small>
  `;
  host.insertBefore(block, ruleStatus ?? null);

  byId<HTMLButtonElement>("v081-auto-learn")?.addEventListener("click", () => {
    autoLearn = !autoLearn;
    localStorage.setItem(LEARN_KEY, String(autoLearn));
    render();
  });
  byId<HTMLButtonElement>("v081-apply-pixel")?.addEventListener("click", () => {
    if (applyPixelCandidate()) byId<HTMLButtonElement>("decide")?.click();
  });
  byId<HTMLButtonElement>("v081-clear-learning")?.addEventListener("click", () => {
    const now = Date.now();
    const button = byId<HTMLButtonElement>("v081-clear-learning");
    if (now > clearArmedUntil) {
      clearArmedUntil = now + 2500;
      if (button) button.textContent = "再次点击确认清空";
      window.setTimeout(() => {
        if (Date.now() >= clearArmedUntil && button) button.textContent = "清空本地像素学习";
      }, 2600);
      return;
    }
    clearArmedUntil = 0;
    store = emptyPixelPrototypeStore();
    pixelFrames = [];
    fused = fusePixelFrames([]);
    localStorage.removeItem(STORE_KEY);
    if (button) button.textContent = "清空本地像素学习";
    render();
  });
  render();
}

async function analyzeCapture(frame: CaptureFrame) {
  if (analyzing || !frame.data_url) return;
  analyzing = true;
  try {
    const image = await imageFromDataUrl(frame.data_url);
    const layout = selectBoardVisionLayout({ width: image.naturalWidth, height: image.naturalHeight });
    if (!layout.supported) return;
    const slots = buildPixelSlotMap(layout);
    const features = new Map<string, PixelFeature>();
    for (const slot of slots) {
      const feature = extractPixelFeature(image, slot);
      if (feature) features.set(slot.id, feature);
    }

    enrollFromOcr(Number(frame.captured_at_ms), slots, features);
    const predictions = slots
      .map((slot) => {
        const feature = features.get(slot.id);
        return feature ? classifyPixelFeature(slot, feature, store) : null;
      })
      .filter((prediction): prediction is NonNullable<typeof prediction> => prediction !== null);

    pixelFrames.push({
      capturedAt: Number(frame.captured_at_ms),
      layoutId: layout.id,
      expectedLevel: currentLevel(),
      predictions
    });
    if (pixelFrames.length > 8) pixelFrames.splice(0, pixelFrames.length - 8);
    fused = fusePixelFrames(pixelFrames);
    render();
    window.dispatchEvent(new CustomEvent("tft-slot-pixel-state", {
      detail: { predictions, fused, prototypeStats: prototypeStats() }
    }));
  } finally {
    analyzing = false;
  }
}

function onCapture(event: Event) {
  const frame = (event as CustomEvent<CaptureFrame>).detail;
  if (!frame?.window_id || !frame.data_url) return;
  if (lastWindowId && frame.window_id !== lastWindowId) {
    pixelFrames = [];
    fused = fusePixelFrames([]);
  }
  lastWindowId = frame.window_id;
  const now = Date.now();
  if (now - lastAnalyzeAt < ANALYZE_INTERVAL_MS) return;
  lastAnalyzeAt = now;
  void analyzeCapture(frame);
}

function onBoardVision(event: Event) {
  const detail = (event as CustomEvent<{ observed?: BoardVisionFrameState }>).detail;
  if (detail?.observed) latestObserved = detail.observed;
}

function boot() {
  mountPanel();
  window.addEventListener("tft-vision-frame", onCapture);
  window.addEventListener("tft-board-vision-state", onBoardVision);
}

boot();
