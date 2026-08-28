import {
  fuzzyHeroMatch,
  levenshtein,
  normalizeOcrText,
  type OcrBlock,
  type OcrFrame
} from "./recognition";

export type BoardVisionZone = "board" | "bench" | "ui";

export type NormalizedRect = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type BoardVisionLayout = {
  id: "landscape-16-9" | "landscape-wide" | "unsupported";
  supported: boolean;
  board: NormalizedRect;
  bench: NormalizedRect;
  shopGuard: NormalizedRect;
};

export type BoardVisionCatalog = {
  heroes: string[];
  items: string[];
};

export type HeroVisionEntity = {
  hero: string;
  zone: BoardVisionZone;
  stars: 1 | 2 | 3;
  copies: number;
  confidence: number;
  x: number;
  y: number;
  evidence: string[];
};

export type ItemVisionEntity = {
  item: string;
  confidence: number;
  x: number;
  y: number;
  evidence: string[];
};

export type BoardVisionZoneState = {
  units: Record<string, number>;
  entities: HeroVisionEntity[];
  confidence: number;
  complete: boolean;
  expectedSlots: number | null;
};

export type BoardVisionFrameState = {
  capturedAt: number;
  layout: BoardVisionLayout;
  board: BoardVisionZoneState;
  bench: BoardVisionZoneState;
  looseItems: string[];
  equippedItems: Record<string, string[]>;
  itemConfidence: number;
  evidence: string[];
};

export type FusedVisionZone = {
  units: Record<string, number>;
  confidence: number;
  samples: number;
  exactSamples: number;
  complete: boolean;
  expectedSlots: number | null;
};

export type FusedBoardVisionState = {
  board: FusedVisionZone;
  bench: FusedVisionZone;
  looseItems: string[];
  itemConfidence: number;
  itemSamples: number;
  equippedItems: Record<string, string[]>;
  equippedConfidence: number;
  equippedSamples: number;
  layoutId: BoardVisionLayout["id"];
  ageMs: number | null;
};

const EMPTY_RECT: NormalizedRect = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function center(block: OcrBlock, frame: OcrFrame): { x: number; y: number } {
  return {
    x: (block.x + block.width / 2) / Math.max(1, frame.width),
    y: (block.y + block.height / 2) / Math.max(1, frame.height)
  };
}

function inside(point: { x: number; y: number }, rect: NormalizedRect): boolean {
  return point.x >= rect.xMin && point.x <= rect.xMax && point.y >= rect.yMin && point.y <= rect.yMax;
}

export function selectBoardVisionLayout(frame: Pick<OcrFrame, "width" | "height">): BoardVisionLayout {
  const aspect = frame.width / Math.max(1, frame.height);
  if (aspect < 1.35) {
    return {
      id: "unsupported",
      supported: false,
      board: EMPTY_RECT,
      bench: EMPTY_RECT,
      shopGuard: EMPTY_RECT
    };
  }

  if (aspect >= 1.72) {
    return {
      id: "landscape-wide",
      supported: true,
      board: { xMin: 0.07, xMax: 0.91, yMin: 0.12, yMax: 0.55 },
      bench: { xMin: 0.08, xMax: 0.91, yMin: 0.54, yMax: 0.655 },
      shopGuard: { xMin: 0.02, xMax: 0.98, yMin: 0.66, yMax: 1 }
    };
  }

  return {
    id: "landscape-16-9",
    supported: true,
    board: { xMin: 0.06, xMax: 0.92, yMin: 0.13, yMax: 0.57 },
    bench: { xMin: 0.07, xMax: 0.92, yMin: 0.56, yMax: 0.67 },
    shopGuard: { xMin: 0.02, xMax: 0.98, yMin: 0.68, yMax: 1 }
  };
}

function starsFromText(raw: string): 1 | 2 | 3 {
  const text = normalizeOcrText(raw);
  if (/三星|3星|★★★|\*\*\*/.test(text)) return 3;
  if (/二星|2星|★★|\*\*/.test(text)) return 2;
  return 1;
}

function copiesForStars(stars: 1 | 2 | 3): number {
  return stars === 3 ? 9 : stars === 2 ? 3 : 1;
}

function normalizedCatalogToken(value: string): string {
  return normalizeOcrText(value).replace(/[^\p{Script=Han}A-Za-z0-9·]/gu, "");
}

