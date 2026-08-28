import type { VisionObservation } from "./vision";

export type OcrBlock = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrFrame = {
  window_id: string;
  title: string;
  source_width: number;
  source_height: number;
  width: number;
  height: number;
  captured_at_ms: number;
  elapsed_ms: number;
  blocks: OcrBlock[];
};

export type RecognizedField<T> = {
  value: T;
  confidence: number;
  evidence: string[];
};

export type RecognizedFrameState = {
  stage?: RecognizedField<string>;
  level?: RecognizedField<number>;
  gold?: RecognizedField<number>;
  hp?: RecognizedField<number>;
  shop?: RecognizedField<string[]>;
};

export type RecognitionCatalog = {
  heroes: string[];
};

const DASHES = /[‐‑‒–—―−﹣－]/g;
const SPACES = /[\s ]+/g;

export function normalizeOcrText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(SPACES, "")
    .replace(/[|｜]/g, "1")
    .trim();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function codepoints(value: string): string[] {
  return [...value];
}

export function levenshtein(left: string, right: string): number {
  const a = codepoints(left);
  const b = codepoints(right);
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

export function fuzzyHeroMatch(rawText: string, heroes: string[]): { hero: string; score: number } | null {
  const text = normalizeOcrText(rawText)
    .replace(/[★☆✦✧]/g, "")
    .replace(/\d+费?/g, "")
    .replace(/[^\p{Script=Han}A-Za-z0-9·]/gu, "");
  if (codepoints(text).length < 2) return null;

  let best: { hero: string; score: number } | null = null;
  for (const hero of heroes) {
    const normalizedHero = normalizeOcrText(hero).replace(/[^\p{Script=Han}A-Za-z0-9·]/gu, "");
    if (!normalizedHero) continue;
    let score = 0;
    if (text === normalizedHero) {
      score = 1;
    } else if (text.includes(normalizedHero) || normalizedHero.includes(text)) {
      const ratio = Math.min(codepoints(text).length, codepoints(normalizedHero).length)
        / Math.max(codepoints(text).length, codepoints(normalizedHero).length);
      score = 0.76 + ratio * 0.2;
    } else {
      const maxLength = Math.max(codepoints(text).length, codepoints(normalizedHero).length);
      const distance = levenshtein(text, normalizedHero);
      score = 1 - distance / Math.max(1, maxLength);
    }
    if (!best || score > best.score) best = { hero, score };
  }
  return best && best.score >= 0.68 ? best : null;
}

function meaningfulBlocks(frame: OcrFrame): Array<OcrBlock & { normalized: string }> {
  return frame.blocks
    .filter((block) => clamp01(block.confidence) >= 0.35 && block.width > 1 && block.height > 1)
    .map((block) => ({ ...block, normalized: normalizeOcrText(block.text) }))
    .filter((block) => block.normalized.length > 0);
}

function fieldConfidence(block: OcrBlock, parserConfidence = 1): number {
  return clamp01(block.confidence * parserConfidence);
}

function recognizeStage(frame: OcrFrame, blocks: ReturnType<typeof meaningfulBlocks>): RecognizedField<string> | undefined {
  const candidates: Array<RecognizedField<string> & { y: number }> = [];
  for (const block of blocks) {
    const centerY = (block.y + block.height / 2) / Math.max(1, frame.height);
    if (centerY > 0.55) continue;
    const match = block.normalized.match(/(?:阶段|回合|stage)?([2-9])[-](\d)/i);
    if (!match) continue;
    const stage = Number(match[1]);
    const round = Number(match[2]);
    if (round < 1 || round > 9) continue;
    const positionBoost = centerY < 0.25 ? 1 : 0.88;
    candidates.push({
      value: `${stage}-${round}`,
      confidence: fieldConfidence(block, positionBoost),
      evidence: [block.text],
      y: centerY
    });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence || a.y - b.y)[0];
}

function labeledNumber(
  blocks: ReturnType<typeof meaningfulBlocks>,
  pattern: RegExp,
  min: number,
  max: number
): RecognizedField<number> | undefined {
  const candidates: RecognizedField<number>[] = [];
  for (const block of blocks) {
    const match = block.normalized.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isInteger(value) || value < min || value > max) continue;
    candidates.push({ value, confidence: fieldConfidence(block, 1), evidence: [block.text] });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence)[0];
}

function positionalNumber(
  frame: OcrFrame,
  blocks: ReturnType<typeof meaningfulBlocks>,
  options: {
    min: number;
    max: number;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    parserConfidence: number;
  }
): RecognizedField<number> | undefined {
  const candidates: RecognizedField<number>[] = [];
  for (const block of blocks) {
    if (!/^\d{1,3}$/.test(block.normalized)) continue;
    const value = Number(block.normalized);
    if (!Number.isInteger(value) || value < options.min || value > options.max) continue;
    const centerX = (block.x + block.width / 2) / Math.max(1, frame.width);
    const centerY = (block.y + block.height / 2) / Math.max(1, frame.height);
    if (centerX < options.xMin || centerX > options.xMax || centerY < options.yMin || centerY > options.yMax) continue;
    candidates.push({
      value,
      confidence: fieldConfidence(block, options.parserConfidence),
      evidence: [`pos:${block.text}@${centerX.toFixed(2)},${centerY.toFixed(2)}`]
    });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence)[0];
}

