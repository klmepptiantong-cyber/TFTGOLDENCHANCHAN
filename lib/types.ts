export type Trend = "surging" | "up" | "flat" | "down";

export type Comp = {
  id: string;
  name: string;
  tier: "S" | "A" | "B" | "C";
  patch: string;
  rankBand: string;
  avgPlace: number;
  top4Rate: number;
  winRate: number;
  playRate: number;
  sampleSize: number;
  trend: Trend;
  trend24h: number;
  coreUnits: string[];
  flexUnits: string[];
  keyItems: string[];
  itemCarriers: Record<string, string[]>;
  stagePlan: string[];
};

export type GameState = {
  stage: string;
  level: number;
  gold: number;
  hp: number;
  units: Record<string, number>;
  items: string[];
  rankBand?: string;
};

export type Recommendation = {
  comp: Comp;
  metaScore: number;
  fitScore: number;
  discoveryScore: number;
  confidence: number;
  keep: string[];
  sell: string[];
  reasons: string[];
  nextStep: string;
};
