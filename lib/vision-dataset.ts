export type VisionDatasetZone = "board" | "bench";
export type VisionDatasetLabelSource = "ocr-slot" | "manual-unknown" | "manual-confirmed";

export type VisionDatasetSample = {
  schemaVersion: 1 | 2;
  sessionId: string;
  capturedAt: number;
  sourceWindow: string;
  region: "CN";
  season: "S18";
  label: string;
  labelSource: VisionDatasetLabelSource;
  labelConfidence: number;
  zone: VisionDatasetZone;
  slotId: string;
  layoutId: string;
  imageDataUrl: string;
  frameId?: string;
  expectedLevel?: number | null;
  boardComplete?: boolean;
};

export type VisionBoardValidationUnit = {
  slotId: string;
  label: string;
  imageDataUrl: string;
};

export type VisionBoardValidationSnapshot = {
  schemaVersion: 1;
  snapshotId: string;
  sessionId: string;
  capturedAt: number;
  expectedLevel: number;
  layoutId: string;
  units: VisionBoardValidationUnit[];
};

export type VisionDatasetBatch = {
  schemaVersion: number;
  project?: string;
  region: "CN";
  season: "S18";
  splitUnit: "session";
  currentSeasonOnly: true;
  exportedAt?: number;
  manifestId?: string;
  samples: VisionDatasetSample[];
  boardSnapshots?: VisionBoardValidationSnapshot[];
};

export type VisionDatasetQaIssue = {
  severity: "error" | "warning";
  code: string;
  detail: string;
  sessionId?: string;
  label?: string;
};

export type VisionDatasetQaReport = {
  schemaVersion: 1;
  generatedAt: number;
  inputBatches: number;
  inputSamples: number;
  acceptedSamples: number;
  rejectedSamples: number;
  exactDuplicateSamples: number;
  conflictingFingerprints: number;
  crossSessionDuplicateFingerprints: number;
  sessions: number;
  labels: number;
  unknownSamples: number;
  unknownSessions: number;
  boardSnapshots: number;
  validBoardSnapshots: number;
  layouts: string[];
  zones: Record<VisionDatasetZone, number>;
  perLabel: Record<string, { samples: number; sessions: number; averageConfidence: number }>;
  issues: VisionDatasetQaIssue[];
  candidateTrainingReady: boolean;
  productionCoverageReady: boolean;
};

export type VisionDatasetQaResult = {
  cleaned: VisionDatasetBatch;
  report: VisionDatasetQaReport;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validImage(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("data:image/png;base64,")
    && value.length > 160;
}

function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeSample(raw: unknown): VisionDatasetSample | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<VisionDatasetSample>;
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) return null;
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) return null;
  if (!finite(value.capturedAt) || value.capturedAt <= 0) return null;
  if (typeof value.sourceWindow !== "string") return null;
  if (value.region !== "CN" || value.season !== "S18") return null;
  if (typeof value.label !== "string" || !value.label.trim()) return null;
  if (value.labelSource !== "ocr-slot" && value.labelSource !== "manual-unknown" && value.labelSource !== "manual-confirmed") return null;
  if (!finite(value.labelConfidence) || value.labelConfidence < 0 || value.labelConfidence > 1) return null;
  if (value.zone !== "board" && value.zone !== "bench") return null;
  if (typeof value.slotId !== "string" || !/^(board|bench)-\d+$/.test(value.slotId)) return null;
  if (typeof value.layoutId !== "string" || !value.layoutId.trim()) return null;
  if (!validImage(value.imageDataUrl)) return null;
  if (value.label === "__unknown__" && value.labelSource !== "manual-unknown") return null;
  if (value.label !== "__unknown__" && value.labelSource === "manual-unknown") return null;
  if (value.labelSource === "ocr-slot" && value.labelConfidence < 0.8) return null;
  return {
    schemaVersion: value.schemaVersion,
    sessionId: value.sessionId,
    capturedAt: value.capturedAt,
    sourceWindow: value.sourceWindow,
    region: "CN",
    season: "S18",
    label: value.label.trim(),
    labelSource: value.labelSource,
    labelConfidence: value.labelConfidence,
    zone: value.zone,
    slotId: value.slotId,
    layoutId: value.layoutId,
    imageDataUrl: value.imageDataUrl,
    frameId: typeof value.frameId === "string" ? value.frameId : undefined,
    expectedLevel: finite(value.expectedLevel) ? value.expectedLevel : null,
    boardComplete: Boolean(value.boardComplete)
  };
}

