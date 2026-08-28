import { GameState, UnitCollection, UnitState } from "./types";

const asFiniteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function normalizeStrings(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeUnitState(value: unknown): number | UnitState | null {
  if (typeof value === "number") return clamp(Math.round(value), 0, 9);
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const copies = input.copies === undefined ? undefined : clamp(Math.round(asFiniteNumber(input.copies, 1)), 0, 9);
  const starsRaw = input.stars === undefined ? undefined : clamp(Math.round(asFiniteNumber(input.stars, 1)), 1, 3);
  const stars = starsRaw === 1 || starsRaw === 2 || starsRaw === 3 ? starsRaw : undefined;
  return {
    ...(copies !== undefined ? { copies } : {}),
    ...(stars !== undefined ? { stars } : {}),
    ...(Array.isArray(input.items) ? { items: normalizeStrings(input.items, 6) } : {})
  };
}

function normalizeUnits(value: unknown): UnitCollection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([name, unit]) => [name.trim(), normalizeUnitState(unit)] as const)
      .filter(([name, unit]) => Boolean(name) && unit !== null)
      .slice(0, 40)
  ) as UnitCollection;
}

function normalizeEquipped(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([name, items]) => [name.trim(), normalizeStrings(items, 6)] as const)
      .filter(([name]) => Boolean(name))
      .slice(0, 20)
  );
}

export function parseGameState(input: unknown): GameState {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const stage = String(body.stage ?? "2-1").trim().slice(0, 12) || "2-1";
  const level = clamp(Math.round(asFiniteNumber(body.level, 4)), 1, 10);
  const gold = clamp(Math.round(asFiniteNumber(body.gold, 0)), 0, 200);
  const hp = clamp(Math.round(asFiniteNumber(body.hp, 100)), 0, 100);
  const streak = body.streak === undefined ? undefined : clamp(Math.round(asFiniteNumber(body.streak, 0)), -20, 20);
  const xp = body.xp === undefined ? undefined : clamp(Math.round(asFiniteNumber(body.xp, 0)), 0, 100);

  return {
    stage,
    level,
    gold,
    hp,
    units: normalizeUnits(body.units),
    bench: normalizeUnits(body.bench),
    shop: normalizeStrings(body.shop, 5),
    items: normalizeStrings(body.items, 30),
    equippedItems: normalizeEquipped(body.equippedItems),
    augments: normalizeStrings(body.augments, 8),
    ...(streak !== undefined ? { streak } : {}),
    ...(xp !== undefined ? { xp } : {}),
    ...(body.rankBand ? { rankBand: String(body.rankBand).trim().slice(0, 30) } : {}),
    ...(body.lockedCompId ? { lockedCompId: String(body.lockedCompId).trim().slice(0, 120) } : {})
  };
}
