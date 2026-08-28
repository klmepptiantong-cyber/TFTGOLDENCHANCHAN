import "./v042.css";
import embeddedSnapshotJson from "../../data/latest.json";
import type { MetaSnapshot } from "../../lib/types";

const SNAPSHOT_URL = "https://raw.githubusercontent.com/klmepptiantong-cyber/TFTGOLDENCHANCHAN/main/data/latest.json";
const HISTORY_KEY = "tftgolden.history.v042";
const RECENT_AUGMENTS_KEY = "tftgolden.recentAugments.v042";
const MAX_HISTORY = 20;
const MAX_RECENT_AUGMENTS = 30;

const embeddedSnapshot = embeddedSnapshotJson as unknown as MetaSnapshot;
let visualSnapshot: MetaSnapshot = embeddedSnapshot;
let heroPictures = new Map<string, string>();
let itemPictures = new Map<string, string>();

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function parseList(value: string): string[] {
  return value
    .split(/[，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validSnapshot(value: unknown): value is MetaSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MetaSnapshot>;
  return typeof candidate.patch === "string" && Array.isArray(candidate.comps) && candidate.comps.length > 0;
}

function buildPictureMaps(snapshot: MetaSnapshot) {
  const heroes = new Map<string, string>();
  const items = new Map<string, string>();

  for (const comp of snapshot.comps) {
    for (const hero of comp.sourceLineup ?? []) {
      if (hero.picture && /^https:\/\//.test(hero.picture) && !heroes.has(hero.name)) {
        heroes.set(hero.name, hero.picture);
      }
    }
    for (const [name, picture] of Object.entries(comp.sourceEquipmentPicturesByName ?? {})) {
      if (picture && /^https:\/\//.test(picture) && !items.has(name)) items.set(name, picture);
    }
  }

  heroPictures = heroes;
  itemPictures = items;
  document.documentElement.dataset.visualAssets = heroes.size || items.size ? "ready" : "fallback";
}

async function loadVisualSnapshot() {
  try {
    const response = await fetch(`${SNAPSHOT_URL}?visual=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const candidate: unknown = await response.json();
    if (!validSnapshot(candidate)) throw new Error("invalid snapshot");
    visualSnapshot = candidate;
  } catch {
    visualSnapshot = embeddedSnapshot;
  }
  buildPictureMaps(visualSnapshot);
  decorateVisuals(document.body);
}

function createPicture(url: string, alt: string, className: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = url;
  img.alt = alt;
  img.className = className;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.remove(), { once: true });
  return img;
}

function decorateHero(root: ParentNode, selector: string, nameSelector: string) {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (element.dataset.visualHeroDone === "1") continue;
    const name = element.querySelector<HTMLElement>(nameSelector)?.textContent?.trim();
    if (!name) continue;
    const picture = heroPictures.get(name);
    if (!picture) continue;
    element.dataset.visualHeroDone = "1";
    const img = createPicture(picture, name, "v042-picture hero-picture");
    element.prepend(img);
    element.classList.add("has-real-picture");
  }
}

function decorateItem(root: ParentNode, selector: string, nameSelector: string) {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (element.dataset.visualItemDone === "1") continue;
    const name = element.querySelector<HTMLElement>(nameSelector)?.textContent?.trim();
    if (!name) continue;
    const picture = itemPictures.get(name);
    if (!picture) continue;
    element.dataset.visualItemDone = "1";
    const img = createPicture(picture, name, "v042-picture item-picture");
    element.prepend(img);
    element.classList.add("has-real-picture");
  }
}

function decorateVisuals(root: ParentNode) {
  decorateHero(root, ".picker-tile.hero-tile", ".picker-name");
  decorateHero(root, ".shop-slot.filled", ".shop-name");
  decorateHero(root, ".selection-chip.hero-chip", ".chip-name");
  decorateItem(root, ".picker-tile.item-tile", ".picker-name");
  decorateItem(root, ".selection-chip.item-chip", ".chip-name");
}

function observeVisuals() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added instanceof HTMLElement) decorateVisuals(added);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

type MatchHistoryPoint = {
  capturedAt: string;
  stage: string;
  form: string | null;
  lockedCompId: string | null;
  contested: string | null;
};

function historyPoints(): MatchHistoryPoint[] {
  return safeJson<MatchHistoryPoint[]>(localStorage.getItem(HISTORY_KEY), [])
    .filter((item) => item && typeof item === "object")
    .slice(-MAX_HISTORY);
}

function saveHistory(points: MatchHistoryPoint[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(points.slice(-MAX_HISTORY)));
  renderSessionStatus();
}

function currentStage(): string {
  return byId<HTMLInputElement>("stage")?.value?.trim() || "?";
}

function captureHistoryPoint() {
  const points = historyPoints();
  const point: MatchHistoryPoint = {
    capturedAt: new Date().toISOString(),
    stage: currentStage(),
    form: localStorage.getItem("tftgolden.form"),
    lockedCompId: localStorage.getItem("tftgolden.lockedCompId"),
    contested: localStorage.getItem("tftgolden.contested")
  };

  const last = points.at(-1);
  if (last?.stage === point.stage && last.form === point.form && last.lockedCompId === point.lockedCompId && last.contested === point.contested) {
    return;
  }
  points.push(point);
  saveHistory(points);
}

function undoRound() {
  const points = historyPoints();
  const point = points.pop();
  if (!point) return;

  if (point.form === null) localStorage.removeItem("tftgolden.form");
  else localStorage.setItem("tftgolden.form", point.form);

  if (point.lockedCompId === null) localStorage.removeItem("tftgolden.lockedCompId");
  else localStorage.setItem("tftgolden.lockedCompId", point.lockedCompId);

  if (point.contested === null) localStorage.removeItem("tftgolden.contested");
  else localStorage.setItem("tftgolden.contested", point.contested);

  saveHistory(points);
  location.reload();
}

function resetMatch(button: HTMLButtonElement) {
  if (button.dataset.confirming !== "1") {
    button.dataset.confirming = "1";
    button.textContent = "再次点击确认";
    window.setTimeout(() => {
      button.dataset.confirming = "0";
      button.textContent = "新开一局";
    }, 3500);
    return;
  }

  localStorage.removeItem("tftgolden.form");
  localStorage.removeItem("tftgolden.lockedCompId");
  localStorage.removeItem("tftgolden.contested");
  localStorage.removeItem(HISTORY_KEY);
  location.reload();
}

function renderSessionStatus() {
  const status = byId<HTMLElement>("session-status");
  const undo = byId<HTMLButtonElement>("undo-round");
  const count = historyPoints().length;
  if (status) status.textContent = `本局 ${count} 个历史点`;
  if (undo) undo.disabled = count === 0;
}

function recentAugments(): string[] {
  return normalizeStrings(safeJson<unknown[]>(localStorage.getItem(RECENT_AUGMENTS_KEY), [])).slice(0, MAX_RECENT_AUGMENTS);
}

function saveRecentAugments(items: string[]) {
  const unique = [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, MAX_RECENT_AUGMENTS);
  localStorage.setItem(RECENT_AUGMENTS_KEY, JSON.stringify(unique));
}

function learnAugmentsFromInput() {
  const textarea = byId<HTMLTextAreaElement>("augments");
  if (!textarea) return;
  const current = parseList(textarea.value);
  if (!current.length) return;
  saveRecentAugments([...current, ...recentAugments()]);
  renderAugmentChips();
}

function renderAugmentChips() {
  const container = byId<HTMLElement>("augment-chips");
  const textarea = byId<HTMLTextAreaElement>("augments");
  if (!container || !textarea) return;
  container.replaceChildren();

  for (const augment of parseList(textarea.value)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "selection-chip augment-chip";
    chip.title = `点击移除 ${augment}`;
    chip.textContent = augment;
    chip.addEventListener("click", () => {
      const next = parseList(textarea.value);
      const index = next.indexOf(augment);
      if (index >= 0) next.splice(index, 1);
      textarea.value = next.join(", ");
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      renderAugmentChips();
    });
    container.append(chip);
  }
}

function addAugment(value: string) {
  const textarea = byId<HTMLTextAreaElement>("augments");
  if (!textarea) return;
  const items = parseList(textarea.value);
  if (!items.includes(value)) items.push(value);
  textarea.value = items.join(", ");
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
  saveRecentAugments([value, ...recentAugments()]);
  renderAugmentChips();
}

function renderAugmentDialog() {
  const grid = byId<HTMLElement>("augment-grid");
  const search = byId<HTMLInputElement>("augment-search");
  const source = byId<HTMLElement>("augment-source-label");
  if (!grid || !search) return;
  grid.replaceChildren();

  const query = search.value.trim().toLowerCase();
  const entries = recentAugments().filter((name) => !query || name.toLowerCase().includes(query));
  if (source) source.textContent = "最近使用 · 暂无稳定公开全量强化目录";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "augment-empty";
    empty.textContent = "还没有最近强化。先在文本框输入一次，之后即可点选复用。";
    grid.append(empty);
    return;
  }

  for (const name of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-tile augment-tile";
    const glyph = document.createElement("span");
    glyph.className = "augment-glyph";
    glyph.textContent = "✦";
    const label = document.createElement("span");
    label.className = "picker-name";
    label.textContent = name;
    button.append(glyph, label);
    button.addEventListener("click", () => {
      addAugment(name);
      byId<HTMLDialogElement>("augment-dialog")?.close();
    });
    grid.append(button);
  }
}

function openAugmentDialog() {
  learnAugmentsFromInput();
  const search = byId<HTMLInputElement>("augment-search");
  if (search) search.value = "";
  renderAugmentDialog();
  const dialog = byId<HTMLDialogElement>("augment-dialog");
  if (dialog && !dialog.open) dialog.showModal();
  requestAnimationFrame(() => search?.focus());
}

function bindEnhancements() {
  byId<HTMLButtonElement>("next-round")?.addEventListener("click", captureHistoryPoint, { capture: true });
  byId<HTMLButtonElement>("undo-round")?.addEventListener("click", undoRound);

  const reset = byId<HTMLButtonElement>("reset-match");
  reset?.addEventListener("click", () => resetMatch(reset));

  byId<HTMLButtonElement>("add-augment")?.addEventListener("click", openAugmentDialog);
  byId<HTMLInputElement>("augment-search")?.addEventListener("input", renderAugmentDialog);
  byId<HTMLTextAreaElement>("augments")?.addEventListener("change", () => {
    learnAugmentsFromInput();
    renderAugmentChips();
  });
  byId<HTMLButtonElement>("decide")?.addEventListener("click", learnAugmentsFromInput, { capture: true });

  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    if (!historyPoints().length) return;
    event.preventDefault();
    undoRound();
  });
}

function boot() {
  renderSessionStatus();
  renderAugmentChips();
  bindEnhancements();
  observeVisuals();
  void loadVisualSnapshot();
}

boot();
