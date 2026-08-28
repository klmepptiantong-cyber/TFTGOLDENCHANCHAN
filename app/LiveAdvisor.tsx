"use client";

import { FormEvent, useState } from "react";
import type { Recommendation } from "../lib/types";

type ApiResponse = {
  engineVersion: string;
  patch: string;
  live: boolean;
  result: Recommendation[];
};

function parseList(value: string): string[] {
  return value
    .split(/[，,;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseUnits(value: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const token of parseList(value)) {
    const match = token.match(/^(.+?)(?:\s*[=xX*×]\s*(\d+))?$/);
    if (!match) continue;
    const name = match[1].trim();
    const copies = Math.max(1, Math.min(9, Number(match[2] ?? 1)));
    if (name) result[name] = copies;
  }
  return result;
}

function parseEquipped(value: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const token of value.split(/[;；\n]/).map((item) => item.trim()).filter(Boolean)) {
    const [holder, itemText] = token.split(/[:：]/, 2);
    if (!holder?.trim() || !itemText?.trim()) continue;
    result[holder.trim()] = itemText.split(/[\/、,，]/).map((item) => item.trim()).filter(Boolean);
  }
  return result;
}

const kindLabel: Record<string, string> = {
  buy: "买",
  keep: "留",
  sell: "卖",
  roll: "D牌",
  level: "升人口",
  pivot: "转阵",
  item: "装备"
};

export default function LiveAdvisor() {
  const [stage, setStage] = useState("3-2");
  const [level, setLevel] = useState(6);
  const [gold, setGold] = useState(42);
  const [hp, setHp] = useState(78);
  const [streak, setStreak] = useState(0);
  const [units, setUnits] = useState("蛇女=2, 稻草人=2, 洛=2");
  const [bench, setBench] = useState("");
  const [shop, setShop] = useState("");
  const [items, setItems] = useState("眼泪, 朔极之矛, 狂徒铠甲");
  const [equipped, setEquipped] = useState("");
  const [augments, setAugments] = useState("");
  const [lockedCompId, setLockedCompId] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stage,
          level,
          gold,
          hp,
          streak,
          units: parseUnits(units),
          bench: parseUnits(bench),
          shop: parseList(shop).slice(0, 5),
          items: parseList(items),
          equippedItems: parseEquipped(equipped),
          augments: parseList(augments),
          lockedCompId
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setResult(await response.json() as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel span3 liveAdvisor">
      <div className="panelTitle">
        <h2>V0.3 实战决策台</h2>
        <span>{lockedCompId ? "阵容已锁定 · 持续决策" : "LIVE INPUT"}</span>
      </div>
      <p className="muted advisorIntro">输入当前回合真实状态。英雄格式支持“英雄=张数”；装备持有者格式示例“伊泽瑞尔:朔极之矛/锐利之刃”。</p>

      <form className="decisionForm" onSubmit={submit}>
        <div className="compactInputs">
          <label>阶段<input value={stage} onChange={(e) => setStage(e.target.value)} /></label>
          <label>人口<input type="number" min="1" max="10" value={level} onChange={(e) => setLevel(Number(e.target.value))} /></label>
          <label>金币<input type="number" min="0" max="200" value={gold} onChange={(e) => setGold(Number(e.target.value))} /></label>
          <label>血量<input type="number" min="0" max="100" value={hp} onChange={(e) => setHp(Number(e.target.value))} /></label>
          <label>连胜/连败<input type="number" min="-20" max="20" value={streak} onChange={(e) => setStreak(Number(e.target.value))} /></label>
        </div>

        <div className="textInputs">
          <label>场上棋子<textarea value={units} onChange={(e) => setUnits(e.target.value)} /></label>
          <label>替补席<textarea value={bench} onChange={(e) => setBench(e.target.value)} placeholder="例：阿木木=1, 德莱文=1" /></label>
          <label>当前商店<textarea value={shop} onChange={(e) => setShop(e.target.value)} placeholder="最多5个英雄，用逗号分隔" /></label>
          <label>散件/成装<textarea value={items} onChange={(e) => setItems(e.target.value)} /></label>
          <label>已装备<textarea value={equipped} onChange={(e) => setEquipped(e.target.value)} placeholder="英雄:装备1/装备2；英雄:装备3" /></label>
          <label>强化符文<textarea value={augments} onChange={(e) => setAugments(e.target.value)} placeholder="例：永恒之森之徽, 经济类强化" /></label>
        </div>

        <div className="decisionToolbar">
          <button className="primaryButton" type="submit" disabled={loading}>{loading ? "计算中…" : "生成本回合决策"}</button>
          {lockedCompId && <button className="secondaryButton" type="button" onClick={() => setLockedCompId(null)}>解除阵容锁定</button>}
          {error && <span className="errorText">{error}</span>}
        </div>
      </form>

      {result && (
        <div className="decisionResults">
          <div className="engineMeta">ENGINE {result.engineVersion} · PATCH {result.patch} · {result.live ? "LIVE SNAPSHOT" : "FALLBACK"}</div>
          {result.result.map((rec, index) => (
            <article className={`decisionCard ${index === 0 ? "best" : ""}`} key={rec.comp.id}>
              <div className="decisionHead">
                <div>
                  <span className="candidate">候选 #{index + 1}</span>
                  <h3>{rec.comp.name}</h3>
                </div>
                <div className="decisionScore">{rec.fitScore}<small>契合</small></div>
              </div>

              <p className="nextStep"><strong>现在：</strong>{rec.nextStep}</p>
              <div className="actionGrid">
                {rec.actions.map((action, actionIndex) => (
                  <div className={`action ${action.priority}`} key={`${action.kind}-${actionIndex}`}>
                    <span>{kindLabel[action.kind] ?? action.kind}</span>
                    <p>{action.text}</p>
                    <small>{action.evidence.join(" · ")}</small>
                  </div>
                ))}
              </div>

              <div className="decisionEvidence">
                <div><b>为什么推荐</b>{rec.reasons.length ? rec.reasons.map((reason) => <p key={reason}>{reason}</p>) : <p>当前命中较少，主要作为Meta备选。</p>}</div>
                <div><b>装备落点</b>{rec.itemAdvice.map((advice) => <p key={advice}>{advice}</p>)}</div>
              </div>

              <button className="lockButton" type="button" onClick={() => setLockedCompId(rec.comp.id)}>
                {lockedCompId === rec.comp.id ? "已锁定这套阵容" : "锁定这套阵容，继续下一回合"}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