function recognizeLevel(frame: OcrFrame, blocks: ReturnType<typeof meaningfulBlocks>): RecognizedField<number> | undefined {
  return labeledNumber(blocks, /(?:等级|人口|level|lv\.?)(?:[:：]?)(10|[1-9])/i, 1, 10)
    ?? positionalNumber(frame, blocks, {
      min: 1,
      max: 10,
      xMin: 0.02,
      xMax: 0.35,
      yMin: 0.70,
      yMax: 0.98,
      parserConfidence: 0.58
    });
}

function recognizeGold(frame: OcrFrame, blocks: ReturnType<typeof meaningfulBlocks>): RecognizedField<number> | undefined {
  return labeledNumber(blocks, /(?:金币|金钱|gold|金币数)(?:[:：]?)(\d{1,3})/i, 0, 200)
    ?? positionalNumber(frame, blocks, {
      min: 0,
      max: 200,
      xMin: 0.28,
      xMax: 0.72,
      yMin: 0.70,
      yMax: 0.98,
      parserConfidence: 0.56
    });
}

function recognizeHp(frame: OcrFrame, blocks: ReturnType<typeof meaningfulBlocks>): RecognizedField<number> | undefined {
  const labeled = labeledNumber(blocks, /(?:生命|血量|生命值|hp)(?:[:：]?)(100|\d{1,2})/i, 0, 100);
  if (labeled) return labeled;

  // HP is deliberately conservative because unlabeled percentages/numbers are common in TFT UI.
  const percentCandidates = blocks
    .map((block) => {
      const match = block.normalized.match(/^(100|\d{1,2})%$/);
      if (!match) return null;
      const centerX = (block.x + block.width / 2) / Math.max(1, frame.width);
      const centerY = (block.y + block.height / 2) / Math.max(1, frame.height);
      if (centerX < 0.70 || centerY > 0.55) return null;
      return {
        value: Number(match[1]),
        confidence: fieldConfidence(block, 0.62),
        evidence: [`hp-percent:${block.text}`]
      } satisfies RecognizedField<number>;
    })
    .filter((value): value is RecognizedField<number> => value !== null)
    .sort((a, b) => b.confidence - a.confidence);
  return percentCandidates[0];
}

function recognizeShop(
  frame: OcrFrame,
  blocks: ReturnType<typeof meaningfulBlocks>,
  catalog: RecognitionCatalog
): RecognizedField<string[]> | undefined {
  const matches = blocks
    .filter((block) => (block.y + block.height / 2) / Math.max(1, frame.height) >= 0.62)
    .map((block) => {
      const matched = fuzzyHeroMatch(block.text, catalog.heroes);
      if (!matched) return null;
      const confidence = clamp01(block.confidence * matched.score);
      if (confidence < 0.54) return null;
      return {
        hero: matched.hero,
        confidence,
        x: block.x + block.width / 2,
        text: block.text
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => a.x - b.x);

  // Collapse OCR duplicates around the same label position.
  const deduped: typeof matches = [];
  for (const match of matches) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous.x - match.x) < frame.width * 0.035) {
      if (match.confidence > previous.confidence) deduped[deduped.length - 1] = match;
    } else {
      deduped.push(match);
    }
  }

  // V0.6.1 only auto-applies a full five-slot read. Partial reads are surfaced as diagnostics
  // but never overwrite shop state, which protects the recommender from slot drift.
  if (deduped.length !== 5) return undefined;
  const average = deduped.reduce((sum, item) => sum + item.confidence, 0) / deduped.length;
  if (average < 0.62) return undefined;
  return {
    value: deduped.map((item) => item.hero),
    confidence: clamp01(average),
    evidence: deduped.map((item) => `${item.text}→${item.hero}`)
  };
}

export function recognizeFrameState(frame: OcrFrame, catalog: RecognitionCatalog): RecognizedFrameState {
  const blocks = meaningfulBlocks(frame);
  return {
    stage: recognizeStage(frame, blocks),
    level: recognizeLevel(frame, blocks),
    gold: recognizeGold(frame, blocks),
    hp: recognizeHp(frame, blocks),
    shop: recognizeShop(frame, blocks, catalog)
  };
}

export function toVisionObservation<T>(field: RecognizedField<T>, capturedAt: number): VisionObservation<T> {
  return {
    value: field.value,
    confidence: clamp01(field.confidence),
    capturedAt,
    source: "ocr"
  };
}
