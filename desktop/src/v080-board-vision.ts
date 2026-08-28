import "./v080.css";
import embeddedSnapshotJson from "../../data/latest.json";
import {
  fuseBoardVisionFrames,
  recognizeBoardVisionFrame,
  safeBoardAutoApplyReady,
  selectBoardVisionLayout,
  type BoardVisionCatalog,
  type BoardVisionFrameState,
  type FusedBoardVisionState,
  type NormalizedRect
} from "../../lib/board-vision";
import type { OcrFrame } from "../../lib/recognition";
import type { MetaSnapshot } from "../../lib/types";

const SNAPSHOT_URL = "https://raw.githubusercontent.com/klmepptiantong-cyber/TFTGOLDENCHANCHAN/main/data/latest.json";
const AUTO_KEY = "tftgolden.vision.board.autoApply.v080";
const embeddedSnapshot = embeddedSnapshotJson as unknown as MetaSnapshot;

let snapshot = embeddedSnapshot;
let catalog = catalogFromSnapshot(snapshot);
let frames: BoardVisionFrameState[] = [];
let fused = fuseBoardVisionFrames([]);
let autoBoard = localStorage.getItem(AUTO_KEY) !== "false";
let lastWindowId = "";
let lastAutoAppliedBoard = "";

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function catalogFromSnapshot(value: MetaSnapshot): BoardVisionCatalog {
  const heroes = new Set<string>();
  const items = new Set<string>();
  for (const comp of value.comps ?? []) {
    for (const unit of comp.sourceLineup ?? []) if (unit.name) heroes.add(unit.name);
    for (const name of comp.coreUnits ?? []) if (name) heroes.add(name);
    for (const name of comp.flexUnits ?? []) if (name) heroes.add(name);
    for (const item of comp.keyItems ?? []) if (item) items.add(item);
    for (const list of Object.values(comp.sourceEquipmentNamesByHero ?? {})) {
      for (const item of list) if (item) items.add(item);
    }
  }
  return {
    heroes: [...heroes].sort((a, b) => a.localeCompare(b, "zh-CN")),
    items: [...items].sort((a, b) => a.localeCompare(b, "zh-CN"))
  };
}

