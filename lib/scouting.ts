import { buildPoolState, type HeroCatalogEntry, type ObservedCopies } from "./pool";
import { activeRules } from "./rules";
import type { Comp, MetaSnapshot, UnitCollection, UnitState } from "./types";

export type ScoutSource = "manual" | "vision-candidate";

export type OpponentScoutSnapshot = {
  playerId: string;
  alive: boolean;
  units: Record<string, number>;
  confidence: number;
  observedAt: number;
  source: ScoutSource;
};

export type ScoutingSummary = {
  contestedComps: Record<string, number>;
  poolPressureByHero: Record<string, number>;
  highPressureHeroes: Array<{ hero: string; cost: number; pressure: number }>;
  observedAlivePlayers: string[];
  precisionBlocked: boolean;
};

const unique = <T>(values: T[]): T[] => [...new Set(values)];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function unitCopies(value: number | UnitState | undefined): number {
  if (typeof value === "number") return Math.max(0, Math.round(value));
  if (!value) return 0;
  if (typeof value.copies === "number") return Math.max(0, Math.round(value.copies));
  if (value.stars === 3) return 9;
  if (value.stars === 2) return 3;
  return value.stars === 1 ? 1 : 0;
}

function mergeOwnUnits(...collections: (UnitCollection | undefined)[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const collection of collections) {
    for (const [hero, value] of Object.entries(collection ?? {})) {
      const copies = unitCopies(value);
      if (copies > 0) result[hero] = (result[hero] ?? 0) + copies;
    }
  }
  return result;
}

export function heroCatalogFromSnapshot(snapshot: MetaSnapshot): HeroCatalogEntry[] {
  const byHero = new Map<string, number>();
  for (const comp of snapshot.comps ?? []) {
    for (const unit of comp.sourceLineup ?? []) {
      if (!unit.name || !Number.isFinite(unit.price) || unit.price === null) continue;
      const cost = Math.max(1, Math.min(5, Math.round(unit.price)));
      if (!byHero.has(unit.name)) byHero.set(unit.name, cost);
    }
    for (const carry of comp.sourceCarries ?? []) {
      if (!carry.name || !Number.isFinite(carry.price) || carry.price === null) continue;
      const cost = Math.max(1, Math.min(5, Math.round(carry.price)));
      if (!byHero.has(carry.name)) byHero.set(carry.name, cost);
    }
  }
  return [...byHero.entries()]
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, "zh-CN"));
}

function observationsFromUnits(
  playerId: string,
  alive: boolean,
  units: Record<string, number>,
  confidence: number,
  observedAt: number,
  costs: Map<string, number>
): ObservedCopies[] {
  const result: ObservedCopies[] = [];
  for (const [hero, rawCopies] of Object.entries(units)) {
    const cost = costs.get(hero);
    const copies = Math.max(0, Math.min(9, Math.round(Number(rawCopies) || 0)));
    if (!cost || copies <= 0) continue;
    result.push({
      playerId,
      hero,
      cost,
      copies,
      alive,
      confidence: clamp01(confidence),
      observedAt
    });
  }
  return result;
}

function activeScouts(scouts: OpponentScoutSnapshot[], now: number): OpponentScoutSnapshot[] {
  const latest = new Map<string, OpponentScoutSnapshot>();
  for (const scout of scouts) {
    const playerId = scout.playerId.trim();
    if (!playerId) continue;
    const previous = latest.get(playerId);
    if (!previous || scout.observedAt > previous.observedAt) latest.set(playerId, { ...scout, playerId });
  }
  return [...latest.values()].filter((scout) => {
    if (!scout.alive) return true;
    return now - scout.observedAt <= 5 * 60 * 1000;
  });
}

export function detectContestedComps(
  comps: Comp[],
  scouts: OpponentScoutSnapshot[],
  now = Date.now()
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const scout of activeScouts(scouts, now)) {
    if (!scout.alive) continue;
    const owned = Object.entries(scout.units)
      .filter(([, copies]) => copies > 0)
      .map(([hero]) => hero);
    if (!owned.length) continue;

    for (const comp of comps) {
      const core = unique(comp.coreUnits ?? []);
      const system = unique([...(comp.coreUnits ?? []), ...(comp.flexUnits ?? [])]);
      const coreHits = core.filter((hero) => owned.includes(hero)).length;
      const systemHits = system.filter((hero) => owned.includes(hero)).length;
      const enoughEvidence = coreHits >= 2
        || (systemHits >= 3 && systemHits / Math.max(3, Math.min(8, owned.length)) >= 0.45);
      if (enoughEvidence) counts[comp.id] = Math.min(7, (counts[comp.id] ?? 0) + 1);
    }
  }
  return counts;
}

export function deriveScoutingSummary(
  snapshot: MetaSnapshot,
  scouts: OpponentScoutSnapshot[],
  own?: { units?: UnitCollection; bench?: UnitCollection },
  now = Date.now()
): ScoutingSummary {
  const catalog = heroCatalogFromSnapshot(snapshot);
  const costs = new Map(catalog.map((hero) => [hero.name, hero.cost] as const));
  const active = activeScouts(scouts, now);
  const observations = active.flatMap((scout) => observationsFromUnits(
    scout.playerId,
    scout.alive,
    scout.units,
    scout.confidence,
    scout.observedAt,
    costs
  ));

  const ownUnits = mergeOwnUnits(own?.units, own?.bench);
  observations.push(...observationsFromUnits("self", true, ownUnits, 1, now, costs));

  const pool = buildPoolState(activeRules(), catalog, observations, now);
  const poolPressureByHero = Object.fromEntries(
    Object.values(pool.heroes)
      .filter((hero) => hero.pressure > 0)
      .map((hero) => [hero.hero, Math.round(hero.pressure * 1000) / 1000])
  );

  const highPressureHeroes = Object.values(pool.heroes)
    .filter((hero) => hero.pressure >= 0.18)
    .sort((a, b) => b.pressure - a.pressure || b.cost - a.cost)
    .slice(0, 8)
    .map((hero) => ({ hero: hero.hero, cost: hero.cost, pressure: hero.pressure }));

  return {
    contestedComps: detectContestedComps(snapshot.comps, active, now),
    poolPressureByHero,
    highPressureHeroes,
    observedAlivePlayers: pool.observedAlivePlayers.filter((playerId) => playerId !== "self"),
    precisionBlocked: pool.precisionBlocked
  };
}
