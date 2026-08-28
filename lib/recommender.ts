import { Comp, DecisionAction, GameState, Recommendation, UnitCollection, UnitState } from "./types";
import { confidenceScore, discoveryScore, metaScore } from "./scoring";

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x));

function unitCopies(value: number | UnitState | undefined): number {
  if (typeof value === "number") return Math.max(0, value);
  if (!value) return 0;
  if (typeof value.copies === "number") return Math.max(0, value.copies);
  if (value.stars === 3) return 9;
  if (value.stars === 2) return 3;
  return value.stars === 1 ? 1 : 0;
}

function mergeOwned(...collections: (UnitCollection | undefined)[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const collection of collections) {
    for (const [name, value] of Object.entries(collection ?? {})) {
      merged[name] = (merged[name] ?? 0) + unitCopies(value);
    }
  }
  return merged;
}

function allItems(state: GameState): string[] {
  return unique([
    ...state.items,
    ...Object.values(state.equippedItems ?? {}).flat(),
    ...Object.values(state.units).flatMap((unit) => typeof unit === "object" ? unit.items ?? [] : []),
    ...Object.values(state.bench ?? {}).flatMap((unit) => typeof unit === "object" ? unit.items ?? [] : [])
  ]);
}

function augmentTraitHits(comp: Comp, state: GameState): string[] {
  const augments = state.augments ?? [];
  const traits = (comp.sourceTraits ?? []).filter((trait) => trait.length >= 2);
  return unique(augments.filter((augment) => traits.some((trait) => augment.includes(trait) || trait.includes(augment))));
}

function augmentAssessment(comp: Comp, state: GameState): { score: number; hits: string[]; evidence: string[] } {
  const augments = state.augments ?? [];
  if (!augments.length) return { score: 0, hits: [], evidence: [] };

  const hits = augmentTraitHits(comp, state);
  const economy = augments.filter((augment) => /经济|金币|利息|经验|升级|刷新|商店|D牌|搜牌/.test(augment));
  const combat = augments.filter((augment) => /伤害|攻速|法强|攻击|护甲|魔抗|生命|吸血|暴击|治疗|护盾|战力|全能/.test(augment));
  const general = augments.filter((augment) => !hits.includes(augment) && !economy.includes(augment) && !combat.includes(augment));
  const score = Math.min(100, hits.length * 40 + combat.length * 18 + economy.length * 12 + general.length * 5);
  const evidence: string[] = [];
  if (hits.length) evidence.push(`羁绊定向：${hits.join(" / ")}`);
  if (combat.length) evidence.push(`战力类×${combat.length}`);
  if (economy.length) evidence.push(`经济类×${economy.length}`);
  if (general.length) evidence.push(`通用/未分类×${general.length}`);
  return { score, hits, evidence };
}

function completionScore(comp: Comp, state: GameState): number {
  const owned = mergeOwned(state.units, state.bench);
  const core = unique(comp.coreUnits);
  const coreOwned = core.filter((unit) => (owned[unit] ?? 0) > 0).length;
  const unitCoverage = core.length ? coreOwned / core.length : 0;

  const targetItems = unique(comp.keyItems).slice(0, 3);
  const matchedItems = unique(overlap(targetItems, allItems(state))).length;
  const itemCoverage = targetItems.length ? matchedItems / targetItems.length : 0;

  return Math.max(0, Math.min(100, Math.round(unitCoverage * 70 + itemCoverage * 30)));
}

function contestedCount(comp: Comp, state: GameState): number {
  return Math.max(0, Math.min(7, Math.round(state.contestedComps?.[comp.id] ?? 0)));
}

type PoolPressureAssessment = {
  average: number;
  peak: number;
  penalty: number;
  heroes: Array<{ hero: string; pressure: number }>;
};

function poolPressureAssessment(comp: Comp, state: GameState): PoolPressureAssessment {
  const targets = unique(comp.coreUnits);
  if (!targets.length) return { average: 0, peak: 0, penalty: 0, heroes: [] };
  const values = targets.map((hero) => ({
    hero,
    pressure: Math.max(0, Math.min(1, Number(state.poolPressureByHero?.[hero] ?? 0)))
  }));
  const average = values.reduce((sum, item) => sum + item.pressure, 0) / targets.length;
  const peak = values.reduce((max, item) => Math.max(max, item.pressure), 0);
  const penalty = Math.min(18, Math.max(0, Math.round(
    Math.max(0, average - 0.12) * 10 + Math.max(0, peak - 0.30) * 16
  )));
  const heroes = values
    .filter((item) => item.pressure >= 0.18)
    .sort((a, b) => b.pressure - a.pressure)
    .slice(0, 3);
  return { average, peak, penalty, heroes };
}

