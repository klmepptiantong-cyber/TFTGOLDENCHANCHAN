import "./v070.css";
import embeddedSnapshotJson from "../../data/latest.json";
import { fuzzyHeroMatch, type OcrFrame } from "../../lib/recognition";
import {
  deriveScoutingSummary,
  heroCatalogFromSnapshot,
  type OpponentScoutSnapshot,
  type ScoutingSummary
} from "../../lib/scouting";
import { clearRuntimeScouting, setRuntimeScouting } from "../../lib/scouting-runtime";
import type { MetaSnapshot } from "../../lib/types";

const STORAGE_KEY = "tftgolden.scouting.v070";
const SNAPSHOT_URL = "https://raw.githubusercontent.com/klmepptiantong-cyber/TFTGOLDENCHANCHAN/main/data/latest.json";
const embeddedSnapshot = embeddedSnapshotJson as unknown as MetaSnapshot;

let snapshot: MetaSnapshot = embeddedSnapshot;
let scouts = loadScouts();
let visionCandidates: Record<string, number> = {};
let lastVisionCandidateAt = 0;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function loadScouts(): OpponentScoutSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is OpponentScoutSnapshot => Boolean(item) && typeof item === "object")
      .map((item) => ({
        playerId: String(item.playerId ?? "").trim().slice(0, 24),
        alive: item.alive !== false,
        units: normalizeUnitMap(item.units),
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
        observedAt: Number(item.observedAt) || 0,
        source: item.source === "vision-candidate" ? "vision-candidate" : "manual"
      }))
      .filter((item) => item.playerId)
      .slice(0, 7);
  } catch {
    return [];
  }
}

function normalizeUnitMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([hero, raw]) => [hero.trim(), Math.max(0, Math.min(9, Math.round(Number(raw) || 0)))] as const)
      .filter(([hero, copies]) => Boolean(hero) && copies > 0)
      .slice(0, 20)
  );
}

function parseUnits(value: string): Record<string, number> {
  const known = new Set(heroCatalogFromSnapshot(snapshot).map((hero) => hero.name));
  const result: Record<string, number> = {};
  for (const token of value.split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean)) {
    const match = token.match(/^(.+?)(?:\s*[=xX*×]\s*(\d+))?$/);
    if (!match) continue;
    const hero = match[1].trim();
    if (!known.has(hero)) continue;
    const copies = Math.max(1, Math.min(9, Math.round(Number(match[2] ?? 1))));
    result[hero] = Math.max(result[hero] ?? 0, copies);
  }
  return result;
}

function serializeUnits(units: Record<string, number>): string {
  return Object.entries(units)
    .filter(([, copies]) => copies > 0)
    .map(([hero, copies]) => `${hero}=${copies}`)
    .join(", ");
}

function persistScouts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scouts));
}

function compName(id: string): string {
  return snapshot.comps.find((comp) => comp.id === id)?.name ?? id;
}

function applySummary(triggerDecision = true): ScoutingSummary {
  const summary = deriveScoutingSummary(snapshot, scouts);
  setRuntimeScouting({
    contestedComps: summary.contestedComps,
    poolPressureByHero: summary.poolPressureByHero
  });
  renderSummary(summary);
  renderScoutList();
  if (triggerDecision) byId<HTMLButtonElement>("decide")?.click();
  return summary;
}

