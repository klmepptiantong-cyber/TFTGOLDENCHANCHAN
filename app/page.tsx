import snapshotJson from "../data/latest.json";
import sourceStatusJson from "../data/source-status.json";
import { discoveryScore, metaScore } from "../lib/scoring";
import { Comp, MetaSnapshot, SourceStatus } from "../lib/types";
import LiveAdvisor from "./LiveAdvisor";

// JSON snapshots are validated by scripts/check-data.mjs before build/commit.
const snapshot = snapshotJson as unknown as MetaSnapshot;
const sourceStatus = sourceStatusJson as unknown as SourceStatus;
const ranked = [...snapshot.comps].sort((a, b) => metaScore(b) - metaScore(a)).slice(0, 15);
const discoveries = [...snapshot.comps].sort((a, b) => discoveryScore(b) - discoveryScore(a)).slice(0, 8);

function beijingTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function enrichmentBadge(comp: Comp) {
  if (!comp.needsEnrichment || comp.enrichmentStatus === "full") {
    return comp.stagePlanSource === "derived-economy-v1" ? "AUTO READY" : "READY";
  }
  if (comp.enrichmentStatus === "partial" && comp.enrichmentVerifiedFields?.includes("keyItems")) return "BUILD ✓";
  if (comp.enrichmentStatus === "partial") return "ROSTER ✓";
  return "NEW";
}

function enrichmentText(comp: Comp) {
  if (!comp.needsEnrichment || comp.enrichmentStatus === "full") {
    return comp.stagePlanSource === "derived-economy-v1"
      ? "装备已核验，运营节奏由可审计经济规则推导，已进入推荐候选"
      : "已可进入推荐候选";
  }
  if (comp.enrichmentStatus === "partial" && comp.enrichmentVerifiedFields?.includes("keyItems")) return "英雄与装备已自动补全，运营节奏待补";
  if (comp.enrichmentStatus === "partial") return "英雄阵容已自动补全，装备名称/运营待补";
  return "待补阵容细节";
}

export default function Home() {
  const verifiedRankBands = sourceStatus.rankStatus?.verifiedPublicBands ?? snapshot.verifiedPublicRankBands ?? [];
  const partialCount = sourceStatus.enrichmentQueue?.partialCount ?? snapshot.enrichmentPartial ?? 0;
  const pendingCount = sourceStatus.enrichmentQueue?.pendingCount ?? snapshot.enrichmentPending ?? 0;

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">TFTGOLDENCHANCHAN · V0.3 LIVE DECISION</p>
          <h1>金铲铲实时决策助手</h1>
          <p className="muted">
            {snapshot.isLive
              ? `已接受真实统计快照 · 数据源 ${snapshot.source} · 北京时间 ${beijingTime(snapshot.fetchedAt)}`
              : `当前显示安全回退快照 · 实时采集器已部署，等待下一次通过版本校验的数据刷新。`}
          </p>
        </div>
        <div className="status">
          {snapshot.isLive ? "LIVE" : "SAFE FALLBACK"} · PATCH {snapshot.patch}
        </div>
      </section>

      <section className="grid">
        <LiveAdvisor />

        <article className="panel span2">
          <div className="panelTitle"><h2>当前阵容排名</h2><span>Meta Score · {snapshot.rankBand}</span></div>
          <div className="cards">
            {ranked.map((comp, index) => (
              <div className="comp" key={comp.id}>
                <div className="rank">#{index + 1}</div>
                <div className="grow">
                  <div className="line">
                    <strong>{comp.name}</strong>
                    <span className="tier">{comp.tier}</span>
                    <span className="tier">{enrichmentBadge(comp)}</span>
                  </div>
                  <div className="stats">
                    <span>前四 {comp.top4Rate}%</span>
                    <span>登顶 {comp.winRate}%</span>
                    <span>均名 {comp.avgPlace}</span>
                    <span>样本 {comp.sampleSize}</span>
                    <span>24h {comp.trend24h > 0 ? "+" : ""}{comp.trend24h}</span>
                  </div>
                </div>
                <div className="score">{metaScore(comp)}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panelTitle"><h2>冷门雷达</h2><span>Discovery</span></div>
          {discoveries.map((comp) => (
            <div className="discovery" key={comp.id}>
              <div>
                <strong>{comp.name}</strong>
                <p>出场 {comp.playRate} · 24h {comp.trend24h > 0 ? "+" : ""}{comp.trend24h} · {enrichmentText(comp)}</p>
              </div>
              <b>{discoveryScore(comp)}</b>
            </div>
          ))}
        </article>

        <article className="panel span3 advisor">
          <div>
            <div className="panelTitle"><h2>数据健康状态</h2><span>{sourceStatus.liveCompDataAccepted ? "VERIFIED" : "GUARDED"}</span></div>
            <p className="muted">当前权威版本：{sourceStatus.authoritativePatch ?? "未知"}</p>
            <p className="muted">{sourceStatus.note}</p>
            <p className="muted">
              实际统计覆盖：{sourceStatus.rankCoverage.join(" / ")} · 已核验国服公共高分段：{verifiedRankBands.length ? verifiedRankBands.join(" / ") : "无"}
            </p>
            <p className="muted">
              铂金→大师目标分段：{sourceStatus.targetRankCoverage ? "已接入" : "未发现国服公开入口"} · 待补全：{pendingCount}（partial {partialCount}）
            </p>
            <p className="muted">解析模式：{snapshot.parserMode ?? "legacy"} · 样本口径：{snapshot.sampleSizeMethod ?? "未标注"}</p>
          </div>
          <pre>{`POST /api/recommend
{
  "stage": "4-1",
  "level": 7,
  "gold": 36,
  "hp": 52,
  "units": { "伊泽瑞尔": 1, "阿木木": 2 },
  "bench": { "德莱文": 1 },
  "shop": ["塔里克", "凯南", "其他英雄"],
  "items": ["朔极之矛", "狂徒铠甲"],
  "equippedItems": { "伊泽瑞尔": ["朔极之矛"] },
  "augments": ["永恒之森之徽"]
}`}</pre>
        </article>
      </section>
    </main>
  );
}
