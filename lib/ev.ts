import type { Recommendation } from "./types";
import type { PoolState } from "./pool";

export type EvMode = "relative-only" | "probabilistic";

export type RouteEv = {
  compId: string;
  compName: string;
  mode: EvMode;
  relativeEv: number;
  estimatedTop4?: number;
  estimatedTop1?: number;
  expectedPlacement?: number;
  risk8th?: number;
  confidence: number;
  evidence: string[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function relativeRouteEv(rec: Recommendation, pool?: PoolState | null): RouteEv {
  const targetPressure = rec.comp.coreUnits
    .map((hero) => pool?.heroes[hero]?.pressure ?? 0)
    .reduce((sum, value) => sum + value, 0) / Math.max(1, rec.comp.coreUnits.length);
  const contestPenalty = Math.min(24, rec.contestedCount * 6);
  const poolPenalty = Math.round(targetPressure * 22);
  const relativeEv = clamp(
    rec.fitScore * 0.36
    + rec.completionScore * 0.24
    + rec.metaScore * 0.22
    + rec.confidence * 0.18
    - contestPenalty
    - poolPenalty
  );
  const evidence = [
    `Fit ${rec.fitScore}`,
    `完成度 ${rec.completionScore}%`,
    `Meta ${rec.metaScore.toFixed(1)}`,
    `同行 ${rec.contestedCount}`
  ];
  if (pool) evidence.push(`核心牌平均池压力 ${Math.round(targetPressure * 100)}%`);
  if (pool?.precisionBlocked) evidence.push("当前规则未完成精确核验：只输出相对EV，不输出伪精确Top4/Top1概率");

  return {
    compId: rec.comp.id,
    compName: rec.comp.name,
    mode: "relative-only",
    relativeEv: Math.round(relativeEv * 10) / 10,
    confidence: clamp(rec.confidence - (pool?.precisionBlocked ? 12 : 0)),
    evidence
  };
}

export function rankRoutesByEv(recommendations: Recommendation[], pool?: PoolState | null): RouteEv[] {
  return recommendations
    .map((rec) => relativeRouteEv(rec, pool))
    .sort((a, b) => b.relativeEv - a.relativeEv);
}
