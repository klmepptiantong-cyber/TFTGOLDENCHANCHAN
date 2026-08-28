import "./v061.css";
import embeddedSnapshotJson from "../../data/latest.json";
import type { MetaSnapshot } from "../../lib/types";
import {
  fuseCategorical,
  fuseNumber,
  fuseStringList,
  TemporalVisionBuffer
} from "../../lib/vision";
import {
  recognizeFrameState,
  toVisionObservation,
  type OcrFrame,
  type RecognizedFrameState
} from "../../lib/recognition";

type VisionTauriGlobal = {
  core?: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
};

type CaptureFrame = {
  window_id: string;
  title: string;
  width: number;
  height: number;
  captured_at_ms: number;
  data_url: string;
};

type OcrModelStatus = {
  ready: boolean;
  model_dir: string;
  detection_ready: boolean;
  recognition_ready: boolean;
  dictionary_ready: boolean;
  detection_bytes: number;
  recognition_bytes: number;
  dictionary_bytes: number;
};

type FusedPatch = {
  stage?: { value: string; confidence: number; samples: number };
  level?: { value: number; confidence: number; samples: number };
  gold?: { value: number; confidence: number; samples: number };
  hp?: { value: number; confidence: number; samples: number };
  shop?: { value: string[]; confidence: number; samples: number };
};

const SNAPSHOT_URL = "https://raw.githubusercontent.com/klmepptiantong-cyber/TFTGOLDENCHANCHAN/main/data/latest.json";
const OCR_INTERVAL_MS = 2200;
const AUTO_APPLY_KEY = "tftgolden.vision.ocr.autoApply.v061";
const embeddedSnapshot = embeddedSnapshotJson as unknown as MetaSnapshot;
const visionBuffer = new TemporalVisionBuffer(7);

let catalogHeroes = heroesFromSnapshot(embeddedSnapshot);
let autoApply = localStorage.getItem(AUTO_APPLY_KEY) !== "false";
let modelsReady = false;
let modelPreparing = false;
let ocrBusy = false;
let lastOcrAt = 0;
let lastWindowId = "";
let lastAppliedShop = "";
let ocrFrames = 0;