async function refreshCatalog() {
  try {
    const response = await fetch(`${SNAPSHOT_URL}?board=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const candidate = await response.json() as MetaSnapshot;
    if (!candidate?.comps?.length) return;
    snapshot = candidate;
    catalog = catalogFromSnapshot(snapshot);
  } catch {
    // Embedded snapshot remains available offline.
  }
}

function currentLevel(): number | undefined {
  const value = Number(byId<HTMLInputElement>("level")?.value);
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : undefined;
}

function serializeUnits(units: Record<string, number>): string {
  return Object.entries(units)
    .filter(([, copies]) => copies > 0)
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([hero, copies]) => `${hero}=${copies}`)
    .join(", ");
}

function parseList(value: string): string[] {
  return value
    .split(/[，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEquipped(value: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const token of value.split(/[;；\n]/).map((item) => item.trim()).filter(Boolean)) {
    const [hero, rawItems] = token.split(/[:：]/, 2);
    if (!hero?.trim() || !rawItems?.trim()) continue;
    result[hero.trim()] = rawItems
      .split(/[\/、,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return result;
}

function serializeEquipped(value: Record<string, string[]>): string {
  return Object.entries(value)
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([hero, items]) => `${hero}:${[...new Set(items)].join("/")}`)
    .join("; ");
}

function updateTextarea(id: "units" | "bench" | "items" | "equipped", value: string): boolean {
  const input = byId<HTMLTextAreaElement>(id);
  if (!input || document.activeElement === input || input.value === value) return false;
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function applyBoardCandidate(): boolean {
  if (!Object.keys(fused.board.units).length) return false;
  return updateTextarea("units", serializeUnits(fused.board.units));
}

function applyBenchCandidate(): boolean {
  if (!Object.keys(fused.bench.units).length) return false;
  return updateTextarea("bench", serializeUnits(fused.bench.units));
}

function mergeItemCandidates(): boolean {
  if (!fused.looseItems.length) return false;
  const input = byId<HTMLTextAreaElement>("items");
  if (!input || document.activeElement === input) return false;
  const existing = parseList(input.value);
  const merged = [...existing];
  for (const item of fused.looseItems) if (!merged.includes(item)) merged.push(item);
  return updateTextarea("items", merged.join(", "));
}

function mergeEquippedCandidates(): boolean {
  if (!Object.keys(fused.equippedItems).length) return false;
  const input = byId<HTMLTextAreaElement>("equipped");
  if (!input || document.activeElement === input) return false;
  const existing = parseEquipped(input.value);
  for (const [hero, items] of Object.entries(fused.equippedItems)) {
    const merged = existing[hero] ?? [];
    for (const item of items) if (!merged.includes(item)) merged.push(item);
    existing[hero] = merged;
  }
  return updateTextarea("equipped", serializeEquipped(existing));
}

function boardSignature(state: FusedBoardVisionState): string {
  return JSON.stringify(Object.entries(state.board.units).sort(([a], [b]) => a.localeCompare(b, "zh-CN")));
}

function maybeAutoApplyBoard() {
  if (!autoBoard || !safeBoardAutoApplyReady(fused)) return;
  const signature = boardSignature(fused);
  if (!signature || signature === lastAutoAppliedBoard) return;
  if (applyBoardCandidate()) {
    lastAutoAppliedBoard = signature;
    byId<HTMLButtonElement>("decide")?.click();
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function renderUnitSummary(units: Record<string, number>): string {
  const rows = Object.entries(units)
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([hero, copies]) => `${hero}${copies === 3 ? " 2★" : copies === 9 ? " 3★" : copies > 1 ? `×${copies}` : ""}`);
  return rows.length ? rows.join(" · ") : "暂无可靠候选";
}

function renderState() {
  const board = byId<HTMLElement>("v080-board-state");
  if (board) {
    const slots = fused.board.expectedSlots ? ` · ${Object.keys(fused.board.units).length}/${fused.board.expectedSlots}身份` : "";
    board.textContent = `场上：${renderUnitSummary(fused.board.units)}${slots} · ${percent(fused.board.confidence)} · 稳定${fused.board.exactSamples}帧`;
  }
  const bench = byId<HTMLElement>("v080-bench-state");
  if (bench) bench.textContent = `备战：${renderUnitSummary(fused.bench.units)} · ${percent(fused.bench.confidence)}`;
  const items = byId<HTMLElement>("v080-item-state");
  if (items) {
    const loose = fused.looseItems.length ? fused.looseItems.join(" / ") : "暂无";
    const equipped = Object.entries(fused.equippedItems)
      .map(([hero, values]) => `${hero}:${values.join("/")}`)
      .join(" · ");
    items.textContent = `装备候选：${loose}${equipped ? ` · 已装备 ${equipped}` : ""}`;
  }
  const status = byId<HTMLElement>("v080-status");
  if (status) {
    if (fused.layoutId === "unsupported") {
      status.textContent = "当前窗口比例不支持 Board Vision";
      status.dataset.kind = "warn";
    } else if (safeBoardAutoApplyReady(fused)) {
      status.textContent = "场上完整状态已通过安全门禁";
      status.dataset.kind = "ok";
    } else if (Object.keys(fused.board.units).length || Object.keys(fused.bench.units).length || fused.looseItems.length) {
      status.textContent = "已发现候选，等待更多稳定帧/人工确认";
      status.dataset.kind = "warn";
    } else {
      status.textContent = "等待棋盘英雄/装备文本证据";
      status.dataset.kind = "warn";
    }
  }

  const boardButton = byId<HTMLButtonElement>("v080-apply-board");
  if (boardButton) boardButton.disabled = !Object.keys(fused.board.units).length;
  const benchButton = byId<HTMLButtonElement>("v080-apply-bench");
  if (benchButton) benchButton.disabled = !Object.keys(fused.bench.units).length;
  const itemButton = byId<HTMLButtonElement>("v080-merge-items");
  if (itemButton) itemButton.disabled = !fused.looseItems.length && !Object.keys(fused.equippedItems).length;
  renderAutoButton();
}

function renderAutoButton() {
  const button = byId<HTMLButtonElement>("v080-auto-board");
  if (!button) return;
  button.textContent = autoBoard ? "安全自动场上 ON" : "安全自动场上 OFF";
  button.dataset.enabled = autoBoard ? "1" : "0";
}

function setRect(node: HTMLElement | null, rect: NormalizedRect) {
  if (!node) return;
  node.style.left = `${rect.xMin * 100}%`;
  node.style.top = `${rect.yMin * 100}%`;
  node.style.width = `${(rect.xMax - rect.xMin) * 100}%`;
  node.style.height = `${(rect.yMax - rect.yMin) * 100}%`;
}

function renderRegions(frame: OcrFrame) {
  const layout = selectBoardVisionLayout(frame);
  const overlay = byId<HTMLElement>("v080-region-overlay");
  if (overlay) overlay.hidden = !layout.supported;
  setRect(byId("v080-region-board"), layout.board);
  setRect(byId("v080-region-bench"), layout.bench);
}

function mountRegionOverlay() {
  const wrap = document.querySelector<HTMLElement>(".v060-preview-wrap");
  if (!wrap || byId("v080-region-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "v080-region-overlay";
  overlay.className = "v080-region-overlay";
  overlay.innerHTML = `
    <div id="v080-region-board" class="v080-region-box board"><span>BOARD</span></div>
    <div id="v080-region-bench" class="v080-region-box bench"><span>BENCH</span></div>
  `;
  wrap.append(overlay);
}

function mountPanel() {
  if (byId("board-vision-v080")) return;
  const host = byId<HTMLElement>("vision-panel");
  if (!host) {
    window.setTimeout(mountPanel, 120);
    return;
  }
  mountRegionOverlay();
  const ruleStatus = host.querySelector(".v060-rule-status");
  const block = document.createElement("div");
  block.id = "board-vision-v080";
  block.className = "v080-block";
  block.innerHTML = `
    <div class="v080-head">
      <div>
        <strong>V0.8 BOARD VISION</strong>
        <span id="v080-status" data-kind="warn">等待棋盘英雄/装备文本证据</span>
      </div>
      <button id="v080-auto-board" type="button"></button>
    </div>
    <div class="v080-states">
      <div id="v080-board-state">场上：暂无可靠候选</div>
      <div id="v080-bench-state">备战：暂无可靠候选</div>
      <div id="v080-item-state">装备候选：暂无</div>
    </div>
    <div class="v080-actions">
      <button id="v080-apply-board" type="button" disabled>应用场上候选</button>
      <button id="v080-apply-bench" type="button" disabled>应用备战候选</button>
      <button id="v080-merge-items" type="button" disabled>合并装备候选</button>
    </div>
    <small class="v080-note">安全门禁：只有场上身份数=当前人口、同一组成连续≥3帧且融合置信度≥80%时才自动覆盖场上；备战席/装备默认只给候选。</small>
  `;
  host.insertBefore(block, ruleStatus ?? null);

  byId<HTMLButtonElement>("v080-auto-board")?.addEventListener("click", () => {
    autoBoard = !autoBoard;
    localStorage.setItem(AUTO_KEY, String(autoBoard));
    renderAutoButton();
    maybeAutoApplyBoard();
  });
  byId<HTMLButtonElement>("v080-apply-board")?.addEventListener("click", () => {
    if (applyBoardCandidate()) byId<HTMLButtonElement>("decide")?.click();
  });
  byId<HTMLButtonElement>("v080-apply-bench")?.addEventListener("click", () => {
    if (applyBenchCandidate()) byId<HTMLButtonElement>("decide")?.click();
  });
  byId<HTMLButtonElement>("v080-merge-items")?.addEventListener("click", () => {
    const changed = mergeItemCandidates() || mergeEquippedCandidates();
    if (changed) byId<HTMLButtonElement>("decide")?.click();
  });
  renderState();
}

function onVisionState(event: Event) {
  const detail = (event as CustomEvent<{ frame?: OcrFrame }>).detail;
  const frame = detail?.frame;
  if (!frame) return;
  if (lastWindowId && lastWindowId !== frame.window_id) {
    frames = [];
    lastAutoAppliedBoard = "";
  }
  lastWindowId = frame.window_id;
  const observed = recognizeBoardVisionFrame(frame, catalog, { level: currentLevel() });
  frames.push(observed);
  if (frames.length > 8) frames.splice(0, frames.length - 8);
  fused = fuseBoardVisionFrames(frames);
  renderRegions(frame);
  renderState();
  maybeAutoApplyBoard();
  window.dispatchEvent(new CustomEvent("tft-board-vision-state", { detail: { observed, fused } }));
}

function boot() {
  mountPanel();
  window.addEventListener("tft-vision-state", onVisionState);
  void refreshCatalog();
  window.setInterval(() => void refreshCatalog(), 15 * 60 * 1000);
}

boot();