function normalizeBoardSnapshot(raw: unknown): VisionBoardValidationSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<VisionBoardValidationSnapshot>;
  if (value.schemaVersion !== 1) return null;
  if (typeof value.snapshotId !== "string" || !value.snapshotId.trim()) return null;
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) return null;
  if (!finite(value.capturedAt) || value.capturedAt <= 0) return null;
  if (!finite(value.expectedLevel) || !Number.isInteger(value.expectedLevel) || value.expectedLevel < 1 || value.expectedLevel > 10) return null;
  if (typeof value.layoutId !== "string" || !value.layoutId.trim()) return null;
  if (!Array.isArray(value.units) || value.units.length !== value.expectedLevel) return null;
  const units: VisionBoardValidationUnit[] = [];
  const slots = new Set<string>();
  for (const unit of value.units) {
    if (!unit || typeof unit !== "object") return null;
    if (typeof unit.slotId !== "string" || !/^board-\d+$/.test(unit.slotId) || slots.has(unit.slotId)) return null;
    if (typeof unit.label !== "string" || !unit.label.trim() || unit.label === "__unknown__") return null;
    if (!validImage(unit.imageDataUrl)) return null;
    slots.add(unit.slotId);
    units.push({ slotId: unit.slotId, label: unit.label.trim(), imageDataUrl: unit.imageDataUrl });
  }
  return {
    schemaVersion: 1,
    snapshotId: value.snapshotId,
    sessionId: value.sessionId,
    capturedAt: value.capturedAt,
    expectedLevel: value.expectedLevel,
    layoutId: value.layoutId,
    units
  };
}

function extractBatch(raw: unknown): { samples: unknown[]; boardSnapshots: unknown[]; validEnvelope: boolean } {
  if (!raw || typeof raw !== "object") return { samples: [], boardSnapshots: [], validEnvelope: false };
  const value = raw as Partial<VisionDatasetBatch>;
  const validEnvelope = value.region === "CN"
    && value.season === "S18"
    && value.splitUnit === "session"
    && value.currentSeasonOnly === true
    && Array.isArray(value.samples);
  return {
    samples: Array.isArray(value.samples) ? value.samples : [],
    boardSnapshots: Array.isArray(value.boardSnapshots) ? value.boardSnapshots : [],
    validEnvelope
  };
}