export function fuzzyItemMatch(rawText: string, items: string[]): { item: string; score: number } | null {
  const text = normalizedCatalogToken(rawText)
    .replace(/(?:装备|推荐|合成|唯一|不可叠加)/g, "");
  if ([...text].length < 2) return null;

  let best: { item: string; score: number } | null = null;
  for (const item of items) {
    const normalized = normalizedCatalogToken(item);
    if (!normalized) continue;
    let score = 0;
    if (text === normalized) {
      score = 1;
    } else if (text.includes(normalized) || normalized.includes(text)) {
      const ratio = Math.min([...text].length, [...normalized].length) / Math.max([...text].length, [...normalized].length);
      score = 0.79 + ratio * 0.18;
    } else {
      const distance = levenshtein(text, normalized);
      score = 1 - distance / Math.max([...text].length, [...normalized].length, 1);
    }
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= 0.72 ? best : null;
}

function nearbyStarLevel(
  entityPoint: { x: number; y: number },
  blocks: OcrBlock[],
  frame: OcrFrame
): 1 | 2 | 3 {
  let best: { stars: 1 | 2 | 3; distance: number } | null = null;
  for (const block of blocks) {
    const stars = starsFromText(block.text);
    if (stars === 1) continue;
    const point = center(block, frame);
    const dx = point.x - entityPoint.x;
    const dy = point.y - entityPoint.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.085) continue;
    if (!best || distance < best.distance) best = { stars, distance };
  }
  return best?.stars ?? 1;
}

function heroZone(point: { x: number; y: number }, layout: BoardVisionLayout): BoardVisionZone {
  if (inside(point, layout.board)) return "board";
  if (inside(point, layout.bench)) return "bench";
  return "ui";
}

function candidateHeroEntities(
  frame: OcrFrame,
  catalog: BoardVisionCatalog,
  layout: BoardVisionLayout
): HeroVisionEntity[] {
  if (!layout.supported) return [];
  const raw: HeroVisionEntity[] = [];
  for (const block of frame.blocks) {
    if (clamp01(block.confidence) < 0.52) continue;
    const point = center(block, frame);
    if (inside(point, layout.shopGuard)) continue;
    const matched = fuzzyHeroMatch(block.text, catalog.heroes);
    if (!matched) continue;
    const zone = heroZone(point, layout);
    if (zone === "ui") continue;
    const lexical = matched.score;
    const confidence = clamp01(block.confidence * lexical * (zone === "board" ? 0.94 : 0.9));
    if (confidence < 0.62) continue;
    const stars = Math.max(starsFromText(block.text), nearbyStarLevel(point, frame.blocks, frame)) as 1 | 2 | 3;
    raw.push({
      hero: matched.hero,
      zone,
      stars,
      copies: copiesForStars(stars),
      confidence,
      x: point.x,
      y: point.y,
      evidence: [`${zone}:${block.text}→${matched.hero}`, `lexical=${lexical.toFixed(2)}`]
    });
  }

  const deduped: HeroVisionEntity[] = [];
  for (const candidate of raw.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const duplicateIndex = deduped.findIndex((existing) =>
      existing.zone === candidate.zone
      && existing.hero === candidate.hero
      && Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < 0.055
    );
    if (duplicateIndex < 0) {
      deduped.push(candidate);
      continue;
    }
    if (candidate.confidence > deduped[duplicateIndex].confidence || candidate.stars > deduped[duplicateIndex].stars) {
      deduped[duplicateIndex] = candidate;
    }
  }
  return deduped;
}

function buildZoneState(
  entities: HeroVisionEntity[],
  zone: "board" | "bench",
  expectedLevel?: number
): BoardVisionZoneState {
  const selected = entities.filter((entity) => entity.zone === zone);
  const units: Record<string, number> = {};
  for (const entity of selected) units[entity.hero] = (units[entity.hero] ?? 0) + entity.copies;
  const confidence = selected.length
    ? selected.reduce((sum, entity) => sum + entity.confidence, 0) / selected.length
    : 0;
  const expectedSlots = zone === "board" && Number.isInteger(expectedLevel) && Number(expectedLevel) > 0
    ? Math.max(1, Math.min(10, Number(expectedLevel)))
    : null;
  const complete = zone === "board"
    && expectedSlots !== null
    && selected.length === expectedSlots
    && confidence >= 0.74;
  return { units, entities: selected, confidence: clamp01(confidence), complete, expectedSlots };
}

