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

type PickerMode = "shop" | "units" | "bench" | "items";
type HeroCatalogEntry = { name: string; price: number | null };

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
let pickerMode: PickerMode = "shop";
let activeShopSlot = 0;
let shopSlots = ["", "", "", "", ""];
let contestedByComp = readStoredCountMap("tftgolden.contested");

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

function serializeUnits(units: Record<string, number>): string {
  return Object.entries(units)
    .filter(([, copies]) => copies > 0)
    .map(([name, copies]) => `${name}=${copies}`)
    .join(", ");
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

function readStoredCountMap(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([id, value]) => [id, Math.max(0, Math.min(7, Math.round(Number(value) || 0)))] as const)
        .filter(([, count]) => count > 0)
    );
  } catch {
    return {};
  }
}

function numberValue(id: string, fallback: number): number {
  const value = Number((el<HTMLInputElement>(id)).value);
  return Number.isFinite(value) ? value : fallback;
}

function syncShopHidden() {
  el<HTMLInputElement>("shop").value = shopSlots.filter(Boolean).join(", ");
}

function readState() {
  syncShopHidden();
  return parseGameState({
    stage: el<HTMLInputElement>("stage").value,
    level: numberValue("level", 6),
    gold: numberValue("gold", 0),
    hp: numberValue("hp", 100),
    streak: numberValue("streak", 0),
    shop: shopSlots.filter(Boolean).slice(0, 5),
    units: parseUnits(el<HTMLTextAreaElement>("units").value),
    bench: parseUnits(el<HTMLTextAreaElement>("bench").value),
    items: parseList(el<HTMLTextAreaElement>("items").value),
    augments: parseList(el<HTMLTextAreaElement>("augments").value),
    equippedItems: parseEquipped(el<HTMLTextAreaElement>("equipped").value),
    lockedCompId: lockedCompId || undefined,
    contestedComps: contestedByComp
  });
}

