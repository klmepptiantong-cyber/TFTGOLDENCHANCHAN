import "./v043.css";
import embeddedSnapshotJson from "../../data/latest.json";
import { parseGameState } from "../../lib/game-state";
import { recommend } from "../../lib/recommender";
import type { Comp, GameState, MetaSnapshot, Recommendation, UnitCollection } from "../../lib/types";

const SNAPSHOT_URL = "https://raw.githubusercontent.com/klmepptiantong-cyber/TFTGOLDENCHANCHAN/main/data/latest.json";
const embeddedSnapshot = embeddedSnapshotJson as unknown as MetaSnapshot;
let snapshot: MetaSnapshot = embeddedSnapshot;
let renderTimer = 0;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function parseList(value: string): string[] {
  return value.split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean);
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
    result[holder.trim()] = itemText.split(/[\/、,，]/).map((item) => item.trim()).filter(Boolean);
  }
  return result;
}

function readContested(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem("tftgolden.contested") ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([id, value]) => [id, Math.max(0, Math.min(7, Math.round(Number(value) || 0)))]));
  } catch {
    return {};
  }
}

function numberValue(id: string, fallback: number): number {
  const node = byId<HTMLInputElement>(id);
  const value = Number(node?.value ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function collectState(): GameState {
  const shop = [...document.querySelectorAll<HTMLElement>(".shop-slot.filled .shop-name")]
    .map((item) => item.textContent?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 5);

  return parseGameState({
    stage: byId<HTMLInputElement>("stage")?.value ?? "3-2",
    level: numberValue("level", 6),
    gold: numberValue("gold", 0),
    hp: numberValue("hp", 100),
    streak: numberValue("streak", 0),
    shop,
    units: parseUnits(byId<HTMLTextAreaElement>("units")?.value ?? ""),
    bench: parseUnits(byId<HTMLTextAreaElement>("bench")?.value ?? ""),
    items: parseList(byId<HTMLTextAreaElement>("items")?.value ?? ""),
    augments: parseList(byId<HTMLTextAreaElement>("augments")?.value ?? ""),
    equippedItems: parseEquipped(byId<HTMLTextAreaElement>("equipped")?.value ?? ""),
    lockedCompId: localStorage.getItem("tftgolden.lockedCompId") || undefined,
    contestedComps: readContested()
  });
}

function validSnapshot(value: unknown): value is MetaSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MetaSnapshot>;
  return typeof candidate.patch === "string" && Array.isArray(candidate.comps) && candidate.comps.length > 0;
}

async function refreshSnapshot() {
  try {
    const response = await fetch(`${SNAPSHOT_URL}?v043=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const candidate: unknown = await response.json();
    if (!validSnapshot(candidate)) throw new Error("invalid snapshot");
    snapshot = candidate;
  } catch {
    snapshot = embeddedSnapshot;
  }
  scheduleRender(0);
}

function unitCopies(value: number | { copies?: number; stars?: 1 | 2 | 3 } | undefined): number {
  if (typeof value === "number") return Math.max(0, value);
  if (!value) return 0;
  if (typeof value.copies === "number") return Math.max(0, value.copies);
  if (value.stars === 3) return 9;
  if (value.stars === 2) return 3;
  return value.stars === 1 ? 1 : 0;
}

function mergeOwned(...collections: (UnitCollection | undefined)[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const collection of collections) {
    for (const [name, value] of Object.entries(collection ?? {})) {
      merged[name] = (merged[name] ?? 0) + unitCopies(value);
    }
  }
  return merged;
}

function allItems(state: GameState): string[] {
  return [...new Set([
    ...state.items,
    ...Object.values(state.equippedItems ?? {}).flat(),
    ...Object.values(state.units).flatMap((unit) => typeof unit === "object" ? unit.items ?? [] : []),
    ...Object.values(state.bench ?? {}).flatMap((unit) => typeof unit === "object" ? unit.items ?? [] : [])
  ])];
}

function targetLevel(comp: Comp): number {
  const fiveCosts = (comp.sourceLineup ?? []).filter((unit) => unit.price === 5).length;
  if (/95|九五/.test(comp.name) || fiveCosts >= 3 || comp.stagePlan.some((line) => /9\s*人口|九人口/.test(line))) return 9;
  const carryCost = comp.sourceCarries?.find((carry) => carry.role === "carry")?.price ?? null;
  if (carryCost !== null && carryCost <= 2) return 6;
  if (carryCost === 3) return 7;
  return 8;
}

function heroCost(name: string): number | null {
  for (const comp of snapshot.comps) {
    const unit = comp.sourceLineup?.find((entry) => entry.name === name);
    if (unit?.price !== null && unit?.price !== undefined) return unit.price;
  }
  return null;
}

function gapSummary(rec: Recommendation, state: GameState) {
  const owned = mergeOwned(state.units, state.bench);
  const missingCore = rec.comp.coreUnits.filter((name) => (owned[name] ?? 0) === 0);
  const currentItems = allItems(state);
  const targetItems = [...new Set(rec.comp.keyItems)].slice(0, 3);
  const missingItems = targetItems.filter((item) => !currentItems.includes(item));
  const levelGap = Math.max(0, targetLevel(rec.comp) - state.level);
  return { missingCore, missingItems, levelGap };
}

type ShopPriority = {
  hero: string;
  slot: number;
  score: number;
  label: string;
  reason: string;
  interestRisk: boolean;
};

function shopPriorities(recs: Recommendation[], state: GameState): ShopPriority[] {
  const owned = mergeOwned(state.units, state.bench);
  const beforeInterest = Math.min(5, Math.floor(state.gold / 10));
  return (state.shop ?? []).map((hero, index) => {
    let score = 10;
    let label = "可跳过";
    let reason = "未命中当前 Top3 主要体系位";

    for (let rank = 0; rank < recs.length; rank += 1) {
      const rec = recs[rank];
      if (rec.comp.coreUnits.includes(hero)) {
        const candidate = rank === 0 ? 100 : rank === 1 ? 78 : 66;
        if (candidate > score) {
          score = candidate;
          label = rank === 0 ? "必拿" : "转阵保留";
          reason = `${rec.comp.name} 核心牌 · Fit ${rec.fitScore}`;
        }
      } else if (rec.comp.flexUnits.includes(hero)) {
        const candidate = rank === 0 ? 72 : rank === 1 ? 54 : 44;
        if (candidate > score) {
          score = candidate;
          label = rank === 0 ? "建议拿" : "可保留";
          reason = `${rec.comp.name} 功能位`;
        }
      }
    }

    if ((owned[hero] ?? 0) >= 9) {
      score = 0;
      label = "已满";
      reason = "当前已记录9张，不再建议购买";
    }

    const cost = heroCost(hero) ?? 0;
    const afterInterest = Math.min(5, Math.floor(Math.max(0, state.gold - cost) / 10));
    return { hero, slot: index + 1, score, label, reason, interestRisk: cost > 0 && afterInterest < beforeInterest };
  }).sort((a, b) => b.score - a.score || a.slot - b.slot);
}

function itemConflicts(rec: Recommendation, state: GameState): string[] {
  const conflicts: string[] = [];
  for (const [holder, equipped] of Object.entries(state.equippedItems ?? {})) {
    for (const item of equipped) {
      const ideal = Object.entries(rec.comp.itemCarriers)
        .filter(([, items]) => items.includes(item))
        .map(([hero]) => hero);
      if (ideal.length && !ideal.includes(holder)) {
        conflicts.push(`${holder} 的 ${item} → 终局更适合 ${ideal.join(" / ")}`);
      }
    }
  }
  return [...new Set(conflicts)].slice(0, 4);
}

function pivotAssessment(recs: Recommendation[], state: GameState): { level: "low" | "medium" | "high"; title: string; detail: string } {
  const best = recs[0];
  if (!best) return { level: "medium", title: "等待数据", detail: "当前没有可用推荐。" };
  if (!state.lockedCompId) return { level: "low", title: "开放转阵", detail: `当前最优 ${best.comp.name} · Fit ${best.fitScore}，尚未锁阵。` };

  const locked = recs.find((rec) => rec.comp.id === state.lockedCompId);
  if (!locked) return { level: "high", title: "锁阵失效", detail: "已锁阵容不再满足推荐门槛，建议立即重新评估。" };
  if (locked.comp.id === best.comp.id && locked.contestedCount <= 2) {
    return { level: "low", title: "继续锁阵", detail: `${locked.comp.name} 仍为最优，Fit ${locked.fitScore}，同行 ${locked.contestedCount}。` };
  }

  const gap = best.fitScore - locked.fitScore;
  if (locked.contestedCount >= 3 || gap >= 15 || (state.hp <= 35 && gap >= 8)) {
    return { level: "high", title: "建议开放转阵", detail: `${best.comp.name} 比锁阵高 ${Math.max(0, gap)} Fit；锁阵同行 ${locked.contestedCount}，血量 ${state.hp}。` };
  }
  return { level: "medium", title: "观察1–2轮", detail: `锁阵 ${locked.comp.name} 与最优 ${best.comp.name} 差 ${Math.max(0, gap)} Fit，暂不需要立即切。` };
}

function ensurePanel(): HTMLElement {
  let panel = byId<HTMLElement>("v043-speed-panel");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.id = "v043-speed-panel";
  panel.className = "v043-speed-panel";
  const results = byId<HTMLElement>("results");
  results?.insertAdjacentElement("afterend", panel);
  return panel;
}

function text(tag: keyof HTMLElementTagNameMap, className: string, value: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

function listBlock(title: string, values: string[], empty: string): HTMLElement {
  const block = document.createElement("div");
  block.className = "v043-block";
  block.append(text("strong", "v043-block-title", title));
  if (!values.length) block.append(text("span", "v043-good", empty));
  else values.slice(0, 5).forEach((value) => block.append(text("span", "v043-line", value)));
  return block;
}

function render() {
  const panel = ensurePanel();
  let state: GameState;
  try {
    state = collectState();
  } catch {
    panel.replaceChildren(text("div", "v043-empty", "当前输入尚未形成有效对局状态。"));
    return;
  }

  const recs = recommend(snapshot.comps, state).slice(0, 3);
  const best = recs[0];
  panel.replaceChildren();
  if (!best) {
    panel.append(text("div", "v043-empty", "当前没有通过安全门槛的阵容候选。"));
    return;
  }

  const heading = document.createElement("header");
  heading.className = "v043-heading";
  const titleWrap = document.createElement("div");
  titleWrap.append(text("strong", "v043-title", "V0.4.3 一眼决策"), text("span", "v043-subtitle", `当前优先：${best.comp.name} · Fit ${best.fitScore} · 完成度 ${best.completionScore}%`));
  heading.append(titleWrap, text("span", "v043-patch", snapshot.patch));
  panel.append(heading);

  const now = document.createElement("div");
  now.className = "v043-now";
  now.append(text("span", "v043-now-label", "现在先做"), text("strong", "v043-now-text", best.nextStep));
  panel.append(now);

  const gap = gapSummary(best, state);
  const grid = document.createElement("div");
  grid.className = "v043-grid";
  grid.append(
    listBlock("阵容缺口", [
      ...(gap.missingCore.length ? [`缺核心：${gap.missingCore.join(" / ")}`] : []),
      ...(gap.missingItems.length ? [`缺核心装：${gap.missingItems.join(" / ")}`] : []),
      ...(gap.levelGap ? [`人口还差 ${gap.levelGap} 级（目标≈${targetLevel(best.comp)}）`] : [])
    ], "核心牌/装备/人口已基本到位"),
    listBlock("装备冲突", itemConflicts(best, state), "未发现已记录装备的明显错配")
  );
  panel.append(grid);

  const shop = document.createElement("div");
  shop.className = "v043-section";
  shop.append(text("strong", "v043-section-title", "商店购买优先级"));
  const shopRow = document.createElement("div");
  shopRow.className = "v043-shop-row";
  const priorities = shopPriorities(recs, state);
  if (!priorities.length) {
    shopRow.append(text("span", "v043-muted", "当前商店为空。"));
  } else {
    for (const item of priorities) {
      const card = document.createElement("div");
      card.className = `v043-shop-card score-${item.score >= 90 ? "must" : item.score >= 60 ? "good" : item.score >= 40 ? "hold" : "skip"}`;
      card.append(text("span", "v043-slot", `#${item.slot}`), text("strong", "v043-hero", item.hero), text("span", "v043-label", item.label), text("small", "v043-reason", item.reason));
      if (item.interestRisk && item.score < 90) card.append(text("small", "v043-interest-risk", "买入会掉一档利息"));
      shopRow.append(card);
    }
  }
  shop.append(shopRow);
  panel.append(shop);

  const footerGrid = document.createElement("div");
  footerGrid.className = "v043-grid";
  const pivot = pivotAssessment(recs, state);
  const pivotBlock = document.createElement("div");
  pivotBlock.className = `v043-block pivot-${pivot.level}`;
  pivotBlock.append(text("strong", "v043-block-title", "转阵风险"), text("span", "v043-risk-title", pivot.title), text("span", "v043-line", pivot.detail));

  const scout = document.createElement("div");
  scout.className = "v043-block";
  scout.append(text("strong", "v043-block-title", "Top3 同行压力"));
  for (const rec of recs) scout.append(text("span", "v043-line", `${rec.comp.name}：同行 ${rec.contestedCount} · Fit ${rec.fitScore}`));
  footerGrid.append(pivotBlock, scout);
  panel.append(footerGrid);
}

function scheduleRender(delay = 120) {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, delay);
}

function bind() {
  byId<HTMLButtonElement>("decide")?.addEventListener("click", () => scheduleRender(0));
  byId<HTMLButtonElement>("next-round")?.addEventListener("click", () => scheduleRender(80));
  byId<HTMLButtonElement>("undo-round")?.addEventListener("click", () => scheduleRender(80));
  for (const id of ["stage", "level", "gold", "hp", "streak", "units", "bench", "items", "augments", "equipped"]) {
    byId<HTMLElement>(id)?.addEventListener("input", () => scheduleRender());
    byId<HTMLElement>(id)?.addEventListener("change", () => scheduleRender());
  }
  const observer = new MutationObserver(() => scheduleRender(160));
  const shop = byId<HTMLElement>("shop-slots");
  const results = byId<HTMLElement>("results");
  if (shop) observer.observe(shop, { childList: true, subtree: true });
  if (results) observer.observe(results, { childList: true, subtree: true });
}

function boot() {
  ensurePanel();
  bind();
  render();
  void refreshSnapshot();
}

boot();
