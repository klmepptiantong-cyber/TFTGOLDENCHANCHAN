import { Comp } from "./types";

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

export function confidenceScore(sampleSize: number): number {
  if (sampleSize >= 10000) return 100;
  if (sampleSize >= 5000) return 92;
  if (sampleSize >= 2000) return 82;
  if (sampleSize >= 1000) return 70;
  if (sampleSize >= 300) return 55;
  return 30;
}

export function metaScore(comp: Comp): number {
  const top4 = comp.top4Rate;
  const win = comp.winRate;
  const avgPlace = clamp((5.5 - comp.avgPlace) * 25);
  const confidence = confidenceScore(comp.sampleSize);
  const trend = clamp(50 + comp.trend24h * 3);

  return Math.round(
    top4 * 0.3 +
      win * 0.2 +
      avgPlace * 0.2 +
      confidence * 0.15 +
      trend * 0.15
  );
}

export function discoveryScore(comp: Comp): number {
  const lowPlayBonus = clamp((1.5 - comp.playRate) * 35);
  const performance = clamp((comp.top4Rate - 45) * 2 + comp.winRate);
  const velocity = clamp(50 + comp.trend24h * 5);
  const confidence = confidenceScore(comp.sampleSize);

  return Math.round(
    lowPlayBonus * 0.25 +
      performance * 0.35 +
      velocity * 0.25 +
      confidence * 0.15
  );
}
