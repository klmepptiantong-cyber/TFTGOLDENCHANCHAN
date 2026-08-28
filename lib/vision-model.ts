import type { PixelPrediction, PixelSlot } from "./slot-pixel";

export type VisionModelManifest = {
  schemaVersion: 1;
  id: string;
  status: "blocked" | "verified";
  precisionUse: "blocked" | "verified";
  runtime: "onnx-cpu";
  modelPath: string;
  classesPath: string;
  reportPath: string;
  modelSha256: string | null;
  thresholds: {
    perClassPrecisionMin: number;
    perClassRecallMin: number;
    unknownRecallMin: number;
    boardExactAccuracyMin: number;
    falseWriteRateMax: number;
    cpuP95MsMax: number;
  };
  reason?: string;
};

export type ModelSlotPrediction = {
  slotId: string;
  zone: "board" | "bench";
  hero: string | "__unknown__";
  confidence: number;
  unknownScore: number;
  latencyMs?: number;
};

export type EnsembleSlotPrediction = {
  slotId: string;
  zone: "board" | "bench";
  hero: string;
  confidence: number;
  trusted: boolean;
  source: "prototype" | "onnx" | "ensemble";
  evidence: string[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function modelRuntimeAllowed(manifest: VisionModelManifest): boolean {
  return manifest.schemaVersion === 1
    && manifest.status === "verified"
    && manifest.precisionUse === "verified"
    && manifest.runtime === "onnx-cpu"
    && Boolean(manifest.modelSha256);
}

export function ensembleSlotPrediction(
  slot: PixelSlot,
  prototype: PixelPrediction | null,
  model: ModelSlotPrediction | null,
  manifest: VisionModelManifest
): EnsembleSlotPrediction | null {
  const modelAllowed = modelRuntimeAllowed(manifest);
  const validModel = modelAllowed
    && model
    && model.slotId === slot.id
    && model.zone === slot.zone
    && model.hero !== "__unknown__"
    && clamp01(model.unknownScore) <= 0.18
    && clamp01(model.confidence) >= 0.82;
  const validPrototype = prototype?.slotId === slot.id && prototype.trusted;

  if (validModel && validPrototype && model!.hero === prototype!.hero) {
    const confidence = clamp01(prototype!.confidence * 0.42 + model!.confidence * 0.58 + 0.05);
    return {
      slotId: slot.id,
      zone: slot.zone,
      hero: model!.hero,
      confidence,
      trusted: confidence >= 0.84,
      source: "ensemble",
      evidence: [
        `prototype=${prototype!.confidence.toFixed(2)}`,
        `onnx=${model!.confidence.toFixed(2)}`,
        `unknown=${model!.unknownScore.toFixed(2)}`
      ]
    };
  }

  if (validModel && (!prototype || !prototype.trusted)) {
    const confidence = clamp01(model!.confidence * (1 - model!.unknownScore * 0.55));
    return {
      slotId: slot.id,
      zone: slot.zone,
      hero: model!.hero,
      confidence,
      trusted: confidence >= 0.86,
      source: "onnx",
      evidence: [`onnx=${model!.confidence.toFixed(2)}`, `unknown=${model!.unknownScore.toFixed(2)}`]
    };
  }

  if (validPrototype) {
    return {
      slotId: slot.id,
      zone: slot.zone,
      hero: prototype!.hero,
      confidence: prototype!.confidence,
      trusted: prototype!.trusted,
      source: "prototype",
      evidence: [
        modelAllowed ? "onnx=no-trusted-result" : "onnx=blocked-by-manifest",
        `prototype=${prototype!.confidence.toFixed(2)}`
      ]
    };
  }

  return null;
}