function targetLevel(comp: Comp): number {
  const fiveCosts = (comp.sourceLineup ?? []).filter((unit) => unit.price === 5).length;
  const highCap = /95|九五/.test(comp.name) || fiveCosts >= 3 || comp.stagePlan.some((line) => /9\s*人口|九人口/.test(line));
  if (highCap) return 9;

  const carryCost = comp.sourceCarries?.find((carry) => carry.role === "carry")?.price ?? null;
  if (carryCost !== null && carryCost <= 2) return 6;
  if (carryCost === 3) return 7;
  return 8;
}

function fitScore(comp: Comp, state: GameState, augmentScore: number): number {
  const owned = mergeOwned(state.units, state.bench);
  const ownedNames = Object.keys(owned);
  const coreHits = overlap(comp.coreUnits, ownedNames).reduce(
    (sum, unit) => sum + Math.min(owned[unit] ?? 0, 3),
    0
  );
  const flexHits = overlap(comp.flexUnits, ownedNames).length;
  const shopHits = overlap([...comp.coreUnits, ...comp.flexUnits], state.shop ?? []).length;
  const itemHits = overlap(comp.keyItems, allItems(state)).length;

  const unitScore = Math.min(38, coreHits * 7 + flexHits * 2);
  const shopScore = Math.min(12, shopHits * 5);
  const itemScore = Math.min(20, itemHits * 6);
  const augmentFitScore = Math.min(10, Math.round(augmentScore / 10));
  const economyScore = state.gold >= 50 ? 10 : state.gold >= 30 ? 8 : state.gold >= 20 ? 5 : 2;
  const hpScore = state.hp >= 70 ? 10 : state.hp >= 45 ? 7 : state.hp >= 25 ? 4 : 1;
  const lockBonus = state.lockedCompId === comp.id ? 10 : 0;
  const contestPenalty = Math.min(24, contestedCount(comp, state) * 6);
  const poolPenalty = poolPressureAssessment(comp, state).penalty;

  return Math.max(0, Math.min(100, Math.round(
    unitScore + shopScore + itemScore + augmentFitScore + economyScore + hpScore + lockBonus - contestPenalty - poolPenalty
  )));
}

function rollAdvice(comp: Comp, state: GameState): string {
  const levelTarget = targetLevel(comp);
  const pressure = poolPressureAssessment(comp, state);
  if (state.hp <= 25) return `血量仅 ${state.hp}：立即D牌止血，先把当前可用前排/核心补到两星，不再为50利息硬扛。`;
  if (pressure.peak >= 0.65 && state.gold >= 20) {
    const hero = pressure.heroes[0]?.hero ?? "核心牌";
    return `${hero} 的相对卡池压力很高：本轮D牌必须设止损线，优先补通用两星战力；若连续两轮核心断档，不要把全部经济锁死在单一路线。`;
  }
  if (state.hp <= 40 && state.gold >= 20) return `血量偏低：在 ${state.level} 级做一轮有上限的搜牌，优先两星核心和前排；质量稳定后停手存钱。`;
  if (state.level < levelTarget && state.gold >= 40) return `当前更需要人口而不是空D：保留经济，向 ${levelTarget} 级推进后再集中搜 ${comp.name} 的核心。`;
  if (state.level >= levelTarget && state.gold >= 30) return `已到主要搜牌人口：可在 ${state.level} 级分批D牌，优先主C/主坦两星，避免一次把经济打空。`;
  return `经济尚未进入强搜窗口：先补利息与场面质量，除非连续大掉血，否则不要无目的刷新。`;
}

function levelAdvice(comp: Comp, state: GameState): string {
  const levelTarget = targetLevel(comp);
  if (state.level >= levelTarget) {
    if (levelTarget === 9) return "已到9人口目标位：优先把高费核心两星，再考虑用多余经济追终局上限。";
    return `已到 ${levelTarget} 级关键人口：人口优先级下降，资源转向补核心两星与关键羁绊。`;
  }
  if (state.hp <= 30) return `先别强冲 ${levelTarget}：当前血量要求先用金币换即时战力，稳定后再升级。`;
  if (state.gold >= 50) return `经济健康：吃利息向 ${levelTarget} 级推进；升级后仍尽量保留一轮搜牌资金。`;
  return `目标人口约 ${levelTarget} 级；当前先保经济和场面，不建议为了赶人口把金币降到危险区。`;
}

