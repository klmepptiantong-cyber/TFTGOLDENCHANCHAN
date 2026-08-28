import snapshotJson from "../data/latest.json";
import sourceStatusJson from "../data/source-status.json";
import { discoveryScore, metaScore } from "../lib/scoring";
import { MetaSnapshot, SourceStatus } from "../lib/types";

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

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">TFTGOLDENCHANCHAN · V0.2 REAL DATA LAYER</p>
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
                    {comp.needsEnrichment ? <span className="tier">NEW</span> : null}
                  </div>
                  <div className="stats">
                    <span>前四 {comp.top4Rate}%</span>
                    <span>登顶 {comp.winRate}%</span>
                    <span>均名 {comp.avgPlace}</span>
                    <span>样本≈{comp.sampleSize}</span>
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
                <p>出场 {comp.playRate} · 24h {comp.trend24h > 0 ? "+" : ""}{comp.trend24h} · {comp.needsEnrichment ? "待补阵容细节" : "已可推荐"}</p>
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
              分段覆盖：{sourceStatus.rankCoverage.join(" / ")} · 铂金→大师精确分段：{sourceStatus.targetRankCoverage ? "已接入" : "待接入公开统计端点"}
            </p>
          </div>
          <pre>{`POST /api/recommend
{
  "stage": "3-2",
  "level": 6,
  "gold": 42,
  "hp": 78,
  "units": { "蛇女": 2, "稻草人": 2, "洛": 2 },
  "items": ["眼泪", "青龙刀", "狂徒"],
  "rankBand": "platinum"
}`}</pre>
        </article>
      </section>
    </main>
  );
}
