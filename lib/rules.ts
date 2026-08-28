import s18_18_1b from "../rules/S18/18.1b.json";

export type RuleVerificationStatus = "verified" | "provisional" | "blocked";
export type PrecisionUse = "allowed" | "blocked";

export type GameRules = {
  season: string;
  patch: string;
  region: string;
  verification: {
    status: RuleVerificationStatus | string;
    precisionUse: PrecisionUse | string;
    reviewedAt: string;
    note: string;
  };
  poolSizeByCost: Record<string, number>;
  shopOddsByLevel: Record<string, Record<string, number>>;
  sources: Array<{
    kind: string;
    url: string;
    claim: string;
    confidence: string;
  }>;
};

const ACTIVE_RULES = s18_18_1b as unknown as GameRules;

export function activeRules(): GameRules {
  return ACTIVE_RULES;
}

export function precisionRulesReady(rules: GameRules = ACTIVE_RULES): boolean {
  if (rules.verification.status !== "verified" || rules.verification.precisionUse !== "allowed") return false;
  const poolCosts = ["1", "2", "3", "4", "5"];
  if (!poolCosts.every((cost) => Number.isFinite(rules.poolSizeByCost[cost]) && rules.poolSizeByCost[cost] > 0)) return false;
  return Object.keys(rules.shopOddsByLevel).length > 0;
}

export function ruleStatusLabel(rules: GameRules = ACTIVE_RULES): string {
  if (precisionRulesReady(rules)) return `${rules.season} ${rules.patch} · VERIFIED`;
  return `${rules.season} ${rules.patch} · ${String(rules.verification.status).toUpperCase()} · precise EV blocked`;
}