function tauriGlobal(): VisionTauriGlobal | undefined {
  return (window as Window & { __TAURI__?: VisionTauriGlobal }).__TAURI__;
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const fn = tauriGlobal()?.core?.invoke;
  if (!fn) return Promise.reject(new Error("tauri_unavailable"));
  return fn<T>(command, args);
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function heroesFromSnapshot(snapshot: MetaSnapshot): string[] {
  const heroes = new Set<string>();
  for (const comp of snapshot.comps ?? []) {
    for (const unit of comp.sourceLineup ?? []) if (unit.name) heroes.add(unit.name);
    for (const name of comp.coreUnits ?? []) if (name) heroes.add(name);
    for (const name of comp.flexUnits ?? []) if (name) heroes.add(name);
  }
  return [...heroes].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

async function refreshHeroCatalog() {
  try {
    const response = await fetch(`${SNAPSHOT_URL}?ocr=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const snapshot = await response.json() as MetaSnapshot;
    const heroes = heroesFromSnapshot(snapshot);
    if (heroes.length >= 20) catalogHeroes = heroes;
  } catch {
    // Embedded catalog remains available offline.
  }
}

function mountOcrPanel() {
  if (byId("ocr-v061")) return;
  const host = byId<HTMLElement>("vision-panel");
  if (!host) return;
  const ruleStatus = host.querySelector(".v060-rule-status");
  const block = document.createElement("div");
  block.id = "ocr-v061";
  block.className = "v061-block";
  block.innerHTML = `
    <div class="v061-head">
      <div>
        <strong>V0.6.1 LOCAL OCR</strong>
        <span id="ocr-model-status" data-kind="warn">检查本地模型…</span>
      </div>
      <button id="ocr-auto-apply" type="button"></button>
    </div>
    <div id="ocr-live-state" class="v061-live-state">等待 OCR 第一帧…</div>
    <div class="v061-meta">
      <span id="ocr-latency">0 OCR frames</span>
      <span>截图仅在本机识别</span>
    </div>
  `;
  host.insertBefore(block, ruleStatus ?? null);
  byId<HTMLButtonElement>("ocr-auto-apply")?.addEventListener("click", () => {
    autoApply = !autoApply;
    localStorage.setItem(AUTO_APPLY_KEY, String(autoApply));
    renderAutoApply();
  });
  renderAutoApply();
}

function renderAutoApply() {
  const button = byId<HTMLButtonElement>("ocr-auto-apply");
  if (!button) return;
  button.textContent = autoApply ? "自动写入 ON" : "自动写入 OFF";
  button.dataset.enabled = autoApply ? "1" : "0";
}

function setModelStatus(text: string, kind: "ok" | "warn" | "error" = "warn") {
  const node = byId<HTMLElement>("ocr-model-status");
  if (!node) return;
  node.textContent = text;
  node.dataset.kind = kind;
}

async function ensureModels() {
  if (modelsReady || modelPreparing) return;
  modelPreparing = true;
  try {
    const status = await invoke<OcrModelStatus>("ocr_model_status");
    if (status.ready) {
      modelsReady = true;
      setModelStatus("PP-OCRv5 READY · 本地", "ok");
      return;
    }
    setModelStatus("首次准备 OCR 模型约 22MB…", "warn");
    const prepared = await invoke<OcrModelStatus>("prepare_ocr_models");
    modelsReady = prepared.ready;
    setModelStatus(
      prepared.ready ? "PP-OCRv5 READY · SHA256 已校验" : "OCR 模型未完整",
      prepared.ready ? "ok" : "error"
    );
  } catch (error) {
    modelsReady = false;
    setModelStatus(`OCR 模型错误：${String(error)}`, "error");
  } finally {
    modelPreparing = false;
  }
}

function pushRecognized(recognized: RecognizedFrameState, capturedAt: number) {
  if (recognized.stage && recognized.stage.confidence >= 0.45) {
    visionBuffer.push("stage", toVisionObservation(recognized.stage, capturedAt));
  }
  if (recognized.level && recognized.level.confidence >= 0.42) {
    visionBuffer.push("level", toVisionObservation(recognized.level, capturedAt));
  }
  if (recognized.gold && recognized.gold.confidence >= 0.42) {
    visionBuffer.push("gold", toVisionObservation(recognized.gold, capturedAt));
  }
  if (recognized.hp && recognized.hp.confidence >= 0.5) {
    visionBuffer.push("hp", toVisionObservation(recognized.hp, capturedAt));
  }
  if (recognized.shop && recognized.shop.confidence >= 0.6) {
    visionBuffer.push("shop", toVisionObservation(recognized.shop, capturedAt));
  }
}

function fusedPatch(): FusedPatch {
  const state = visionBuffer.snapshot();
  const stage = fuseCategorical(state.stage ?? [], { halfLifeMs: 4500, maxAgeMs: 12_000 });
  const level = fuseNumber(state.level ?? [], { halfLifeMs: 4500, maxAgeMs: 12_000 });
  const gold = fuseNumber(state.gold ?? [], { halfLifeMs: 3000, maxAgeMs: 9000 });
  const hp = fuseNumber(state.hp ?? [], { halfLifeMs: 5000, maxAgeMs: 15_000 });
  const shop = fuseStringList(state.shop ?? [], { halfLifeMs: 2800, maxAgeMs: 8000 });
  const result: FusedPatch = {};
  if (stage.value !== null) result.stage = { value: stage.value, confidence: stage.confidence, samples: stage.samples };
  if (level.value !== null) result.level = { value: level.value, confidence: level.confidence, samples: level.samples };
  if (gold.value !== null) result.gold = { value: gold.value, confidence: gold.confidence, samples: gold.samples };
  if (hp.value !== null) result.hp = { value: hp.value, confidence: hp.confidence, samples: hp.samples };
  if (shop.value !== null) result.shop = { value: shop.value, confidence: shop.confidence, samples: shop.samples };
  return result;
}

function fieldSummary<T>(label: string, field: { value: T; samples: number } | undefined): string {
  if (!field) return `${label} ?`;
  const value = Array.isArray(field.value) ? field.value.join("/") : String(field.value);
  return `${label} ${value} (${field.samples}帧)`;
}

function renderFused(patch: FusedPatch, frame: OcrFrame) {
  const state = byId<HTMLElement>("ocr-live-state");
  if (state) {
    state.textContent = [
      fieldSummary("阶段", patch.stage),
      fieldSummary("人口", patch.level),
      fieldSummary("金币", patch.gold),
      fieldSummary("HP", patch.hp),
      fieldSummary("商店", patch.shop)
    ].join(" · ");
  }
  const latency = byId<HTMLElement>("ocr-latency");
  if (latency) latency.textContent = `${frame.elapsed_ms}ms · ${frame.blocks.length}文本 · OCR ${ocrFrames}`;
}

function updateInput(id: "stage" | "level" | "gold" | "hp", value: string | number): boolean {
  const input = byId<HTMLInputElement>(id);
  if (!input || document.activeElement === input) return false;
  const next = String(value);
  if (input.value === next) return false;
  input.value = next;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function pickerTileForHero(hero: string): HTMLButtonElement | null {
  for (const tile of document.querySelectorAll<HTMLButtonElement>("#picker-grid .picker-tile.hero-tile")) {
    const name = tile.querySelector<HTMLElement>(".picker-name")?.textContent?.trim();
    if (name === hero) return tile;
  }
  return null;
}

function applyFullShop(shop: string[]): boolean {
  if (shop.length !== 5 || shop.some((hero) => !hero)) return false;
  const dialog = byId<HTMLDialogElement>("picker-dialog");
  if (!dialog || dialog.open) return false;
  const signature = JSON.stringify(shop);
  if (signature === lastAppliedShop) return false;

  const clear = byId<HTMLButtonElement>("clear-shop");
  const firstSlot = document.querySelector<HTMLButtonElement>('.shop-slot[data-slot="0"]');
  if (!clear || !firstSlot) return false;

  document.documentElement.classList.add("ocr-dom-applying");
  try {
    clear.click();
    firstSlot.click();
    for (const hero of shop) {
      const tile = pickerTileForHero(hero);
      if (!tile) {
        dialog.close();
        return false;
      }
      tile.click();
    }
    if (dialog.open) dialog.close();
    lastAppliedShop = signature;
    return true;
  } finally {
    document.documentElement.classList.remove("ocr-dom-applying");
  }
}

function applyFused(patch: FusedPatch) {
  if (!autoApply) return;
  let changed = false;
  if (patch.stage && patch.stage.samples >= 2 && patch.stage.confidence >= 0.68) {
    changed = updateInput("stage", patch.stage.value) || changed;
  }
  if (patch.level && patch.level.samples >= 2 && patch.level.confidence >= 0.7) {
    changed = updateInput("level", patch.level.value) || changed;
  }
  if (patch.gold && patch.gold.samples >= 2 && patch.gold.confidence >= 0.72) {
    changed = updateInput("gold", patch.gold.value) || changed;
  }
  if (patch.hp && patch.hp.samples >= 2 && patch.hp.confidence >= 0.78) {
    changed = updateInput("hp", patch.hp.value) || changed;
  }
  if (patch.shop && patch.shop.samples >= 2 && patch.shop.confidence >= 0.76) {
    changed = applyFullShop(patch.shop.value) || changed;
  }
  if (changed) byId<HTMLButtonElement>("decide")?.click();
}

async function runOcr(windowId: string) {
  if (!modelsReady || ocrBusy) return;
  ocrBusy = true;
  try {
    const frame = await invoke<OcrFrame>("ocr_window_frame", { windowId, maxWidth: 1280 });
    ocrFrames += 1;
    const recognized = recognizeFrameState(frame, { heroes: catalogHeroes });
    pushRecognized(recognized, Number(frame.captured_at_ms));
    const patch = fusedPatch();
    renderFused(patch, frame);
    applyFused(patch);
    window.dispatchEvent(new CustomEvent("tft-vision-state", { detail: { frame, recognized, fused: patch } }));
  } catch (error) {
    setModelStatus(`OCR 运行错误：${String(error)}`, "error");
  } finally {
    ocrBusy = false;
  }
}

function onCapture(event: Event) {
  const frame = (event as CustomEvent<CaptureFrame>).detail;
  if (!frame?.window_id) return;
  if (lastWindowId && lastWindowId !== frame.window_id) {
    visionBuffer.clear();
    lastAppliedShop = "";
  }
  lastWindowId = frame.window_id;
  if (!modelsReady) return;
  const now = Date.now();
  if (now - lastOcrAt < OCR_INTERVAL_MS) return;
  lastOcrAt = now;
  void runOcr(frame.window_id);
}

async function boot() {
  mountOcrPanel();
  window.addEventListener("tft-vision-frame", onCapture);
  await refreshHeroCatalog();
  window.setInterval(() => void refreshHeroCatalog(), 15 * 60 * 1000);
  await ensureModels();
}

void boot();
