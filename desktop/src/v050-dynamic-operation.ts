import "./v050.css";
import embeddedSnapshotJson from "../../data/latest.json";
import { parseGameState } from "../../lib/game-state";
import { analyzeTrajectory, type MacroDecision, type TrajectoryPoint } from "../../lib/trajectory";
import type { GameState, MetaSnapshot } from "../../lib/types";

const SNAPSHOT_URL = "https://raw.githubusercontent.com/klmepptiantong-cyber/TFTGOLDENCHANCHAN/main/data/latest.json";
const HISTORY_KEY = "tftgolden.history.v042";
const embeddedSnapshot = embeddedSnapshotJson as unknown as MetaSnapshot;
let snapshot: MetaSnapshot = embeddedSnapshot;
let renderTimer = 0;

type StoredHistoryPoint = {
  capturedAt: string;
  stage: string;
  form: string | null;
  lockedCompId: string | null;
  contested: string | null;
};

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

function countMap(raw: string | null): Record<string, number> {
  const parsed = safeJson<Record<string, unknown>>(raw, {});
  return Object.fromEntries(Object.entries(parsed).map(([id, value]) => [id, Math.max(0, Math.min(7, Math.round(Number(value) || 0)))]));
}

function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stateFromSaved(formRaw: string | null, lockedCompId: string | null, contestedRaw: string | null): GameState | null {
  const saved = safeJson<Record<string, string>>(formRaw, {});
  if (!Object.keys(saved).length) return null;
  try {
    return parseGameState({
      stage: saved.stage || "?",
      level: numberFrom(saved.level, 6),
      gold: numberFrom(saved.gold, 0),
      hp: numberFrom(saved.hp, 100),
      streak: numberFrom(saved.streak, 0),
      shop: parseList(saved.shop ?? "").slice(0, 5),
      units: parseUnits(saved.units ?? ""),
      bench: parseUnits(saved.bench ?? ""),
      items: parseList(saved.items ?? ""),
      augments: parseList(saved.augments ?? ""),
      equippedItems: parseEquipped(saved.equipped ?? ""),
      lockedCompId: lockedCompId || undefined,
      contestedComps: countMap(contestedRaw)
    });
  } catch {
    return null;
  }
}

function currentState(): GameState | null {
  const saved: Record<string, string> = {};
  for (const id of ["stage", "level", "gold", "hp", "streak", "shop", "units", "bench", "items", "augments", "equipped"]) {
    const element = byId<HTMLInputElement | HTMLTextAreaElement>(id);
    if (element) saved[id] = element.value;
  }
  try {
    return stateFromSaved(
      JSON.stringify(saved),
      localStorage.getItem("tftgolden.lockedCompId"),
      localStorage.getItem("tftgolden.contested")
    );
  } catch {
    return null;
  }
}

function trajectoryPoints(): TrajectoryPoint[] {
  const stored = safeJson<StoredHistoryPoint[]>(localStorage.getItem(HISTORY_KEY), [])
    .filter((point) => point && typeof point === "object")
    .slice(-6);
  const points: TrajectoryPoint[] = [];
  for (const point of stored) {
    const state = stateFromSaved(point.form, point.lockedCompId, point.contested);
    if (state) points.push({ capturedAt: point.capturedAt, state });
  }
  const current = currentState();
  if (current) {
    const last = points.at(-1);
    const duplicate = last && last.state.stage === current.stage && last.state.hp === current.hp && last.state.gold === current.gold && last.state.level === current.level;
    if (!duplicate) points.push({ capturedAt: new Date().toISOString(), state: current });
    else points[points.length - 1] = { capturedAt: new Date().toISOString(), state: current };
  }
  return points.slice(-7);
}

function validSnapshot(value: unknown): value is MetaSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MetaSnapshot>;
  return typeof candidate.patch === "string" && Array.isArray(candidate.comps) && candidate.comps.length > 0;
}

