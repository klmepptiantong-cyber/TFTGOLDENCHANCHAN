import type { Comp, GameState, Recommendation, UnitCollection, UnitState } from "./types";
import { recommend } from "./recommender";

export type TrajectoryPoint = {
  capturedAt: string;
  state: GameState;
};

export type MacroDecisionKind =
  | "stabilize"
  | "pivot"
  | "chase-three"
  | "push-level"
  | "high-cap"
  | "commit"
  | "econ";

export type MacroUrgency = "now" | "soon" | "hold";

export type TrajectorySignals = {
  rounds: number;
  hpDelta: number;
  goldDelta: number;
  levelDelta: number;
  fitDelta: number;
  completionDelta: number;
  currentFit: number;
  currentCompletion: number;
  currentContested: number;
  currentBestCompId: string | null;
  currentBestCompName: string | null;
  lockedCompId: string | null;
  lockedFit: number | null;
  fitGapVsLocked: number | null;
};

export type TrajectoryFrame = {
  capturedAt: string;
  stage: string;
  hp: number;
  gold: number;
  level: number;
  bestCompId: string | null;
  bestCompName: string | null;
  bestFit: number;
  trackedFit: number;
  trackedCompletion: number;
};

export type MacroDecision = {
  kind: MacroDecisionKind;
  urgency: MacroUrgency;
  title: string;
  summary: string;
  evidence: string[];
  confidence: number;
  signals: TrajectorySignals;
  timeline: TrajectoryFrame[];
};

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

