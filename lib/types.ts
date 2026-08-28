export type Trend = "surging" | "up" | "flat" | "down";
export type Tier = "S" | "A" | "B" | "C" | "D";
export type RankBand = "all" | "platinum" | "emerald" | "diamond" | "master" | "grandmaster+";

export type Comp = {
  id: string;
  name: string;
  tier: Tier;
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
  dataSource?: string;
  fetchedAt?: string;
  needsEnrichment?: boolean;
};

export type MetaSnapshot = {
  schemaVersion: number;
  season: string;
  patch: string;
  fetchedAt: string;
  isLive: boolean;
  rankBand: RankBand | string;
  rankCoverage: string[];
  targetRankCoverage: boolean;
  totalGames: number | null;
  source: string;
  sourceUrl?: string | null;
  patchAuthority?: string;
  comps: Comp[];
};

export type SourceStatus = {
  fetchedAt: string;
  authoritativePatch: string | null;
  liveCompDataAccepted: boolean;
  rankCoverage: string[];
  targetRankCoverage: boolean;
  note: string;
  sources: Record<string, {
    id: string;
    ok: boolean;
    patch?: string | null;
    url?: string;
    mode?: string;
    error?: string;
  }>;
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