function renderSummary(summary: ScoutingSummary) {
  const status = byId<HTMLElement>("scout-status");
  if (status) {
    const active = summary.observedAlivePlayers.length;
    status.textContent = active ? `已记录 ${active} 名存活对手` : "尚未记录对手";
    status.dataset.kind = active ? "ok" : "warn";
  }

  const contest = byId<HTMLElement>("scout-contested");
  if (contest) {
    const rows = Object.entries(summary.contestedComps)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, count]) => `${compName(id)} ×${count}`);
    contest.textContent = rows.length ? `同行：${rows.join(" · ")}` : "同行：暂无明确重合";
  }

  const pressure = byId<HTMLElement>("scout-pressure");
  if (pressure) {
    const rows = summary.highPressureHeroes
      .slice(0, 5)
      .map((item) => `${item.hero} ${(item.pressure * 100).toFixed(0)}%`);
    pressure.textContent = rows.length ? `相对卡池压力：${rows.join(" · ")}` : "相对卡池压力：暂无明显拥挤";
  }

  const precision = byId<HTMLElement>("scout-precision-note");
  if (precision) {
    precision.textContent = summary.precisionBlocked
      ? "规则仍为 provisional：只用于相对压力/转阵，不输出精确命中率。"
      : "规则已核验：压力信号可用于后续精确概率层。";
  }
}