function candidateItems(frame: OcrFrame, catalog: BoardVisionCatalog, layout: BoardVisionLayout): ItemVisionEntity[] {
  const items: ItemVisionEntity[] = [];
  for (const block of frame.blocks) {
    if (clamp01(block.confidence) < 0.56) continue;
    const point = center(block, frame);
    if (inside(point, layout.shopGuard)) continue;
    const matched = fuzzyItemMatch(block.text, catalog.items);
    if (!matched) continue;
    const confidence = clamp01(block.confidence * matched.score);
    if (confidence < 0.64) continue;
    items.push({
      item: matched.item,
      confidence,
      x: point.x,
      y: point.y,
      evidence: [`item:${block.text}→${matched.item}`]
    });
  }

  const deduped: ItemVisionEntity[] = [];
  for (const candidate of items.sort((a, b) => b.confidence - a.confidence)) {
    const duplicate = deduped.some((existing) => existing.item === candidate.item && Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < 0.045);
    if (!duplicate) deduped.push(candidate);
  }
  return deduped;
}

function associateItems(
  heroes: HeroVisionEntity[],
  items: ItemVisionEntity[]
): { looseItems: string[]; equippedItems: Record<string, string[]>; itemConfidence: number } {
  const equippedItems: Record<string, string[]> = {};
  const loose: ItemVisionEntity[] = [];

  for (const item of items) {
    const nearby = heroes
      .map((hero) => ({ hero, distance: Math.hypot(hero.x - item.x, hero.y - item.y) }))
      .filter(({ distance }) => distance <= 0.12)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearby && nearby.hero.confidence >= 0.74 && item.confidence >= 0.72) {
      const list = equippedItems[nearby.hero.hero] ?? [];
      if (!list.includes(item.item)) list.push(item.item);
      equippedItems[nearby.hero.hero] = list;
    } else {
      loose.push(item);
    }
  }

  const itemConfidence = items.length
    ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length
    : 0;
  return {
    looseItems: [...new Set(loose.map((item) => item.item))],
    equippedItems,
    itemConfidence: clamp01(itemConfidence)
  };
}

export function recognizeBoardVisionFrame(
  frame: OcrFrame,
  catalog: BoardVisionCatalog,
  options: { level?: number } = {}
): BoardVisionFrameState {
  const layout = selectBoardVisionLayout(frame);
  const heroes = candidateHeroEntities(frame, catalog, layout);
  const board = buildZoneState(heroes, "board", options.level);
  const bench = buildZoneState(heroes, "bench");
  const items = candidateItems(frame, catalog, layout);
  const associated = associateItems(heroes, items);
  const evidence = [
    `layout=${layout.id}`,
    `board=${board.entities.length}${board.expectedSlots ? `/${board.expectedSlots}` : ""}`,
    `bench=${bench.entities.length}`,
    `items=${items.length}`
  ];
  return {
    capturedAt: Number(frame.captured_at_ms),
    layout,
    board,
    bench,
    looseItems: associated.looseItems,
    equippedItems: associated.equippedItems,
    itemConfidence: associated.itemConfidence,
    evidence
  };
}

function unitMapSignature(units: Record<string, number>): string {
  return JSON.stringify(Object.entries(units).sort(([a], [b]) => a.localeCompare(b, "zh-CN")));
}

