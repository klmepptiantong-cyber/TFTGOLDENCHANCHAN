export type VisionSource = "window-capture" | "ocr" | "template" | "manual-fallback";

export type VisionObservation<T> = {
  value: T;
  confidence: number;
  capturedAt: number;
  source: VisionSource | string;
};

export type FusedValue<T> = {
  value: T | null;
  confidence: number;
  samples: number;
  ageMs: number | null;
};

export type VisionGameState = {
  stage?: VisionObservation<string>[];
  level?: VisionObservation<number>[];
  gold?: VisionObservation<number>[];
  hp?: VisionObservation<number>[];
  shop?: VisionObservation<string[]>[];
  units?: VisionObservation<Record<string, number>>[];
  bench?: VisionObservation<Record<string, number>>[];
  items?: VisionObservation<string[]>[];
  augments?: VisionObservation<string[]>[];
  opponentId?: VisionObservation<string | null>[];
};

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function recencyWeight(capturedAt: number, now: number, halfLifeMs: number): number {
  const age = Math.max(0, now - capturedAt);
  return Math.pow(0.5, age / Math.max(1, halfLifeMs));
}

export function fuseCategorical<T extends string | number | boolean | null>(
  observations: VisionObservation<T>[],
  options: { now?: number; halfLifeMs?: number; maxAgeMs?: number } = {}
): FusedValue<T> {
  const now = options.now ?? Date.now();
  const halfLifeMs = options.halfLifeMs ?? 1800;
  const maxAgeMs = options.maxAgeMs ?? 7000;
  const fresh = observations.filter((item) => now - item.capturedAt <= maxAgeMs && clampConfidence(item.confidence) > 0);
  if (!fresh.length) return { value: null, confidence: 0, samples: 0, ageMs: null };

  const scores = new Map<string, { value: T; score: number; newest: number; count: number }>();
  let total = 0;
  for (const item of fresh) {
    const weight = clampConfidence(item.confidence) * recencyWeight(item.capturedAt, now, halfLifeMs);
    total += weight;
    const key = JSON.stringify(item.value);
    const current = scores.get(key) ?? { value: item.value, score: 0, newest: 0, count: 0 };
    current.score += weight;
    current.newest = Math.max(current.newest, item.capturedAt);
    current.count += 1;
    scores.set(key, current);
  }

  const best = [...scores.values()].sort((a, b) => b.score - a.score || b.newest - a.newest)[0];
  return {
    value: best?.value ?? null,
    confidence: total > 0 && best ? Math.max(0, Math.min(1, best.score / total)) : 0,
    samples: best?.count ?? 0,
    ageMs: best ? Math.max(0, now - best.newest) : null
  };
}

export function fuseNumber(
  observations: VisionObservation<number>[],
  options: { now?: number; halfLifeMs?: number; maxAgeMs?: number; tolerance?: number } = {}
): FusedValue<number> {
  const rounded = observations.map((item) => ({
    ...item,
    value: options.tolerance && options.tolerance > 1
      ? Math.round(item.value / options.tolerance) * options.tolerance
      : Math.round(item.value)
  }));
  return fuseCategorical(rounded, options);
}

export function fuseStringList(
  observations: VisionObservation<string[]>[],
  options: { now?: number; halfLifeMs?: number; maxAgeMs?: number } = {}
): FusedValue<string[]> {
  const normalized = observations.map((item) => ({
    ...item,
    value: item.value.map((value) => value.trim()).filter(Boolean)
  }));
  const now = options.now ?? Date.now();
  const halfLifeMs = options.halfLifeMs ?? 1800;
  const maxAgeMs = options.maxAgeMs ?? 7000;
  const fresh = normalized.filter((item) => now - item.capturedAt <= maxAgeMs && clampConfidence(item.confidence) > 0);
  if (!fresh.length) return { value: null, confidence: 0, samples: 0, ageMs: null };

  const newest = [...fresh].sort((a, b) => b.capturedAt - a.capturedAt)[0];
  const agreement = fresh.reduce((sum, item) => {
    const left = new Set(newest.value);
    const right = new Set(item.value);
    const union = new Set([...left, ...right]);
    const intersection = [...left].filter((value) => right.has(value));
    return sum + (union.size ? intersection.length / union.size : 1) * clampConfidence(item.confidence) * recencyWeight(item.capturedAt, now, halfLifeMs);
  }, 0);
  const total = fresh.reduce((sum, item) => sum + clampConfidence(item.confidence) * recencyWeight(item.capturedAt, now, halfLifeMs), 0);
  return {
    value: newest.value,
    confidence: total > 0 ? Math.max(0, Math.min(1, agreement / total)) : 0,
    samples: fresh.length,
    ageMs: Math.max(0, now - newest.capturedAt)
  };
}

export class TemporalVisionBuffer {
  private readonly maxPerField: number;
  private readonly state: VisionGameState = {};

  constructor(maxPerField = 8) {
    this.maxPerField = Math.max(3, maxPerField);
  }

  push<K extends keyof VisionGameState>(field: K, observation: NonNullable<VisionGameState[K]>[number]) {
    const current = (this.state[field] ?? []) as Array<NonNullable<VisionGameState[K]>[number]>;
    current.push(observation);
    if (current.length > this.maxPerField) current.splice(0, current.length - this.maxPerField);
    (this.state[field] as typeof current) = current;
  }

  snapshot(): VisionGameState {
    return structuredClone(this.state);
  }

  clear() {
    for (const key of Object.keys(this.state) as (keyof VisionGameState)[]) delete this.state[key];
  }
}
