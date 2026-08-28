import "./styles.css";
import embeddedSnapshotJson from "../../data/latest.json";
import { parseGameState } from "../../lib/game-state";
import { recommend } from "../../lib/recommender";
import type { MetaSnapshot, Recommendation } from "../../lib/types";

type TauriGlobal = {
  core?: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  event?: {
    listen<T = unknown>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
  };
};

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

const SNAPSHOT_URL = "https://raw.githubusercontent.com/klmepptiantong-cyber/TFTGOLDENCHANCHAN/main/data/latest.json";
const embeddedSnapshot = embeddedSnapshotJson as unknown as MetaSnapshot;
let snapshot: MetaSnapshot = embeddedSnapshot;
let lockedCompId = localStorage.getItem("tftgolden.lockedCompId") || "";
let compact = localStorage.getItem("tftgolden.compact") === "true";
let clickThrough = false;

const inputIds = ["stage", "level", "gold", "hp", "streak", "shop", "units", "bench", "items", "augments", "equipped"] as const;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function parseList(value: string): string[] {
  return value
    .split(/[，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseUnits(value: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const token of parseList(value)) {
    const match = token.match(/^(.+?)(?:\s*[=xX*×]\s*(\d+))?$/);
    if (!match) continue;
    const name = match[1].trim();
    const copies = Math.max(1, Math.min(9, Number(match[2] ?? 1)));
    if (name) result[name] = copies;
  }
  return result;
}

function parseEquipped(value: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const token of value.split(/[;；\n]/).map((item) => item.trim()).filter(Boolean)) {
    const [holder, itemText] = token.split(/[:：]/, 2);
    if (!holder?.trim() || !itemText?.trim()) continue;
    result[holder.trim()] = itemText
      .split(/[\/、,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return result;
}

function numberValue(id: string, fallback: number): number {
  const value = Number((el<HTMLInputElement>(id)).value);
  return Number.isFinite(value) ? value : fallback;
}

function readState() {
  return parseGameState({
    stage: el<HTMLInputElement>("stage").value,
    level: numberValue("level", 6),
    gold: numberValue("gold", 0),
    hp: numberValue("hp", 100),
    streak: numberValue("streak", 0),
    shop: parseList(el<HTMLInputElement>("shop").value).slice(0, 5),
    units: parseUnits(el<HTMLTextAreaElement>("units").value),
    bench: parseUnits(el<HTMLTextAreaElement>("bench").value),
    items: parseList(el<HTMLTextAreaElement>("items").value),
    augments: parseList(el<HTMLTextAreaElement>("augments").value),
    equippedItems: parseEquipped(el<HTMLTextAreaElement>("equipped").value),
    lockedCompId: lockedCompId || undefined
  });
}

function persistInputs() {
  const saved: Record<string, string> = {};
  for (const id of inputIds) {
    const node = el<HTMLInputElement | HTMLTextAreaElement>(id);
    saved[id] = node.value;
  }
  localStorage.setItem("tftgolden.form", JSON.stringify(saved));
}

function restoreInputs() {
  const raw = localStorage.getItem("tftgolden.form");
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as Record<string, string>;
    for (const id of inputIds) {
      if (typeof saved[id] === "string") {
        el<HTMLInputElement | HTMLTextAreaElement>(id).value = saved[id];
      }
    }
  } catch {
    localStorage.removeItem("tftgolden.form");
  }
}

function validateSnapshot(value: unknown): value is MetaSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MetaSnapshot>;
  return typeof candidate.patch === "string"
    && typeof candidate.fetchedAt === "string"
    && Array.isArray(candidate.comps)
    && candidate.comps.length > 0;
}

function snapshotLabel(source: "remote" | "embedded"): string {
  const ageMinutes = Math.max(0, Math.round((Date.now() - Date.parse(snapshot.fetchedAt)) / 60000));
  const live = snapshot.isLive ? "LIVE" : "FALLBACK";
  const suffix = source === "remote" ? "云端" : "内置";
  return `${live} ${snapshot.patch} · ${suffix} · ${ageMinutes}m`;
}

async function refreshSnapshot(manual = false) {
  const status = el<HTMLSpanElement>("snapshot-status");
  status.textContent = manual ? "正在刷新…" : "同步数据…";
  status.className = "status-pill loading";

  try {
    const response = await fetch(`${SNAPSHOT_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const candidate: unknown = await response.json();
    if (!validateSnapshot(candidate)) throw new Error("invalid_snapshot");
    snapshot = candidate;
    status.textContent = snapshotLabel("remote");
    status.className = `status-pill ${snapshot.isLive ? "live" : "fallback"}`;
  } catch {
    snapshot = embeddedSnapshot;
    status.textContent = snapshotLabel("embedded");
    status.className = "status-pill fallback";
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

const actionLabels: Record<string, string> = {
  buy: "买",
  keep: "留",
  sell: "卖",
  roll: "D牌",
  level: "升人口",
  pivot: "转阵",
  item: "装备"
};

function renderRecommendation(rec: Recommendation, index: number): HTMLElement {
  const card = node("article", `rec-card ${index === 0 ? "best" : ""}`);
  card.dataset.compId = rec.comp.id;

  const head = node("div", "rec-head");
  const titleBox = node("div");
  titleBox.append(node("small", "rank-label", `候选 #${index + 1}`));
  titleBox.append(node("h2", "", rec.comp.name));
  const score = node("div", "fit-score");
  score.append(node("strong", "", String(rec.fitScore)));
  score.append(node("span", "", "契合"));
  head.append(titleBox, score);
  card.append(head);

  card.append(node("p", "next-step", rec.nextStep));

  const actionList = node("div", "action-list");
  for (const action of rec.actions.slice(0, compact ? 3 : 7)) {
    const row = node("div", `action-row ${action.priority}`);
    row.append(node("span", "action-kind", actionLabels[action.kind] ?? action.kind));
    row.append(node("p", "", action.text));
    actionList.append(row);
  }
  card.append(actionList);

  if (!compact) {
    const evidence = node("div", "evidence");
    const reasons = rec.reasons.length ? rec.reasons.slice(0, 4).join(" · ") : "当前主要依据实时Meta作为备选。";
    evidence.append(node("p", "", `依据：${reasons}`));
    if (rec.itemAdvice[0]) evidence.append(node("p", "", `装备：${rec.itemAdvice[0]}`));
    card.append(evidence);
  }

  const lock = node("button", "lock-button", lockedCompId === rec.comp.id ? "已锁定" : "锁定阵容");
  lock.type = "button";
  lock.addEventListener("click", () => {
    lockedCompId = rec.comp.id;
    localStorage.setItem("tftgolden.lockedCompId", lockedCompId);
    updateUnlockButton();
    calculate();
  });
  card.append(lock);
  return card;
}

function calculate() {
  persistInputs();
  const eligible = snapshot.comps.filter(
    (comp) => !comp.needsEnrichment && comp.coreUnits.length > 0 && comp.stagePlan.length > 0
  );
  const result = recommend(eligible, readState());
  const results = el<HTMLElement>("results");
  results.replaceChildren();

  if (!result.length) {
    results.append(node("div", "empty-state", "当前快照没有满足安全门禁的阵容。"));
    return;
  }

  for (const [index, rec] of result.entries()) {
    results.append(renderRecommendation(rec, index));
  }
}

function updateUnlockButton() {
  const button = el<HTMLButtonElement>("unlock");
  button.hidden = !lockedCompId;
  button.textContent = lockedCompId ? "解除锁阵" : "解除锁阵";
}

async function invoke(command: string, args?: Record<string, unknown>) {
  try {
    await window.__TAURI__?.core?.invoke(command, args);
  } catch (error) {
    console.warn(`Tauri command ${command} failed`, error);
  }
}

async function setCompact(next: boolean) {
  compact = next;
  localStorage.setItem("tftgolden.compact", String(compact));
  el<HTMLElement>("overlay").classList.toggle("compact", compact);
  el<HTMLDetailsElement>("advanced-panel").open = !compact;
  await invoke("set_overlay_size", { compact });
  const hasResults = el<HTMLElement>("results").querySelector(".rec-card");
  if (hasResults) calculate();
}

async function setClickThrough(next: boolean) {
  clickThrough = next;
  el<HTMLButtonElement>("toggle-click").classList.toggle("active", next);
  el<HTMLButtonElement>("toggle-click").title = next ? "已开启鼠标穿透，按 Alt+W 恢复" : "鼠标穿透 Alt+W";
  await invoke("set_click_through", { enabled: next });
}

async function registerNativeEvents() {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) return;
  await listen("overlay-toggle-compact", () => {
    void setCompact(!compact);
  });
  await listen<boolean>("overlay-click-through", (event) => {
    clickThrough = Boolean(event.payload);
    el<HTMLButtonElement>("toggle-click").classList.toggle("active", clickThrough);
  });
}

function bindEvents() {
  el<HTMLButtonElement>("decide").addEventListener("click", calculate);
  el<HTMLButtonElement>("refresh-data").addEventListener("click", async () => {
    await refreshSnapshot(true);
    calculate();
  });
  el<HTMLButtonElement>("toggle-compact").addEventListener("click", () => void setCompact(!compact));
  el<HTMLButtonElement>("toggle-click").addEventListener("click", () => void setClickThrough(!clickThrough));
  el<HTMLButtonElement>("hide-overlay").addEventListener("click", () => void invoke("hide_overlay"));
  el<HTMLButtonElement>("unlock").addEventListener("click", () => {
    lockedCompId = "";
    localStorage.removeItem("tftgolden.lockedCompId");
    updateUnlockButton();
    calculate();
  });

  el<HTMLElement>("drag-handle").addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void invoke("start_drag");
  });

  for (const id of inputIds) {
    el<HTMLInputElement | HTMLTextAreaElement>(id).addEventListener("change", persistInputs);
  }
}

async function boot() {
  restoreInputs();
  bindEvents();
  updateUnlockButton();
  await setCompact(compact);
  await registerNativeEvents();
  await refreshSnapshot(false);
}

void boot();