function renderScoutList() {
  const list = byId<HTMLElement>("scout-list");
  if (!list) return;
  list.replaceChildren();
  const ordered = [...scouts].sort((a, b) => b.observedAt - a.observedAt);
  if (!ordered.length) {
    const empty = document.createElement("span");
    empty.className = "v070-empty";
    empty.textContent = "还没有对手快照";
    list.append(empty);
    return;
  }

  for (const scout of ordered) {
    const row = document.createElement("div");
    row.className = "v070-scout-row";
    const text = document.createElement("span");
    const units = Object.entries(scout.units)
      .slice(0, 6)
      .map(([hero, copies]) => `${hero}${copies > 1 ? `×${copies}` : ""}`)
      .join("/");
    text.textContent = `${scout.alive ? "●" : "○"} ${scout.playerId} · ${units || "已淘汰"}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => {
      scouts = scouts.filter((item) => item.playerId !== scout.playerId);
      persistScouts();
      applySummary();
    });
    row.append(text, remove);
    list.append(row);
  }
}

function renderVisionCandidates() {
  const node = byId<HTMLElement>("scout-ocr-candidates");
  if (!node) return;
  const values = Object.keys(visionCandidates);
  node.textContent = values.length
    ? `OCR 候选：${values.join(" / ")}（未写入）`
    : "OCR 候选：暂无可靠英雄文本";
}

function extractVisionCandidates(frame: OcrFrame): Record<string, number> {
  const heroes = heroCatalogFromSnapshot(snapshot).map((hero) => hero.name);
  const best = new Map<string, number>();
  for (const block of frame.blocks ?? []) {
    if (block.confidence < 0.58) continue;
    const centerY = (block.y + block.height / 2) / Math.max(1, frame.height);
    if (centerY >= 0.62) continue;
    if (/阶段|回合|金币|血量|生命|等级|人口|level|gold|hp/i.test(block.text)) continue;
    const matched = fuzzyHeroMatch(block.text, heroes);
    if (!matched) continue;
    const confidence = Math.max(0, Math.min(1, block.confidence * matched.score));
    if (confidence < 0.66) continue;
    best.set(matched.hero, Math.max(best.get(matched.hero) ?? 0, confidence));
  }
  return Object.fromEntries([...best.entries()].slice(0, 10).map(([hero]) => [hero, 1]));
}

function onVisionState(event: Event) {
  const detail = (event as CustomEvent<{ frame?: OcrFrame }>).detail;
  if (!detail?.frame) return;
  visionCandidates = extractVisionCandidates(detail.frame);
  lastVisionCandidateAt = Date.now();
  renderVisionCandidates();
}

function saveScout() {
  const playerInput = byId<HTMLInputElement>("scout-player");
  const aliveInput = byId<HTMLInputElement>("scout-alive");
  const unitsInput = byId<HTMLTextAreaElement>("scout-units");
  if (!playerInput || !aliveInput || !unitsInput) return;
  const playerId = playerInput.value.trim().slice(0, 24);
  if (!playerId) {
    playerInput.focus();
    return;
  }

  const manual = parseUnits(unitsInput.value);
  const useVision = !Object.keys(manual).length && Object.keys(visionCandidates).length > 0 && Date.now() - lastVisionCandidateAt < 15_000;
  const units = Object.keys(manual).length ? manual : (useVision ? visionCandidates : {});
  if (aliveInput.checked && !Object.keys(units).length) {
    unitsInput.focus();
    return;
  }

  const next: OpponentScoutSnapshot = {
    playerId,
    alive: aliveInput.checked,
    units,
    confidence: Object.keys(manual).length ? 1 : 0.68,
    observedAt: Date.now(),
    source: Object.keys(manual).length ? "manual" : "vision-candidate"
  };
  scouts = [next, ...scouts.filter((item) => item.playerId !== playerId)].slice(0, 7);
  persistScouts();
  applySummary();
  playerInput.value = nextPlayerId();
  unitsInput.value = "";
  aliveInput.checked = true;
}

function nextPlayerId(): string {
  for (let index = 1; index <= 7; index += 1) {
    const candidate = `P${index}`;
    if (!scouts.some((item) => item.playerId === candidate)) return candidate;
  }
  return "P1";
}

function mountPanel() {
  if (byId("scouting-v070")) return;
  const host = byId<HTMLElement>("vision-panel");
  if (!host) {
    window.setTimeout(mountPanel, 150);
    return;
  }
  const ruleStatus = host.querySelector(".v060-rule-status");
  const block = document.createElement("div");
  block.id = "scouting-v070";
  block.className = "v070-block";
  block.innerHTML = `
    <div class="v070-head">
      <div>
        <strong>V0.7 OPPONENT SCOUTING</strong>
        <span id="scout-status" data-kind="warn">尚未记录对手</span>
      </div>
      <button id="scout-clear" type="button">清空侦察</button>
    </div>
    <div class="v070-entry">
      <input id="scout-player" value="${nextPlayerId()}" aria-label="对手编号" />
      <label class="v070-alive"><input id="scout-alive" type="checkbox" checked /> 存活</label>
      <button id="scout-use-ocr" type="button">填入 OCR 候选</button>
    </div>
    <textarea id="scout-units" rows="2" placeholder="例如：蛇女=2, 洛=2, 阿木木=1"></textarea>
    <div id="scout-ocr-candidates" class="v070-candidate">OCR 候选：暂无可靠英雄文本</div>
    <button id="scout-save" class="v070-save" type="button">保存/更新该对手</button>
    <div class="v070-summary">
      <div id="scout-contested">同行：暂无明确重合</div>
      <div id="scout-pressure">相对卡池压力：暂无明显拥挤</div>
      <small id="scout-precision-note"></small>
    </div>
    <div id="scout-list" class="v070-list"></div>
  `;
  host.insertBefore(block, ruleStatus ?? null);

  byId<HTMLButtonElement>("scout-save")?.addEventListener("click", saveScout);
  byId<HTMLButtonElement>("scout-use-ocr")?.addEventListener("click", () => {
    const input = byId<HTMLTextAreaElement>("scout-units");
    if (input) input.value = serializeUnits(visionCandidates);
  });
  byId<HTMLButtonElement>("scout-clear")?.addEventListener("click", () => {
    scouts = [];
    visionCandidates = {};
    localStorage.removeItem(STORAGE_KEY);
    clearRuntimeScouting();
    renderVisionCandidates();
    applySummary();
  });

  renderVisionCandidates();
  applySummary(false);
}

async function refreshSnapshot() {
  try {
    const response = await fetch(`${SNAPSHOT_URL}?scout=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const candidate = await response.json() as MetaSnapshot;
    if (!candidate?.comps?.length) return;
    snapshot = candidate;
    applySummary(false);
  } catch {
    // Embedded snapshot remains available offline.
  }
}

function boot() {
  window.addEventListener("tft-vision-state", onVisionState);
  mountPanel();
  void refreshSnapshot();
  window.setInterval(() => void refreshSnapshot(), 15 * 60 * 1000);
}

boot();