async function refreshSnapshot() {
  try {
    const response = await fetch(`${SNAPSHOT_URL}?v050=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const candidate: unknown = await response.json();
    if (!validSnapshot(candidate)) throw new Error("invalid snapshot");
    snapshot = candidate;
  } catch {
    snapshot = embeddedSnapshot;
  }
  scheduleRender(0);
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

function ensurePanel(): HTMLElement {
  let panel = byId<HTMLElement>("v050-trajectory-panel");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.id = "v050-trajectory-panel";
  panel.className = "v050-panel";
  const speed = byId<HTMLElement>("v043-speed-panel");
  if (speed) speed.insertAdjacentElement("afterend", panel);
  else byId<HTMLElement>("results")?.insertAdjacentElement("afterend", panel);
  return panel;
}

function signed(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function kindLabel(decision: MacroDecision): string {
  const labels: Record<MacroDecision["kind"], string> = {
    stabilize: "止血",
    pivot: "转阵",
    "chase-three": "追三",
    "push-level": "提人口",
    "high-cap": "冲9",
    commit: "收束",
    econ: "经济"
  };
  return labels[decision.kind];
}

function urgencyLabel(decision: MacroDecision): string {
  if (decision.urgency === "now") return "现在执行";
  if (decision.urgency === "soon") return "下一窗口";
  return "继续观察";
}

function metric(label: string, value: string, tone: "good" | "bad" | "neutral" = "neutral"): HTMLElement {
  const node = document.createElement("div");
  node.className = `v050-metric ${tone}`;
  node.append(text("span", "v050-metric-label", label), text("strong", "v050-metric-value", value));
  return node;
}

function metricTone(value: number, positiveGood = true): "good" | "bad" | "neutral" {
  if (value === 0) return "neutral";
  const good = positiveGood ? value > 0 : value < 0;
  return good ? "good" : "bad";
}

function renderTimeline(decision: MacroDecision): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "v050-timeline";
  const maxFit = Math.max(1, ...decision.timeline.map((frame) => frame.trackedFit));
  for (const frame of decision.timeline) {
    const row = document.createElement("div");
    row.className = "v050-timeline-row";
    const stage = text("span", "v050-stage", frame.stage);
    const barWrap = document.createElement("div");
    barWrap.className = "v050-bar-wrap";
    const bar = document.createElement("span");
    bar.className = "v050-bar";
    bar.style.width = `${Math.max(5, Math.round((frame.trackedFit / maxFit) * 100))}%`;
    barWrap.append(bar);
    const stats = text("span", "v050-frame-stats", `Fit ${frame.trackedFit} · ${frame.trackedCompletion}% · HP ${frame.hp} · ${frame.gold}g`);
    row.append(stage, barWrap, stats);
    wrap.append(row);
  }
  return wrap;
}

function render() {
  const panel = ensurePanel();
  const points = trajectoryPoints();
  const decision = analyzeTrajectory(snapshot.comps, points);
  panel.replaceChildren();

  const head = document.createElement("header");
  head.className = `v050-head kind-${decision.kind} urgency-${decision.urgency}`;
  const titleWrap = document.createElement("div");
  titleWrap.append(
    text("span", "v050-eyebrow", `V0.5 整局运营 · ${kindLabel(decision)} · ${urgencyLabel(decision)}`),
    text("strong", "v050-title", decision.title),
    text("span", "v050-summary", decision.summary)
  );
  const confidence = text("span", "v050-confidence", `置信 ${decision.confidence}%`);
  head.append(titleWrap, confidence);
  panel.append(head);

  const metrics = document.createElement("div");
  metrics.className = "v050-metrics";
  metrics.append(
    metric("血量轨迹", signed(decision.signals.hpDelta), metricTone(decision.signals.hpDelta)),
    metric("Fit趋势", signed(decision.signals.fitDelta), metricTone(decision.signals.fitDelta)),
    metric("完成度", signed(decision.signals.completionDelta, "%"), metricTone(decision.signals.completionDelta)),
    metric("金币变化", signed(decision.signals.goldDelta), metricTone(decision.signals.goldDelta)),
    metric("人口变化", signed(decision.signals.levelDelta), metricTone(decision.signals.levelDelta)),
    metric("同行", String(decision.signals.currentContested), decision.signals.currentContested >= 3 ? "bad" : decision.signals.currentContested <= 1 ? "good" : "neutral")
  );
  panel.append(metrics);

  const body = document.createElement("div");
  body.className = "v050-body";
  const evidence = document.createElement("div");
  evidence.className = "v050-evidence";
  evidence.append(text("strong", "v050-section-title", "为什么这样判断"));
  for (const line of decision.evidence.slice(0, 5)) evidence.append(text("span", "v050-evidence-line", line));
  body.append(evidence);

  const timelineBox = document.createElement("div");
  timelineBox.className = "v050-timeline-box";
  timelineBox.append(text("strong", "v050-section-title", `最近 ${decision.timeline.length} 个状态点`), renderTimeline(decision));
  body.append(timelineBox);
  panel.append(body);

  if (decision.signals.lockedCompId && decision.signals.fitGapVsLocked !== null) {
    const lock = document.createElement("div");
    lock.className = "v050-lock-strip";
    lock.textContent = `锁阵Fit ${decision.signals.lockedFit ?? 0} · 当前最佳领先 ${signed(decision.signals.fitGapVsLocked)} Fit`;
    panel.append(lock);
  }
}

function scheduleRender(delay = 120) {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, delay);
}

function bind() {
  for (const id of ["stage", "level", "gold", "hp", "streak", "units", "bench", "items", "augments", "equipped"]) {
    byId<HTMLElement>(id)?.addEventListener("input", () => scheduleRender());
    byId<HTMLElement>(id)?.addEventListener("change", () => scheduleRender());
  }
  for (const id of ["decide", "next-round", "undo-round", "unlock"]) {
    byId<HTMLButtonElement>(id)?.addEventListener("click", () => scheduleRender(80));
  }
  window.addEventListener("storage", () => scheduleRender(80));
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
