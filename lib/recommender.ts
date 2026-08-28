import { Comp, GameState, Recommendation } from "./types";
import { confidenceScore, discoveryScore, metaScore } from "./scoring";

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x));

function fitScore(comp: Comp, state: GameState): number {
  const owned = Object.keys(state.units);
  const coreHits = overlap(comp.coreUnits, owned).reduce(
    (sum, unit) => sum + Math.min(state.units[unit] ?? 0, 3),
    0
  );
  const flexHits = overlap(comp.flexUnits, owned).length;
  const itemHits = overlap(comp.keyItems, state.items).length;

  const unitScore = Math.min(45, coreHits * 8 + flexHits * 3);
  const itemScore = Math.min(25, itemHits * 8);
  const economyScore = state.gold >= 50 ? 15 : state.gold >= 30 ? 11 : state.gold >= 20 ? 7 : 3;
  const hpScore = state.hp >= 70 ? 15 : state.hp >= 45 ? 10 : 5;

  return Math.min(100, Math.round(unitScore + itemScore + economyScore + hpScore));
}

function nextStep(comp: Comp, state: GameState): string {
  if (state.hp <= 35) return `血量危险：当前阶段 ${state.stage} 优先D出两星核心，质量达标后再存钱。`;
  if (comp.stagePlanSource === "derived-economy-v1") {
    return comp.stagePlan[0] ?? "优先补齐核心两星与关键羁绊。";
  }
  if (state.gold >= 50 && state.level < 8) return `经济健康：维持利息，按 ${comp.name} 的节奏升级人口，避免无目的刷新。`;
  return comp.stagePlan[0] ?? "优先补齐核心两星与关键羁绊。";
}

export function recommend(comps: Comp[], state: GameState): Recommendation[] {
  const owned = Object.keys(state.units);

  return comps
    .filter((comp) => !comp.needsEnrichment && comp.coreUnits.length > 0 && comp.stagePlan.length > 0)
    .map((comp) => {
      const fit = fitScore(comp, state);
      const meta = metaScore(comp);
      const discovery = discoveryScore(comp);
      const keep = [...comp.coreUnits, ...comp.flexUnits].filter((u) => owned.includes(u));
      const sell = owned.filter((u) => !comp.coreUnits.includes(u) && !comp.flexUnits.includes(u));
      const reasons: string[] = [];

      if (keep.length) reasons.push(`已有 ${keep.length} 张体系牌命中`);
      if (overlap(comp.keyItems, state.items).length) reasons.push("当前装备与核心装备方向匹配");
      if (comp.trend24h > 0) reasons.push(`最近24小时表现提升 ${comp.trend24h.toFixed(1)}%`);
      if (comp.sampleSize >= 2000) reasons.push("样本量达到可参考区间");
      if (comp.stagePlanSource === "derived-economy-v1") reasons.push("运营节奏由已核验费用/目标星级规则推导");

      return {
        comp,
        metaScore: meta,
        fitScore: Math.round(fit * 0.65 + meta * 0.35),
        discoveryScore: discovery,
        confidence: confidenceScore(comp.sampleSize),
        keep,
        sell,
        reasons,
        nextStep: nextStep(comp, state),
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 3);
}