function persistInputs() {
  syncShopHidden();
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
    const restoredShop = parseList(saved.shop ?? "").slice(0, 5);
    shopSlots = Array.from({ length: 5 }, (_, index) => restoredShop[index] ?? "");
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

function heroCatalog(): HeroCatalogEntry[] {
  const catalog = new Map<string, number | null>();
  for (const comp of snapshot.comps) {
    for (const unit of comp.sourceLineup ?? []) {
      if (!catalog.has(unit.name) || (catalog.get(unit.name) === null && unit.price !== null)) {
        catalog.set(unit.name, unit.price);
      }
    }
    for (const name of [...comp.coreUnits, ...comp.flexUnits]) {
      if (!catalog.has(name)) catalog.set(name, null);
    }
  }
  return [...catalog.entries()]
    .map(([name, price]) => ({ name, price }))
    .sort((a, b) => (a.price ?? 9) - (b.price ?? 9) || a.name.localeCompare(b.name, "zh-CN"));
}

function itemCatalog(): string[] {
  return [...new Set(snapshot.comps.flatMap((comp) => comp.keyItems).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function updateTextCollection(id: "units" | "bench", name: string, delta: number) {
  const textarea = el<HTMLTextAreaElement>(id);
  const units = parseUnits(textarea.value);
  const next = Math.max(0, Math.min(9, (units[name] ?? 0) + delta));
  if (next === 0) delete units[name];
  else units[name] = next;
  textarea.value = serializeUnits(units);
  renderUnitChips(id, id === "units" ? "units-chips" : "bench-chips");
  persistInputs();
}

function renderUnitChips(id: "units" | "bench", containerId: string) {
  const container = el<HTMLElement>(containerId);
  container.replaceChildren();
  const units = parseUnits(el<HTMLTextAreaElement>(id).value);
  for (const [name, copies] of Object.entries(units)) {
    const chip = node("span", "selection-chip hero-chip");
    chip.append(node("span", "chip-avatar", name.slice(0, 1)), node("span", "chip-name", name));
    const minus = node("button", "chip-step", "−");
    minus.type = "button";
    minus.title = `减少 ${name}`;
    minus.addEventListener("click", () => updateTextCollection(id, name, -1));
    const count = node("b", "chip-count", String(copies));
    const plus = node("button", "chip-step", "+");
    plus.type = "button";
    plus.title = `增加 ${name}`;
    plus.addEventListener("click", () => updateTextCollection(id, name, 1));
    chip.append(minus, count, plus);
    container.append(chip);
  }
}

function renderItemChips() {
  const container = el<HTMLElement>("item-chips");
  container.replaceChildren();
  const items = parseList(el<HTMLTextAreaElement>("items").value);
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const [item, count] of counts) {
    const chip = node("button", "selection-chip item-chip");
    chip.type = "button";
    chip.title = `点击移除一个 ${item}`;
    chip.append(node("span", "item-glyph", "◆"), node("span", "chip-name", item));
    if (count > 1) chip.append(node("b", "chip-count", `×${count}`));
    chip.addEventListener("click", () => {
      const list = parseList(el<HTMLTextAreaElement>("items").value);
      const index = list.indexOf(item);
      if (index >= 0) list.splice(index, 1);
      el<HTMLTextAreaElement>("items").value = list.join(", ");
      renderItemChips();
      persistInputs();
    });
    container.append(chip);
  }
}

function renderShopSlots() {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".shop-slot")) {
    const slot = Number(button.dataset.slot ?? 0);
    const hero = shopSlots[slot] ?? "";
    button.replaceChildren();
    if (hero) {
      button.classList.add("filled");
      button.append(node("span", "shop-avatar", hero.slice(0, 1)), node("span", "shop-name", hero));
    } else {
      button.classList.remove("filled");
      button.append(node("span", "shop-index", String(slot + 1)), node("span", "shop-empty", "点选"));
    }
  }
  syncShopHidden();
}

function renderFastInputs() {
  renderShopSlots();
  renderUnitChips("units", "units-chips");
  renderUnitChips("bench", "bench-chips");
  renderItemChips();
}

function pickerTitle(mode: PickerMode): string {
  if (mode === "shop") return `商店第 ${activeShopSlot + 1} 格`;
  if (mode === "units") return "添加场上英雄";
  if (mode === "bench") return "添加替补英雄";
  return "添加装备";
}

function selectPickerValue(value: string) {
  if (pickerMode === "shop") {
    shopSlots[activeShopSlot] = value;
    renderShopSlots();
    persistInputs();
    const nextEmpty = shopSlots.findIndex((item, index) => !item && index > activeShopSlot);
    if (nextEmpty >= 0) {
      activeShopSlot = nextEmpty;
      el<HTMLElement>("picker-title").textContent = pickerTitle("shop");
      return;
    }
  } else if (pickerMode === "units" || pickerMode === "bench") {
    updateTextCollection(pickerMode, value, 1);
  } else {
    const textarea = el<HTMLTextAreaElement>("items");
    const items = parseList(textarea.value);
    items.push(value);
    textarea.value = items.join(", ");
    renderItemChips();
    persistInputs();
  }
  el<HTMLDialogElement>("picker-dialog").close();
}

function renderPickerOptions() {
  const query = el<HTMLInputElement>("picker-search").value.trim().toLowerCase();
  const grid = el<HTMLElement>("picker-grid");
  grid.replaceChildren();

  if (pickerMode === "items") {
    for (const item of itemCatalog().filter((name) => !query || name.toLowerCase().includes(query))) {
      const button = node("button", "picker-tile item-tile");
      button.type = "button";
      button.append(node("span", "picker-item-glyph", "◆"), node("span", "picker-name", item));
      button.addEventListener("click", () => selectPickerValue(item));
      grid.append(button);
    }
    return;
  }

  for (const hero of heroCatalog().filter((entry) => !query || entry.name.toLowerCase().includes(query))) {
    const button = node("button", "picker-tile hero-tile");
    button.type = "button";
    button.append(node("span", `picker-avatar cost-${hero.price ?? 0}`, hero.name.slice(0, 1)));
    const label = node("span", "picker-name", hero.name);
    button.append(label);
    if (hero.price !== null) button.append(node("small", "picker-cost", `${hero.price}费`));
    button.addEventListener("click", () => selectPickerValue(hero.name));
    grid.append(button);
  }
}

function openPicker(mode: PickerMode, slot = 0) {
  pickerMode = mode;
  activeShopSlot = slot;
  el<HTMLElement>("picker-title").textContent = pickerTitle(mode);
  el<HTMLElement>("picker-hint").textContent = mode === "items" ? "当前快照已核验装备名称" : "当前实时阵容涉及的英雄";
  const search = el<HTMLInputElement>("picker-search");
  search.value = "";
  renderPickerOptions();
  const dialog = el<HTMLDialogElement>("picker-dialog");
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => search.focus());
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

function metric(label: string, value: string, className = ""): HTMLElement {
  const block = node("div", `metric ${className}`.trim());
  block.append(node("small", "", label), node("strong", "", value));
  return block;
}

function updateContested(compId: string, delta: number) {
  const next = Math.max(0, Math.min(7, (contestedByComp[compId] ?? 0) + delta));
  if (next === 0) delete contestedByComp[compId];
  else contestedByComp[compId] = next;
  localStorage.setItem("tftgolden.contested", JSON.stringify(contestedByComp));
  calculate();
}

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

  const metrics = node("div", "rec-metrics");
  metrics.append(metric("完成度", `${rec.completionScore}%`, rec.completionScore >= 65 ? "good" : ""));
  metrics.append(metric("强化", `${rec.augmentScore}`, rec.augmentScore >= 50 ? "good" : ""));
  const contest = node("div", "metric contest-metric");
  contest.append(node("small", "", "同行"));
  const contestControl = node("span", "contest-control");
  const minus = node("button", "", "−");
  minus.type = "button";
  minus.addEventListener("click", () => updateContested(rec.comp.id, -1));
  const count = node("strong", "", String(rec.contestedCount));
  const plus = node("button", "", "+");
  plus.type = "button";
  plus.addEventListener("click", () => updateContested(rec.comp.id, 1));
  contestControl.append(minus, count, plus);
  contest.append(contestControl);
  metrics.append(contest);
  card.append(metrics);

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
    const reasons = rec.reasons.length ? rec.reasons.slice(0, 5).join(" · ") : "当前主要依据实时Meta作为备选。";
    evidence.append(node("p", "", `依据：${reasons}`));
    if (rec.augmentHits.length) evidence.append(node("p", "", `强化命中：${rec.augmentHits.join(" / ")}`));
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

function advanceStage(value: string): string {
  const match = value.trim().match(/^(\d+)-(\d+)$/);
  if (!match) return value;
  const stage = Number(match[1]);
  const round = Number(match[2]);
  if (round >= 7) return `${stage + 1}-1`;
  return `${stage}-${round + 1}`;
}

function nextRound() {
  const stage = el<HTMLInputElement>("stage");
  stage.value = advanceStage(stage.value);
  shopSlots = ["", "", "", "", ""];
  renderShopSlots();
  persistInputs();
  calculate();
  openPicker("shop", 0);
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
  el<HTMLButtonElement>("next-round").addEventListener("click", nextRound);
  el<HTMLButtonElement>("refresh-data").addEventListener("click", async () => {
    await refreshSnapshot(true);
    renderFastInputs();
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
  el<HTMLButtonElement>("clear-shop").addEventListener("click", () => {
    shopSlots = ["", "", "", "", ""];
    renderShopSlots();
    persistInputs();
  });
  el<HTMLButtonElement>("add-unit").addEventListener("click", () => openPicker("units"));
  el<HTMLButtonElement>("add-bench").addEventListener("click", () => openPicker("bench"));
  el<HTMLButtonElement>("add-item").addEventListener("click", () => openPicker("items"));
  el<HTMLInputElement>("picker-search").addEventListener("input", renderPickerOptions);

  for (const button of document.querySelectorAll<HTMLButtonElement>(".shop-slot")) {
    button.addEventListener("click", () => openPicker("shop", Number(button.dataset.slot ?? 0)));
  }

  el<HTMLElement>("drag-handle").addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void invoke("start_drag");
  });

  for (const id of inputIds) {
    el<HTMLInputElement | HTMLTextAreaElement>(id).addEventListener("change", () => {
      if (id === "units") renderUnitChips("units", "units-chips");
      if (id === "bench") renderUnitChips("bench", "bench-chips");
      if (id === "items") renderItemChips();
      persistInputs();
    });
  }
}

async function boot() {
  restoreInputs();
  renderFastInputs();
  bindEvents();
  updateUnlockButton();
  await setCompact(compact);
  await registerNativeEvents();
  await refreshSnapshot(false);
  renderFastInputs();
}

void boot();