function listSignature(values: string[]): string {
  return JSON.stringify([...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-CN")));
}

function equippedSignature(value: Record<string, string[]>): string {
  return JSON.stringify(
    Object.entries(value)
      .map(([hero, items]) => [hero, [...new Set(items)].sort((a, b) => a.localeCompare(b, "zh-CN"))] as const)
      .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
  );
}

function fuseZone(
  frames: BoardVisionFrameState[],
  select: (frame: BoardVisionFrameState) => BoardVisionZoneState,
  now: number
): FusedVisionZone {
  const fresh = frames.filter((frame) => now - frame.capturedAt <= 12_000);
  if (!fresh.length) return { units: {}, confidence: 0, samples: 0, exactSamples: 0, complete: false, expectedSlots: null };
  const grouped = new Map<string, { state: BoardVisionZoneState; score: number; count: number; completeCount: number; newest: number }>();
  let total = 0;
  for (const frame of fresh) {
    const state = select(frame);
    if (!Object.keys(state.units).length) continue;
    const age = Math.max(0, now - frame.capturedAt);
    const weight = Math.max(0.05, state.confidence) * Math.pow(0.5, age / 4500);
    total += weight;
    const key = unitMapSignature(state.units);
    const current = grouped.get(key) ?? { state, score: 0, count: 0, completeCount: 0, newest: 0 };
    current.score += weight;
    current.count += 1;
    if (state.complete) current.completeCount += 1;
    if (frame.capturedAt >= current.newest) {
      current.state = state;
      current.newest = frame.capturedAt;
    }
    grouped.set(key, current);
  }
  const best = [...grouped.values()].sort((a, b) => b.score - a.score || b.newest - a.newest)[0];
  if (!best) return { units: {}, confidence: 0, samples: 0, exactSamples: 0, complete: false, expectedSlots: null };
  const agreement = total > 0 ? best.score / total : 0;
  const confidence = clamp01(agreement * best.state.confidence);
  return {
    units: { ...best.state.units },
    confidence,
    samples: fresh.length,
    exactSamples: best.count,
    complete: best.state.complete && best.completeCount >= Math.min(2, best.count),
    expectedSlots: best.state.expectedSlots
  };
}

function fuseListField(
  frames: BoardVisionFrameState[],
  select: (frame: BoardVisionFrameState) => string[],
  confidence: (frame: BoardVisionFrameState) => number,
  now: number
): { value: string[]; confidence: number; samples: number } {
  const fresh = frames.filter((frame) => now - frame.capturedAt <= 12_000 && select(frame).length > 0);
  if (!fresh.length) return { value: [], confidence: 0, samples: 0 };
  const groups = new Map<string, { value: string[]; score: number; count: number; newest: number; sourceConfidence: number }>();
  let total = 0;
  for (const frame of fresh) {
    const value = select(frame);
    const age = Math.max(0, now - frame.capturedAt);
    const sourceConfidence = confidence(frame);
    const weight = Math.max(0.05, sourceConfidence) * Math.pow(0.5, age / 4500);
    total += weight;
    const key = listSignature(value);
    const current = groups.get(key) ?? { value, score: 0, count: 0, newest: 0, sourceConfidence: 0 };
    current.score += weight;
    current.count += 1;
    current.sourceConfidence = Math.max(current.sourceConfidence, sourceConfidence);
    current.newest = Math.max(current.newest, frame.capturedAt);
    groups.set(key, current);
  }
  const best = [...groups.values()].sort((a, b) => b.score - a.score || b.newest - a.newest)[0];
  return {
    value: best?.value ?? [],
    confidence: best && total > 0 ? clamp01(best.score / total * best.sourceConfidence) : 0,
    samples: best?.count ?? 0
  };
}

function fuseEquipped(frames: BoardVisionFrameState[], now: number): { value: Record<string, string[]>; confidence: number; samples: number } {
  const fresh = frames.filter((frame) => now - frame.capturedAt <= 12_000 && Object.keys(frame.equippedItems).length > 0);
  if (!fresh.length) return { value: {}, confidence: 0, samples: 0 };
  const groups = new Map<string, { value: Record<string, string[]>; score: number; count: number; newest: number; sourceConfidence: number }>();
  let total = 0;
  for (const frame of fresh) {
    const age = Math.max(0, now - frame.capturedAt);
    const weight = Math.max(0.05, frame.itemConfidence) * Math.pow(0.5, age / 4500);
    total += weight;
    const key = equippedSignature(frame.equippedItems);
    const current = groups.get(key) ?? { value: frame.equippedItems, score: 0, count: 0, newest: 0, sourceConfidence: 0 };
    current.score += weight;
    current.count += 1;
    current.sourceConfidence = Math.max(current.sourceConfidence, frame.itemConfidence);
    current.newest = Math.max(current.newest, frame.capturedAt);
    groups.set(key, current);
  }
  const best = [...groups.values()].sort((a, b) => b.score - a.score || b.newest - a.newest)[0];
  return {
    value: best ? structuredClone(best.value) : {},
    confidence: best && total > 0 ? clamp01(best.score / total * best.sourceConfidence) : 0,
    samples: best?.count ?? 0
  };
}

export function fuseBoardVisionFrames(
  frames: BoardVisionFrameState[],
  now = Date.now()
): FusedBoardVisionState {
  const fresh = frames.filter((frame) => now - frame.capturedAt <= 12_000).slice(-8);
  const board = fuseZone(fresh, (frame) => frame.board, now);
  const bench = fuseZone(fresh, (frame) => frame.bench, now);
  const items = fuseListField(fresh, (frame) => frame.looseItems, (frame) => frame.itemConfidence, now);
  const equipped = fuseEquipped(fresh, now);
  const newest = [...fresh].sort((a, b) => b.capturedAt - a.capturedAt)[0];
  return {
    board,
    bench,
    looseItems: items.value,
    itemConfidence: items.confidence,
    itemSamples: items.samples,
    equippedItems: equipped.value,
    equippedConfidence: equipped.confidence,
    equippedSamples: equipped.samples,
    layoutId: newest?.layout.id ?? "unsupported",
    ageMs: newest ? Math.max(0, now - newest.capturedAt) : null
  };
}

export function safeBoardAutoApplyReady(state: FusedBoardVisionState): boolean {
  return state.board.complete
    && state.board.exactSamples >= 3
    && state.board.confidence >= 0.8
    && Object.keys(state.board.units).length > 0;
}