export function analyzeVisionDataset(inputs: unknown[], now = Date.now()): VisionDatasetQaResult {
  const issues: VisionDatasetQaIssue[] = [];
  const normalized: Array<{ sample: VisionDatasetSample; fp: string }> = [];
  const snapshots: VisionBoardValidationSnapshot[] = [];
  let inputSamples = 0;
  let rejectedSamples = 0;

  for (const input of inputs) {
    const batch = extractBatch(input);
    if (!batch.validEnvelope) {
      issues.push({ severity: "error", code: "invalid_batch_envelope", detail: "批次必须是 CN / S18 / splitUnit=session / currentSeasonOnly=true。" });
      continue;
    }
    inputSamples += batch.samples.length;
    for (const raw of batch.samples) {
      const sample = normalizeSample(raw);
      if (!sample) {
        rejectedSamples += 1;
        continue;
      }
      normalized.push({ sample, fp: fingerprint(sample.imageDataUrl) });
    }
    for (const raw of batch.boardSnapshots) {
      const snapshot = normalizeBoardSnapshot(raw);
      if (snapshot) snapshots.push(snapshot);
      else issues.push({ severity: "warning", code: "invalid_board_snapshot", detail: "发现无法用于整盘评估的 board snapshot，已忽略。" });
    }
  }

  const byFingerprint = new Map<string, Array<{ sample: VisionDatasetSample; fp: string }>>();
  for (const entry of normalized) {
    const list = byFingerprint.get(entry.fp) ?? [];
    list.push(entry);
    byFingerprint.set(entry.fp, list);
  }

  const conflicting = new Set<string>();
  const crossSession = new Set<string>();
  let exactDuplicateSamples = 0;
  for (const [fp, entries] of byFingerprint) {
    const labels = new Set(entries.map(({ sample }) => sample.label));
    const sessions = new Set(entries.map(({ sample }) => sample.sessionId));
    if (labels.size > 1) {
      conflicting.add(fp);
      issues.push({ severity: "error", code: "conflicting_label", detail: `同一图像指纹 ${fp} 出现多个英雄标签，全部剔除。` });
    }
    if (sessions.size > 1) {
      crossSession.add(fp);
      issues.push({ severity: "error", code: "cross_session_duplicate", detail: `同一图像指纹 ${fp} 跨 session 重复，可能造成数据泄漏，全部剔除。` });
    }
    if (entries.length > 1) exactDuplicateSamples += entries.length - 1;
  }

  const seen = new Set<string>();
  const accepted: VisionDatasetSample[] = [];
  for (const entry of normalized.sort((a, b) => a.sample.capturedAt - b.sample.capturedAt)) {
    if (conflicting.has(entry.fp) || crossSession.has(entry.fp)) continue;
    const key = `${entry.sample.sessionId}:${entry.fp}:${entry.sample.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(entry.sample);
  }

  const sessionSet = new Set(accepted.map((sample) => sample.sessionId));
  const layouts = [...new Set(accepted.map((sample) => sample.layoutId))].sort();
  const zones: Record<VisionDatasetZone, number> = { board: 0, bench: 0 };
  const perLabelTemp = new Map<string, { samples: number; sessions: Set<string>; confidence: number }>();
  for (const sample of accepted) {
    zones[sample.zone] += 1;
    const current = perLabelTemp.get(sample.label) ?? { samples: 0, sessions: new Set<string>(), confidence: 0 };
    current.samples += 1;
    current.sessions.add(sample.sessionId);
    current.confidence += sample.labelConfidence;
    perLabelTemp.set(sample.label, current);
  }
  const perLabel: VisionDatasetQaReport["perLabel"] = {};
  for (const [label, value] of [...perLabelTemp.entries()].sort(([a], [b]) => a.localeCompare(b, "zh-CN"))) {
    perLabel[label] = {
      samples: value.samples,
      sessions: value.sessions.size,
      averageConfidence: value.samples ? value.confidence / value.samples : 0
    };
    if (label !== "__unknown__" && value.sessions.size < 3) {
      issues.push({ severity: "warning", code: "low_label_session_coverage", label, detail: `${label} 仅覆盖 ${value.sessions.size} 个 session，暂不足以判断跨局泛化。` });
    }
  }

  const unknown = accepted.filter((sample) => sample.label === "__unknown__");
  const unknownSessions = new Set(unknown.map((sample) => sample.sessionId)).size;
  const snapshotSessions = new Set(snapshots.map((snapshot) => snapshot.sessionId));
  const candidateTrainingReady = accepted.length >= 200
    && sessionSet.size >= 8
    && unknown.length >= 30
    && unknownSessions >= 3
    && conflicting.size === 0
    && crossSession.size === 0;
  const productionCoverageReady = sessionSet.size >= 50
    && unknownSessions >= 10
    && snapshotSessions.size >= 10
    && snapshots.length >= 30
    && conflicting.size === 0
    && crossSession.size === 0;

  if (!unknown.length) issues.push({ severity: "error", code: "missing_unknown", detail: "缺少 __unknown__ hard negatives，候选模型不能进入可靠 unknown rejection 评估。" });
  if (!snapshots.length) issues.push({ severity: "warning", code: "missing_board_snapshots", detail: "缺少整盘 validation snapshots，目前只能测 crop-level 指标。" });

  return {
    cleaned: {
      schemaVersion: 2,
      project: "TFTGOLDENCHANCHAN",
      region: "CN",
      season: "S18",
      splitUnit: "session",
      currentSeasonOnly: true,
      exportedAt: now,
      samples: accepted,
      boardSnapshots: snapshots
    },
    report: {
      schemaVersion: 1,
      generatedAt: now,
      inputBatches: inputs.length,
      inputSamples,
      acceptedSamples: accepted.length,
      rejectedSamples: rejectedSamples + normalized.length - accepted.length - exactDuplicateSamples,
      exactDuplicateSamples,
      conflictingFingerprints: conflicting.size,
      crossSessionDuplicateFingerprints: crossSession.size,
      sessions: sessionSet.size,
      labels: Object.keys(perLabel).length,
      unknownSamples: unknown.length,
      unknownSessions,
      boardSnapshots: snapshots.length,
      validBoardSnapshots: snapshots.length,
      layouts,
      zones,
      perLabel,
      issues,
      candidateTrainingReady,
      productionCoverageReady
    }
  };
}
