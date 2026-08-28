import type { GameRules } from "./rules";
import { precisionRulesReady } from "./rules";

export type HeroCatalogEntry = {
  name: string;
  cost: number;
};

export type ObservedCopies = {
  playerId: string;
  hero: string;
  cost: number;
  copies: number;
  alive: boolean;
  confidence: number;
  observedAt: number;
};

export type PoolHeroEstimate = {
  hero: string;
  cost: number;
  initialCopies: number;
  confirmedOut: number;
  expectedOut: number;
  confirmedRemaining: number;
  expectedRemaining: number;
  pressure: number;
};

export type PoolState = {
  rulesVerified: boolean;
  precisionBlocked: boolean;
  heroes: Record<string, PoolHeroEstimate>;
  totalRemainingByCost: Record<string, number>;
  observedAlivePlayers: string[];
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function copiesInPoolForCost(rules: GameRules, cost: number): number {
  return Math.max(0, Math.round(Number(rules.poolSizeByCost[String(cost)] ?? 0)));
}

export function buildPoolState(
  rules: GameRules,
  catalog: HeroCatalogEntry[],
  observations: ObservedCopies[],
  now = Date.now()
): PoolState {
  const heroes: Record<string, PoolHeroEstimate> = {};
  const observedAlivePlayers = new Set<string>();
  for (const entry of catalog) {
    const initialCopies = copiesInPoolForCost(rules, entry.cost);
    heroes[entry.name] = {
      hero: entry.name,
      cost: entry.cost,
      initialCopies,
      confirmedOut: 0,
      expectedOut: 0,
      confirmedRemaining: initialCopies,
      expectedRemaining: initialCopies,
      pressure: 0
    };
  }

  for (const observation of observations) {
    if (!observation.alive || observation.copies <= 0) continue;
    const hero = heroes[observation.hero];
    if (!hero || hero.cost !== observation.cost) continue;
    observedAlivePlayers.add(observation.playerId);
    const ageMs = Math.max(0, now - observation.observedAt);
    const freshness = Math.pow(0.5, ageMs / 15000);
    const confidence = clamp01(observation.confidence) * freshness;
    const copies = Math.max(0, Math.round(observation.copies));
    hero.expectedOut += copies * confidence;
    if (confidence >= 0.86) hero.confirmedOut += copies;
  }

  const totalRemainingByCost: Record<string, number> = {};
  for (const hero of Object.values(heroes)) {
    hero.confirmedOut = Math.min(hero.initialCopies, hero.confirmedOut);
    hero.expectedOut = Math.min(hero.initialCopies, hero.expectedOut);
    hero.confirmedRemaining = Math.max(0, hero.initialCopies - hero.confirmedOut);
    hero.expectedRemaining = Math.max(0, hero.initialCopies - hero.expectedOut);
    hero.pressure = hero.initialCopies > 0 ? Math.max(0, Math.min(1, hero.expectedOut / hero.initialCopies)) : 0;
    totalRemainingByCost[String(hero.cost)] = (totalRemainingByCost[String(hero.cost)] ?? 0) + hero.expectedRemaining;
  }

  return {
    rulesVerified: precisionRulesReady(rules),
    precisionBlocked: !precisionRulesReady(rules),
    heroes,
    totalRemainingByCost,
    observedAlivePlayers: [...observedAlivePlayers]
  };
}

export type HitRateEstimate = {
  status: "ready" | "blocked" | "invalid";
  reason?: string;
  perSlotProbability?: number;
  atLeastOneInShop?: number;
  expectedTargetCopiesPerShop?: number;
};

export function estimateTargetHitRate(
  rules: GameRules,
  pool: PoolState,
  level: number,
  hero: string
): HitRateEstimate {
  if (!precisionRulesReady(rules)) {
    return { status: "blocked", reason: "rule_verification_required" };
  }
  const target = pool.heroes[hero];
  if (!target || target.expectedRemaining <= 0) {
    return { status: "invalid", reason: "target_not_in_pool" };
  }
  const levelOdds = rules.shopOddsByLevel[String(level)];
  const costOdds = Number(levelOdds?.[String(target.cost)] ?? NaN);
  if (!Number.isFinite(costOdds) || costOdds <= 0) {
    return { status: "invalid", reason: "shop_odds_missing" };
  }
  const sameCostRemaining = Number(pool.totalRemainingByCost[String(target.cost)] ?? 0);
  if (!(sameCostRemaining > 0)) return { status: "invalid", reason: "cost_pool_empty" };

  const perSlotProbability = Math.max(0, Math.min(1, costOdds * target.expectedRemaining / sameCostRemaining));
  const atLeastOneInShop = 1 - Math.pow(1 - perSlotProbability, 5);
  return {
    status: "ready",
    perSlotProbability,
    atLeastOneInShop,
    expectedTargetCopiesPerShop: perSlotProbability * 5
  };
}

export type RollBudgetEstimate = HitRateEstimate & {
  shops?: number;
  slots?: number;
  probabilityAtLeastOne?: number;
  expectedCopies?: number;
};

export function estimateRollBudget(
  rules: GameRules,
  pool: PoolState,
  level: number,
  hero: string,
  rollGold: number,
  rollCost = 2
): RollBudgetEstimate {
  const base = estimateTargetHitRate(rules, pool, level, hero);
  if (base.status !== "ready" || base.perSlotProbability === undefined) return base;
  const shops = Math.max(0, Math.floor(rollGold / Math.max(1, rollCost)));
  const slots = shops * 5;
  return {
    ...base,
    shops,
    slots,
    probabilityAtLeastOne: 1 - Math.pow(1 - base.perSlotProbability, slots),
    expectedCopies: base.perSlotProbability * slots
  };
}
