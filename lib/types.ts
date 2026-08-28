export type Trend = "surging" | "up" | "flat" | "down";
export type Tier = "S" | "A" | "B" | "C" | "D";
export type RankBand = "all" | "platinum" | "emerald" | "diamond" | "master" | "grandmaster+";
export type EnrichmentStatus = "full" | "partial" | "pending";
export type SampleSizeSource = "dataj-sampleCount" | "estimated-from-play-rate" | "unknown";

export type SourceCarry = {
  name: string;
  role: "carry" | "subcarry";
  targetStars: number | null;
  price: number | null;
};

export type SourceLineupUnit = {
  name: string;
  heroId: string;
  isCore: boolean;
  isCarry: boolean;
  isSubCarry: boolean;
  price: number | null;
  targetStars: number | null;
};

export type EquipmentNameCoverage = {
  mapped: number;
  total: number;
};

export type Comp = {
  id: string;
  datajCompId?: string | null;
  name: string;
  tier: Tier;
  patch: string;
  rankBand: string;
  avgPlace: number;
  top4Rate: number;
  winRate: number;
  playRate: number;
  sampleSize: number;
  sampleSizeSource?: SampleSizeSource | string;
  trend: Trend;
  trend24h: number;
  coreUnits: string[];
  flexUnits: string[];
  keyItems: string[];
  itemCarriers: Record<string, string[]>;
  stagePlan: string[];
  sourceCoreUnits?: string[];
  sourceFlexUnits?: string[];
  sourceCarries?: SourceCarry[];
  sourceTraits?: string[];
  sourceEquipmentIdsByHero?: Record<string, string[]>;
  sourceEquipmentNamesByHero?: Record<string, string[]>;
  sourceEquipmentNamesComplete?: boolean;
  sourceEquipmentNameCoverage?: EquipmentNameCoverage;
  sourceLineup?: SourceLineupUnit[];
  sourceCompUrl?: string | null;
  dataSource?: string;
  fetchedAt?: string;
  enrichmentStatus?: EnrichmentStatus;
  enrichmentVerifiedFields?: string[];
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
  verifiedPublicRankBands?: string[];
  targetRankCoverage: boolean;
  totalGames: number | null;
  parserMode?: string;
  sampleSizeMethod?: string;
  source: string;
  sourceUrl?: string | null;
  patchAuthority?: string;
  enrichmentPending?: number;
  enrichmentPartial?: number;
  comps: Comp[];
};

export type RankStatus = {
  ingestedBands: string[];
  verifiedPublicBands: string[];
  requestedTargetBands: string[];
  targetRankCoverage: boolean;
  semantics?: string;
  cnPublicSelectorLockedTo?: string | null;
  note?: string | null;
};

export type SourceStatus = {
  fetchedAt: string;
  authoritativePatch: string | null;
  liveCompDataAccepted: boolean;
  rankCoverage: string[];
  rankStatus?: RankStatus;
  targetRankCoverage: boolean;
  note: string;
  enrichmentQueue?: {
    path: string;
    pendingCount: number;
    partialCount?: number;
    highestPriority?: string | null;
  };
  sources: Record<string, {
    id: string;
    ok: boolean;
    patch?: string | null;
    url?: string;
    mode?: string;
    parserMode?: string;
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