function pivotAdvice(comp: Comp, state: GameState, fit: number, keep: string[]): string {
  const contested = contestedCount(comp, state);
  const pressure = poolPressureAssessment(comp, state);
  const pressureHero = pressure.heroes[0]?.hero;
  if (state.lockedCompId === comp.id && contested >= 3) {
    return `你已锁定 ${comp.name}，但侦察到 ${contested} 家同行：优先保血并观察核心牌库存，若持续断档应开放转阵。`;
  }
  if (state.lockedCompId === comp.id && pressure.peak >= 0.70) {
    return `你已锁定 ${comp.name}，但 ${pressureHero ?? "核心牌"} 的相对卡池压力已经很高：保留现有成型质量，同时准备一套共享装备的备选方向。`;
  }
  if (state.lockedCompId === comp.id) return `你已锁定 ${comp.name}：除非核心牌完全断档或血量进入危险线，否则围绕现有体系继续补强。`;
  if (contested >= 3 && fit < 78) return `${comp.name} 当前有 ${contested} 家同行且你的完成度优势不足，不建议硬挤；优先保留其他候选路线。`;
  if (pressure.peak >= 0.70 && fit < 80) return `${pressureHero ?? "核心牌"} 的相对卡池压力很高，且当前契合度没有形成明显优势；建议开放转阵，不为榜单排名硬追。`;
  if (fit >= 75) return `阵容契合度高：优先沿 ${comp.name} 收束，不建议因为单次商店不来牌就转阵。`;
  if (fit >= 58 || keep.length >= 3) return `具备转入 ${comp.name} 的基础，但还没到必须锁死的程度；观察未来1–2轮核心牌和装备命中再决定。`;
  return `当前对 ${comp.name} 的沉没成本低，把它作为备选而不是强转目标；若另一套候选命中更多两星/装备，优先保血。`;
}

function itemAdvice(comp: Comp, state: GameState): string[] {
  const currentItems = allItems(state);
  const matched = unique(overlap(comp.keyItems, currentItems));
  if (!matched.length) {
    return ["当前装备与该阵容核心装命中较少：优先做通用即时战力装，不要为了榜单阵容长期空装备。"];
  }

  const advice = matched.slice(0, 4).map((item) => {
    const carriers = Object.entries(comp.itemCarriers)
      .filter(([, items]) => items.includes(item))
      .map(([hero]) => hero);
    return carriers.length
      ? `${item}：终局优先给 ${carriers.join(" / ")}`
      : `${item}：与该阵容核心装备方向匹配`;
  });

  for (const [holder, equipped] of Object.entries(state.equippedItems ?? {})) {
    for (const item of equipped) {
      if (!comp.keyItems.includes(item)) continue;
      const ideal = Object.entries(comp.itemCarriers)
        .filter(([, items]) => items.includes(item))
        .map(([hero]) => hero);
      if (ideal.length && !ideal.includes(holder)) {
        advice.push(`${holder} 当前携带 ${item}；若后续出现可替换/重铸窗口，终局更适合 ${ideal.join(" / ")}`);
      }
    }
  }

  return unique(advice).slice(0, 6);
}

function buildActions(
  comp: Comp,
  state: GameState,
  buy: string[],
  keep: string[],
  sell: string[],
  roll: string,
  level: string,
  pivot: string,
  items: string[]
): DecisionAction[] {
  const actions: DecisionAction[] = [];
  const pressure = poolPressureAssessment(comp, state);
  if (buy.length) actions.push({
    kind: "buy",
    priority: comp.coreUnits.some((unit) => buy.includes(unit)) ? "high" : "medium",
    text: `商店建议买入：${buy.join(" / ")}`,
    evidence: ["商店来牌命中候选阵容核心/功能位"]
  });
  if (keep.length) actions.push({
    kind: "keep",
    priority: "medium",
    text: `体系牌继续保留：${keep.join(" / ")}`,
    evidence: ["当前场上/替补席与候选阵容重合"]
  });
  if (sell.length) actions.push({
    kind: "sell",
    priority: state.hp <= 35 ? "medium" : "low",
    text: `若确定转入该阵容，可优先清理低投入非体系牌：${sell.join(" / ")}`,
    evidence: ["这些棋子不在该阵容核心或功能位中", "两星/高投入过渡牌不会被自动列为卖牌"]
  });
  actions.push({
    kind: "roll",
    priority: state.hp <= 40 ? "high" : "medium",
    text: roll,
    evidence: [
      `血量=${state.hp}`,
      `金币=${state.gold}`,
      `人口=${state.level}`,
      ...(pressure.heroes.length ? [`相对卡池压力：${pressure.heroes.map((item) => `${item.hero} ${(item.pressure * 100).toFixed(0)}%`).join(" / ")}`] : [])
    ]
  });
  actions.push({ kind: "level", priority: state.gold >= 40 && state.hp > 30 ? "medium" : "low", text: level, evidence: [`目标人口≈${targetLevel(comp)}`, `当前人口=${state.level}`] });
  actions.push({ kind: "pivot", priority: "medium", text: pivot, evidence: ["依据现有体系牌、装备、商店命中、同行侦察、相对卡池压力和阵容锁定状态"] });
  if (items.length) actions.push({ kind: "item", priority: "medium", text: items[0], evidence: ["依据实时快照中的已核验装备持有者"] });
  return actions;
}

