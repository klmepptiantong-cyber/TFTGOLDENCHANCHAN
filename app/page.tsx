import comps from "../data/comps.json";
import { discoveryScore, metaScore } from "../lib/scoring";
import { Comp } from "../lib/types";

const data = comps as Comp[];
const ranked = [...data].sort((a, b) => metaScore(b) - metaScore(a));
const discoveries = [...data].sort((a, b) => discoveryScore(b) - discoveryScore(a));

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">TFTGOLDENCHANCHAN · V0.1</p>
          <h1>金铲铲实时决策助手</h1>
          <p className="muted">当前页面使用示例快照跑通产品与算法链路，实时国服采集器接入后会自动替换。</p>
        </div>
        <div className="status">PATCH 18.1b · 铂金→大师</div>
      </section>

      <section className="grid">
        <article className="panel span2">
          <div className="panelTitle"><h2>当前阵容排名</h2><span>Meta Score</span></div>
          <div className="cards">
            {ranked.map((comp, index) => (
              <div className="comp" key={comp.id}>
                <div className="rank">#{index + 1}</div>
                <div className="grow">
                  <div className="line"><strong>{comp.name}</strong><span className="tier">{comp.tier}</span></div>
                  <div className="stats">
                    <span>前四 {comp.top4Rate}%</span><span>登顶 {comp.winRate}%</span><span>均名 {comp.avgPlace}</span><span>样本 {comp.sampleSize}</span>
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
              <div><strong>{comp.name}</strong><p>出场 {comp.playRate}% · 24h {comp.trend24h > 0 ? "+" : ""}{comp.trend24h}%</p></div>
              <b>{discoveryScore(comp)}</b>
            </div>
          ))}
        </article>

        <article className="panel span3 advisor">
          <div>
            <div className="panelTitle"><h2>对局推荐 API 已就绪</h2><span>/api/recommend</span></div>
            <p className="muted">输入阶段、人口、金币、血量、已有棋子与装备，返回当前局最适配的 3 套阵容，以及留牌、卖牌、原因和下一步运营建议。</p>
          </div>
          <pre>{`POST /api/recommend
{
  "stage": "3-2",
  "level": 6,
  "gold": 42,
  "hp": 78,
  "units": { "蛇女": 2, "稻草人": 2, "洛": 2 },
  "items": ["眼泪", "青龙刀", "狂徒"]
}`}</pre>
        </article>
      </section>
    </main>
  );
}