function unitCopies(value: number | UnitState | undefined): number {
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

function targetLevel(comp: Comp): number {
  const fiveCosts = (comp.sourceLineup ?? []).filter((unit) => unit.price === 5).length;
  if (/95|九五/.test(comp.name) || fiveCosts >= 3 || comp.stagePlan.some((line) => /9\s*人口|九人口/.test(line))) return 9;
  const carryCost = comp.sourceCarries?.find((carry) => carry.role === "carry")?.price ?? null;
  if (carryCost !== null && carryCost <= 2) return 6;
  if (carryCost === 3) return 7;
  return 8;
}

function recommendationFor(recs: Recommendation[], compId: string | null | undefined): Recommendation | null {
  if (!compId) return null;
  return recs.find((rec) => rec.comp.id === compId) ?? null;
}

function chaseCandidate(comp: Comp, state: GameState): { hero: string; copies: number; price: number | null } | null {
  const owned = mergeOwned(state.units, state.bench);
  const rerollNamed = /赌|追三/.test(comp.name);
  const candidates = (comp.sourceCarries ?? [])
    .filter((carry) => carry.role === "carry" && carry.price !== null && carry.price <= 3 && (carry.targetStars === 3 || rerollNamed))
    .map((carry) => ({ hero: carry.name, copies: owned[carry.name] ?? 0, price: carry.price }))
    .filter((entry) => entry.copies >= 5)
    .sort((a, b) => b.copies - a.copies || (a.price ?? 9) - (b.price ?? 9));
  return candidates[0] ?? null;
}

function highCap(comp: Comp): boolean {
  return targetLevel(comp) === 9;
}

function confidenceFor(rounds: number, currentFit: number, currentCompletion: number): number {
  const history = Math.min(45, Math.max(0, rounds - 1) * 12);
  const signal = Math.min(20, Math.round((currentFit + currentCompletion) / 10));
  return Math.max(35, Math.min(95, 35 + history + signal));
}

function frames(comps: Comp[], points: TrajectoryPoint[], trackedCompId: string | null): TrajectoryFrame[] {
  return points.map((point) => {
    const recs = recommend(comps, point.state).slice(0, 3);
    const best = recs[0] ?? null;
    const tracked = recommendationFor(recs, trackedCompId);
    return {
      capturedAt: point.capturedAt,
      stage: point.state.stage,
      hp: point.state.hp,
      gold: point.state.gold,
      level: point.state.level,
      bestCompId: best?.comp.id ?? null,
      bestCompName: best?.comp.name ?? null,
      bestFit: best?.fitScore ?? 0,
      trackedFit: tracked?.fitScore ?? 0,
      trackedCompletion: tracked?.completionScore ?? 0
    };
  });
}

function trackedProgress(comps: Comp[], points: TrajectoryPoint[], compId: string): { fit: number; completion: number }[] {
  return points.map((point) => {
    const rec = recommendationFor(recommend(comps, point.state).slice(0, 3), compId);
    return { fit: rec?.fitScore ?? 0, completion: rec?.completionScore ?? 0 };
  });
}

function delta(values: number[]): number {
  if (values.length < 2) return 0;
  return values.at(-1)! - values[0];
}

function repeatedBest(framesInput: TrajectoryFrame[]): number {
  if (framesInput.length < 2) return 0;
  const lastId = framesInput.at(-1)?.bestCompId;
  if (!lastId) return 0;
  let count = 0;
  for (let index = framesInput.length - 1; index >= 0; index -= 1) {
    if (framesInput[index].bestCompId !== lastId) break;
    count += 1;
  }
  return count;
}

export function analyzeTrajectory(comps: Comp[], input: TrajectoryPoint[]): MacroDecision {
  const points = input.slice(-7);
  const currentPoint = points.at(-1);
  if (!currentPoint) {
    const emptySignals: TrajectorySignals = {
      rounds: 0,
      hpDelta: 0,
      goldDelta: 0,
      levelDelta: 0,
      fitDelta: 0,
      completionDelta: 0,
      currentFit: 0,
      currentCompletion: 0,
      currentContested: 0,
      currentBestCompId: null,
      currentBestCompName: null,
      lockedCompId: null,
      lockedFit: null,
      fitGapVsLocked: null
    };
    return {
      kind: "econ",
      urgency: "hold",
      title: "等待回合数据",
      summary: "至少录入当前回合后才能建立整局运营轨迹。",
      evidence: ["暂无可分析的回合状态"],
      confidence: 0,
      signals: emptySignals,
      timeline: []
    };
  }

  const currentRecs = recommend(comps, currentPoint.state).slice(0, 3);
  const best = currentRecs[0] ?? null;
  const locked = recommendationFor(currentRecs, currentPoint.state.lockedCompId);
  const trackedCompId = best?.comp.id ?? currentPoint.state.lockedCompId ?? null;
  const timeline = frames(comps, points, trackedCompId);
  const hpDelta = delta(timeline.map((frame) => frame.hp));
  const goldDelta = delta(timeline.map((frame) => frame.gold));
  const levelDelta = delta(timeline.map((frame) => frame.level));
  const fitDelta = delta(timeline.map((frame) => frame.trackedFit));
  const completionDelta = delta(timeline.map((frame) => frame.trackedCompletion));
  const currentContested = best?.contestedCount ?? 0;
  const fitGapVsLocked = best && locked ? best.fitScore - locked.fitScore : null;
  const signals: TrajectorySignals = {
    rounds: timeline.length,
    hpDelta,
    goldDelta,
    levelDelta,
    fitDelta,
    completionDelta,
    currentFit: best?.fitScore ?? 0,
    currentCompletion: best?.completionScore ?? 0,
    currentContested,
    currentBestCompId: best?.comp.id ?? null,
    currentBestCompName: best?.comp.name ?? null,
    lockedCompId: currentPoint.state.lockedCompId ?? null,
    lockedFit: locked?.fitScore ?? null,
    fitGapVsLocked
  };
  const confidence = confidenceFor(timeline.length, signals.currentFit, signals.currentCompletion);
  const evidence: string[] = [
    `近 ${timeline.length} 个状态点：血量 ${hpDelta >= 0 ? "+" : ""}${hpDelta}，金币 ${goldDelta >= 0 ? "+" : ""}${goldDelta}，人口 ${levelDelta >= 0 ? "+" : ""}${levelDelta}`,
    `当前 ${best?.comp.name ?? "无候选"}：Fit ${signals.currentFit}，完成度 ${signals.currentCompletion}%`
  ];

  if (!best) {
    return {
      kind: "stabilize",
      urgency: "now",
      title: "先保当前最强战力",
      summary: "没有阵容通过当前安全门槛，先用两星与通用装备止血，不要为了榜单阵容强转。",
      evidence: [...evidence, "当前没有通过安全门槛的候选阵容"],
      confidence,
      signals,
      timeline
    };
  }

  const state = currentPoint.state;
  const target = targetLevel(best.comp);
  const lastThree = timeline.slice(-3);
  const recentHpDelta = delta(lastThree.map((frame) => frame.hp));
  const stagnating = lastThree.length >= 3
    && Math.abs(delta(lastThree.map((frame) => frame.trackedFit))) <= 3
    && Math.abs(delta(lastThree.map((frame) => frame.trackedCompletion))) <= 5;
  const stableBestRounds = repeatedBest(timeline);
  const chase = chaseCandidate(best.comp, state);

  if (state.hp <= 25 || recentHpDelta <= -20 || (state.hp <= 40 && hpDelta <= -25)) {
    return {
      kind: "stabilize",
      urgency: "now",
      title: "立即止血",
      summary: `血量轨迹已经进入危险线。停止为利息或完美阵容硬扛，优先在 ${state.level} 人口把主C/前排补到可打质量。`,
      evidence: unique([...evidence, `当前血量 ${state.hp}`, `近3个状态点血量变化 ${recentHpDelta}`, "危险血量下即时战力优先于长期经济"]),
      confidence,
      signals,
      timeline
    };
  }

  if (state.lockedCompId && locked && best.comp.id !== locked.comp.id) {
    const gap = best.fitScore - locked.fitScore;
    const lockContested = locked.contestedCount;
    const lockProgress = trackedProgress(comps, points, locked.comp.id).slice(-3);
    const lockStagnating = lockProgress.length >= 3
      && Math.abs(delta(lockProgress.map((entry) => entry.fit))) <= 3
      && Math.abs(delta(lockProgress.map((entry) => entry.completion))) <= 5;
    if (gap >= 12 || lockContested >= 3 || (lockStagnating && gap >= 6) || (state.hp <= 45 && gap >= 8)) {
      return {
        kind: "pivot",
        urgency: state.hp <= 45 || gap >= 15 ? "now" : "soon",
        title: "触发止损转阵",
        summary: `${best.comp.name} 已经明显优于锁定方向 ${locked.comp.name}。先保留共用牌/装备，再逐步退出低价值沉没成本。`,
        evidence: unique([...evidence, `新方向领先锁阵 ${gap} Fit`, `锁阵同行 ${lockContested}`, lockStagnating ? "近3个状态点锁阵自身进度基本停滞" : "锁阵自身进度仍有变化"]),
        confidence,
        signals,
        timeline
      };
    }
  }

  if (chase && state.hp >= 35 && state.gold >= 25 && currentContested <= 2 && state.level >= target) {
    return {
      kind: "chase-three",
      urgency: chase.copies >= 7 ? "now" : "soon",
      title: `进入追三窗口：${chase.hero}`,
      summary: `已持有 ${chase.hero} ${chase.copies} 张，且当前血量/经济允许。暂缓无收益升级，把资源集中到该费用段的三星窗口。`,
      evidence: unique([...evidence, `${chase.hero} 已有 ${chase.copies}/9`, `当前金币 ${state.gold}`, `同行 ${currentContested}`, `目标搜牌人口≈${target}`]),
      confidence,
      signals,
      timeline
    };
  }

  if (highCap(best.comp) && state.hp >= 60 && state.gold >= 45 && state.level < 9 && state.streak !== undefined && state.streak >= 1) {
    return {
      kind: "high-cap",
      urgency: "soon",
      title: "保连胜冲9上限",
      summary: `${best.comp.name} 属于高人口上限阵容。当前血量与经济允许优先把钱转成人口，不要在中期为小幅质量提升过度D牌。`,
      evidence: unique([...evidence, `当前血量 ${state.hp}`, `金币 ${state.gold}`, `连胜/败 ${state.streak}`, "目标人口=9"]),
      confidence,
      signals,
      timeline
    };
  }

  if (state.level < target && state.gold >= 50 && state.hp >= 55 && best.fitScore >= 58) {
    return {
      kind: "push-level",
      urgency: "soon",
      title: `经济转人口：向 ${target} 级推进`,
      summary: "当前局势没有要求立刻D牌止血。保持主要体系牌，优先完成关键人口节点，再把剩余经济用于集中搜牌。",
      evidence: unique([...evidence, `目标人口≈${target}`, `当前金币 ${state.gold}`, `当前血量 ${state.hp}`, `当前 Fit ${best.fitScore}`]),
      confidence,
      signals,
      timeline
    };
  }

  if (best.fitScore >= 76 && best.completionScore >= 58 && currentContested <= 2 && (fitDelta >= -3 || stableBestRounds >= 2)) {
    return {
      kind: "commit",
      urgency: "hold",
      title: `继续收束 ${best.comp.name}`,
      summary: `连续轨迹仍支持当前方向。不要因为单轮商店没来牌就推翻阵容，围绕核心缺口和当前经济窗口继续补强。`,
      evidence: unique([...evidence, `当前方向连续保持 Top1 ${stableBestRounds} 个状态点`, `Fit趋势 ${fitDelta >= 0 ? "+" : ""}${fitDelta}`, `完成度趋势 ${completionDelta >= 0 ? "+" : ""}${completionDelta}`, `同行 ${currentContested}`]),
      confidence,
      signals,
      timeline
    };
  }

  if (state.hp >= 60 && state.gold < 30 && state.streak !== undefined && state.streak >= 0) {
    return {
      kind: "econ",
      urgency: "hold",
      title: "先把经济重新做起来",
      summary: "血量还有容错，但经济已经偏低。除非下一轮出现直接两星/关键羁绊，否则减少无目的购买和刷新，先恢复利息。",
      evidence: unique([...evidence, `当前血量 ${state.hp}`, `当前金币 ${state.gold}`, "暂未触发危险血量或强制转阵条件"]),
      confidence,
      signals,
      timeline
    };
  }

  return {
    kind: "commit",
    urgency: "soon",
    title: `再观察 1–2 轮：${best.comp.name}`,
    summary: "当前数据不足以支持激进转阵或强搜。保持可转型的体系牌，下一轮重点观察 Fit、完成度和血量是否继续恶化。",
    evidence: unique([...evidence, stagnating ? "近期进度偏慢，但尚未达到强制止损阈值" : "当前轨迹仍在变化", `同行 ${currentContested}`]),
    confidence,
    signals,
    timeline
  };
}