function nextStep(state: GameState, buy: string[], roll: string, level: string): string {
  if (buy.length) return `先处理当前商店：${buy.join(" / ")}。随后按经济计划执行。`;
  if (state.hp <= 40) return roll;
  return state.gold >= 40 ? level : roll;
}

export function recommend(comps: Comp[], state: GameState): Recommendation[] {
  const owned = mergeOwned(state.units, state.bench);
  const ownedNames = Object.keys(owned);
  const shop = state.shop ?? [];

  const ranked = comps
    .filter((comp) => !comp.needsEnrichment && comp.coreUnits.length > 0 && comp.stagePlan.length > 0)
    .map((comp) => {
      const augment = augmentAssessment(comp, state);
      const rawFit = fitScore(comp, state, augment.score);
      const meta = metaScore(comp);
      const discovery = discoveryScore(comp);
      const systemUnits = [...comp.coreUnits, ...comp.flexUnits];
      const keep = systemUnits.filter((unit) => ownedNames.includes(unit));
      const buy = unique(shop.filter((unit) => systemUnits.includes(unit)));
      const sell = ownedNames.filter((unit) => !systemUnits.includes(unit) && (owned[unit] ?? 0) < 3);
      const matchedItems = overlap(comp.keyItems, allItems(state));
      const completion = completionScore(comp, state);
      const contested = contestedCount(comp, state);
      const pressure = poolPressureAssessment(comp, state);
      const reasons: string[] = [];
      const blendedFit = Math.round(rawFit * 0.65 + meta * 0.35);

      if (keep.length) reasons.push(`场上/替补席已有 ${keep.length} 个体系英雄命中`);
      if (buy.length) reasons.push(`当前商店出现 ${buy.length} 个可直接买入的体系英雄`);
      if (matchedItems.length) reasons.push(`已有 ${unique(matchedItems).length} 件核心装备方向命中`);
      if (augment.hits.length) reasons.push(`强化符文与羁绊方向匹配：${augment.hits.join(" / ")}`);
      else if ((state.augments ?? []).length) reasons.push(`强化符文结构化得分 ${augment.score}/100`);
      if (contested > 0) reasons.push(`侦察记录：${contested} 家同行，已计入阵容竞争惩罚`);
      if (pressure.heroes.length) {
        reasons.push(`相对卡池压力：${pressure.heroes.map((item) => `${item.hero} ${(item.pressure * 100).toFixed(0)}%`).join(" / ")}（不输出未核验精确命中率）`);
      }
      if (completion >= 60) reasons.push(`当前阵容完成度 ${completion}%`);
      if (comp.trend24h > 0) reasons.push(`最近24小时表现提升 ${comp.trend24h.toFixed(1)}%`);
      if (comp.sampleSize >= 2000) reasons.push("样本量达到可参考区间");
      if (comp.stagePlanSource === "derived-economy-v1") reasons.push("运营节奏由已核验费用/目标星级规则推导");
      if (state.lockedCompId === comp.id) reasons.push("该阵容已被用户锁定，跨回合持续保留在候选首位");

      const roll = rollAdvice(comp, state);
      const level = levelAdvice(comp, state);
      const pivot = pivotAdvice(comp, state, blendedFit, keep);
      const items = itemAdvice(comp, state);

      return {
        comp,
        metaScore: meta,
        fitScore: blendedFit,
        discoveryScore: discovery,
        confidence: confidenceScore(comp.sampleSize),
        completionScore: completion,
        augmentScore: augment.score,
        augmentHits: augment.hits,
        contestedCount: contested,
        buy,
        keep,
        sell,
        reasons,
        nextStep: nextStep(state, buy, roll, level),
        rollAdvice: roll,
        levelAdvice: level,
        pivotAdvice: pivot,
        itemAdvice: items,
        actions: buildActions(comp, state, buy, keep, sell, roll, level, pivot, items)
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore || b.metaScore - a.metaScore);

  if (state.lockedCompId) {
    const locked = ranked.find((rec) => rec.comp.id === state.lockedCompId);
    if (locked) {
      return [locked, ...ranked.filter((rec) => rec.comp.id !== state.lockedCompId).slice(0, 2)];
    }
  }

  return ranked.slice(0, 3);
}