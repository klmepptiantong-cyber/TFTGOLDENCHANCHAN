import type { BoardVisionLayout, BoardVisionZone, HeroVisionEntity } from "./board-vision";

export type PixelSlotZone = Extract<BoardVisionZone, "board" | "bench">;

export type PixelSlot = {
  id: string;
  zone: PixelSlotZone;
  index: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
};

export type PixelFeature = {
  vector: number[];
  energy: number;
};

export type HeroPrototype = {
  hero: string;
  samples: number[][];
  updatedAt: number;
};

export type PixelPrototypeStore = {
  version: 1;
  heroes: Record<string, HeroPrototype>;
};

export type PixelPrediction = {
  slotId: string;
  zone: PixelSlotZone;
  hero: string;
  confidence: number;
  similarity: number;
  margin: number;
  prototypeSamples: number;
  trusted: boolean;
  energy: number;
};

export type PixelFrameState = {
  capturedAt: number;
  layoutId: BoardVisionLayout["id"];
  expectedLevel: number | null;
  predictions: PixelPrediction[];
};

export type FusedPixelState = {
  board: Record<string, number>;
  bench: Record<string, number>;
  slotPredictions: PixelPrediction[];
  confidence: number;
  exactSamples: number;
  samples: number;
  expectedLevel: number | null;
  complete: boolean;
  ageMs: number | null;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function emptyPixelPrototypeStore(): PixelPrototypeStore {
  return { version: 1, heroes: {} };
}

export function sanitizePixelPrototypeStore(value: unknown): PixelPrototypeStore {
  if (!value || typeof value !== "object") return emptyPixelPrototypeStore();
  const input = value as Partial<PixelPrototypeStore>;
  const result = emptyPixelPrototypeStore();
  if (input.version !== 1 || !input.heroes || typeof input.heroes !== "object") return result;
  for (const [hero, raw] of Object.entries(input.heroes)) {
    if (!hero.trim() || !raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<HeroPrototype>;
    const samples = Array.isArray(candidate.samples)
      ? candidate.samples
          .filter((sample): sample is number[] => Array.isArray(sample) && sample.length >= 12 && sample.every(Number.isFinite))
          .map((sample) => sample.map((number) => clamp01(number)))
          .slice(-12)
      : [];
    if (!samples.length) continue;
    const dimension = samples[0].length;
    const aligned = samples.filter((sample) => sample.length === dimension);
    if (!aligned.length) continue;
    result.heroes[hero] = {
      hero,
      samples: aligned,
      updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : 0
    };
  }
  return result;
}

function slotCenters(layout: BoardVisionLayout, zone: PixelSlotZone): PixelSlot[] {
  if (!layout.supported) return [];
  const rect = zone === "board" ? layout.board : layout.bench;
  const rectWidth = rect.xMax - rect.xMin;
  const rectHeight = rect.yMax - rect.yMin;
  if (zone === "bench") {
    const count = 9;
    const step = rectWidth / count;
    return Array.from({ length: count }, (_, index) => ({
      id: `bench-${index}`,
      zone,
      index,
      cx: rect.xMin + step * (index + 0.5),
      cy: rect.yMin + rectHeight * 0.5,
      width: step * 0.84,
      height: rectHeight * 0.9
    }));
  }

  const rows = 4;
  const columns = 7;
  const stepX = rectWidth / columns;
  const stepY = rectHeight / rows;
  const slots: PixelSlot[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const stagger = row % 2 === 0 ? -0.06 : 0.06;
      slots.push({
        id: `board-${index}`,
        zone,
        index,
        cx: rect.xMin + stepX * (column + 0.5 + stagger),
        cy: rect.yMin + stepY * (row + 0.5),
        width: stepX * 0.86,
        height: stepY * 0.96
      });
    }
  }
  return slots;
}

export function buildPixelSlotMap(layout: BoardVisionLayout): PixelSlot[] {
  return [...slotCenters(layout, "board"), ...slotCenters(layout, "bench")];
}

export function nearestPixelSlot(
  entity: Pick<HeroVisionEntity, "zone" | "x" | "y">,
  slots: PixelSlot[],
  maxDistance = 0.095
): PixelSlot | null {
  if (entity.zone !== "board" && entity.zone !== "bench") return null;
  const best = slots
    .filter((slot) => slot.zone === entity.zone)
    .map((slot) => ({ slot, distance: Math.hypot(slot.cx - entity.x, slot.cy - entity.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return best && best.distance <= maxDistance ? best.slot : null;
}

export function featureSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let absolute = 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = clamp01(left[index]);
    const b = clamp01(right[index]);
    absolute += Math.abs(a - b);
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const l1 = 1 - absolute / left.length;
  const cosine = leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
  return clamp01(l1 * 0.62 + cosine * 0.38);
}

function heroPrototypeSimilarity(feature: number[], prototype: HeroPrototype): number {
  const scores = prototype.samples
    .map((sample) => featureSimilarity(feature, sample))
    .sort((a, b) => b - a)
    .slice(0, 3);
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

export function addPixelPrototype(
  store: PixelPrototypeStore,
  hero: string,
  feature: number[],
  capturedAt = Date.now(),
  maxSamples = 12
): { store: PixelPrototypeStore; added: boolean } {
  if (!hero.trim() || feature.length < 12 || feature.some((value) => !Number.isFinite(value))) {
    return { store, added: false };
  }
  const clean = feature.map((value) => clamp01(value));
  const next = structuredClone(store);
  const current = next.heroes[hero] ?? { hero, samples: [], updatedAt: 0 };
  if (current.samples.length && current.samples[0].length !== clean.length) current.samples = [];

  if (current.samples.length) {
    const best = Math.max(...current.samples.map((sample) => featureSimilarity(clean, sample)));
    if (best < 0.58) return { store, added: false };
    if (best > 0.992) return { store, added: false };
  }

  current.samples.push(clean);
  if (current.samples.length > maxSamples) current.samples.splice(0, current.samples.length - maxSamples);
  current.updatedAt = capturedAt;
  next.heroes[hero] = current;
  return { store: next, added: true };
}

export function classifyPixelFeature(
  slot: PixelSlot,
  feature: PixelFeature,
  store: PixelPrototypeStore
): PixelPrediction | null {
  if (feature.energy < 0.2) return null;
  const ranked = Object.values(store.heroes)
    .filter((prototype) => prototype.samples.length > 0 && prototype.samples[0].length === feature.vector.length)
    .map((prototype) => ({
      prototype,
      similarity: heroPrototypeSimilarity(feature.vector, prototype)
    }))
    .sort((a, b) => b.similarity - a.similarity);
  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1]?.similarity ?? 0;
  const margin = Math.max(0, best.similarity - second);
  const sampleFactor = Math.min(1, best.prototype.samples.length / 4);
  const marginFactor = clamp01(margin / 0.12);
  const confidence = clamp01(best.similarity * (0.62 + sampleFactor * 0.2 + marginFactor * 0.18));
  const trusted = best.prototype.samples.length >= 2
    && best.similarity >= 0.86
    && margin >= 0.035
    && confidence >= 0.78;
  return {
    slotId: slot.id,
    zone: slot.zone,
    hero: best.prototype.hero,
    confidence,
    similarity: best.similarity,
    margin,
    prototypeSamples: best.prototype.samples.length,
    trusted,
    energy: clamp01(feature.energy)
  };
}

function predictionSignature(predictions: PixelPrediction[], zone: PixelSlotZone): string {
  return JSON.stringify(
    predictions
      .filter((prediction) => prediction.zone === zone && prediction.trusted)
      .map((prediction) => [prediction.slotId, prediction.hero] as const)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

function unitsFromPredictions(predictions: PixelPrediction[], zone: PixelSlotZone): Record<string, number> {
  const units: Record<string, number> = {};
  for (const prediction of predictions) {
    if (prediction.zone !== zone || !prediction.trusted) continue;
    units[prediction.hero] = (units[prediction.hero] ?? 0) + 1;
  }
  return units;
}

export function fusePixelFrames(frames: PixelFrameState[], now = Date.now()): FusedPixelState {
  const fresh = frames.filter((frame) => now - frame.capturedAt <= 12_000).slice(-8);
  if (!fresh.length) {
    return {
      board: {},
      bench: {},
      slotPredictions: [],
      confidence: 0,
      exactSamples: 0,
      samples: 0,
      expectedLevel: null,
      complete: false,
      ageMs: null
    };
  }

  const groups = new Map<string, { frame: PixelFrameState; score: number; count: number; newest: number }>();
  let total = 0;
  for (const frame of fresh) {
    const trustedBoard = frame.predictions.filter((prediction) => prediction.zone === "board" && prediction.trusted);
    if (!trustedBoard.length) continue;
    const sourceConfidence = trustedBoard.reduce((sum, prediction) => sum + prediction.confidence, 0) / trustedBoard.length;
    const age = Math.max(0, now - frame.capturedAt);
    const weight = sourceConfidence * Math.pow(0.5, age / 4200);
    total += weight;
    const key = predictionSignature(frame.predictions, "board");
    const current = groups.get(key) ?? { frame, score: 0, count: 0, newest: 0 };
    current.score += weight;
    current.count += 1;
    if (frame.capturedAt >= current.newest) {
      current.frame = frame;
      current.newest = frame.capturedAt;
    }
    groups.set(key, current);
  }

  const best = [...groups.values()].sort((a, b) => b.score - a.score || b.newest - a.newest)[0];
  const newest = [...fresh].sort((a, b) => b.capturedAt - a.capturedAt)[0];
  if (!best) {
    return {
      board: {},
      bench: {},
      slotPredictions: [],
      confidence: 0,
      exactSamples: 0,
      samples: fresh.length,
      expectedLevel: newest.expectedLevel,
      complete: false,
      ageMs: Math.max(0, now - newest.capturedAt)
    };
  }

  const trusted = best.frame.predictions.filter((prediction) => prediction.trusted);
  const trustedBoard = trusted.filter((prediction) => prediction.zone === "board");
  const averageConfidence = trustedBoard.length
    ? trustedBoard.reduce((sum, prediction) => sum + prediction.confidence, 0) / trustedBoard.length
    : 0;
  const agreement = total > 0 ? best.score / total : 0;
  const confidence = clamp01(averageConfidence * agreement);
  const expectedLevel = best.frame.expectedLevel;
  const complete = expectedLevel !== null
    && trustedBoard.length === expectedLevel
    && best.count >= 3
    && confidence >= 0.82;
  return {
    board: unitsFromPredictions(trusted, "board"),
    bench: unitsFromPredictions(trusted, "bench"),
    slotPredictions: trusted,
    confidence,
    exactSamples: best.count,
    samples: fresh.length,
    expectedLevel,
    complete,
    ageMs: Math.max(0, now - best.frame.capturedAt)
  };
}

export function safePixelCandidateReady(state: FusedPixelState): boolean {
  return state.complete
    && state.exactSamples >= 3
    && state.confidence >= 0.82
    && Object.keys(state.board).length > 0;
}
