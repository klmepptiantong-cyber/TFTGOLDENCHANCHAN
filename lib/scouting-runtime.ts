export type RuntimeScoutingState = {
  contestedComps: Record<string, number>;
  poolPressureByHero: Record<string, number>;
  updatedAt: number;
};

const EMPTY: RuntimeScoutingState = {
  contestedComps: {},
  poolPressureByHero: {},
  updatedAt: 0
};

let runtime: RuntimeScoutingState = EMPTY;

function sanitizeCountMap(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [key.trim(), Math.max(0, Math.min(7, Math.round(Number(raw) || 0)))] as const)
      .filter(([key, count]) => Boolean(key) && count > 0)
      .slice(0, 40)
  );
}

function sanitizePressureMap(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [key.trim(), Math.max(0, Math.min(1, Number(raw) || 0))] as const)
      .filter(([key, pressure]) => Boolean(key) && pressure > 0)
      .slice(0, 80)
  );
}

export function setRuntimeScouting(next: Omit<RuntimeScoutingState, "updatedAt"> & { updatedAt?: number }): void {
  runtime = {
    contestedComps: sanitizeCountMap(next.contestedComps),
    poolPressureByHero: sanitizePressureMap(next.poolPressureByHero),
    updatedAt: typeof next.updatedAt === "number" && Number.isFinite(next.updatedAt) ? next.updatedAt : Date.now()
  };
}

export function clearRuntimeScouting(): void {
  runtime = EMPTY;
}

export function getRuntimeScouting(): RuntimeScoutingState {
  return {
    contestedComps: { ...runtime.contestedComps },
    poolPressureByHero: { ...runtime.poolPressureByHero },
    updatedAt: runtime.updatedAt
  };
}
