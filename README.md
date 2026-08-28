# TFTGOLDENCHANCHAN

金铲铲之战（中国大陆服）实时阵容与对局决策助手。

## V0.2：真实数据层

V0.2 已从示例快照升级为真实数据流水线：

- 自动识别/核验当前国服版本
- 抓取公开阵容统计并归一化为统一快照
- 版本一致性闸门：统计源版本与独立版本权威不一致时拒绝覆盖
- 安全回退：采集失败或版本不一致时保留上一份可信快照
- 历史快照：用于约 24 小时趋势和冷门阵容发现
- 当前阵容榜：平均名次、前四率、登顶率、出场率、样本估算、趋势
- 冷门阵容雷达：优先发现低出场率但高表现/快速升温的阵容
- 对局推荐：根据阶段、人口、金币、血量、来牌和装备输出最适配阵容
- 新阵容隔离：实时数据中新出现但尚未补齐核心牌/装备/运营信息的阵容会标记 `needsEnrichment`，可进入 Meta/冷门榜，但暂不进入局内自动推荐

## 数据源与校验

当前 V0.2 使用多源架构，而不是把一个第三方站点当作唯一真相：

1. **官方/TapTap**：优先作为版本权威源。
2. **DataTFT**：验证当前版本及公开页面的段位筛选能力；不猜测未公开的内部接口。
3. **DataJ**：当前阵容统计适配器，提供公开阵容表现数据。
4. **`data/patch-authority.json`**：独立核验后的版本安全锁。当在线权威源临时不可解析时，统计数据仍必须与安全锁一致才可写入。

当前已成功跑通 `18.1b` 的真实阵容快照，包括 7野怪鸡哥、赌蛇女、巨龙95、永森95 等公开统计阵容。

> 注意：当前 DataJ 适配器是**全段位汇总**。DataTFT 已验证存在段位筛选，但在找到稳定、可公开使用的分段统计端点之前，项目不会伪造“铂金/翡翠/钻石/大师”精确数据。`targetRankCoverage=false` 会明确暴露这一限制。

## 自动刷新

GitHub Actions 每天刷新 6 次（UTC `00:05 / 04:05 / 08:05 / 12:05 / 16:05 / 20:05`，北京时间约 `08:05 / 12:05 / 16:05 / 20:05 / 00:05 / 04:05`）。

刷新流程：

```text
版本权威核验
   ↓
公开统计采集
   ↓
版本一致性校验
   ↓
归一化 + 数据完整性校验
   ↓
更新 latest.json / comps.json
   ↓
保存 history 快照
   ↓
Meta / Discovery / Recommendation 使用新数据
```

同一分支的刷新任务采用并发锁，并在 push 前 rebase，避免定时任务和人工提交同时发生时出现 non-fast-forward 冲突。

## API

### `GET /api/meta`

返回当前已验证快照、阵容排名所需统计，以及 `metaScore` / `discoveryScore`。

### `GET /api/status`

返回当前版本权威、各数据源健康状态、是否接受本轮实时数据、当前段位覆盖能力。

### `POST /api/recommend`

示例：

```json
{
  "stage": "3-2",
  "level": 6,
  "gold": 42,
  "hp": 78,
  "units": {
    "蛇女": 2,
    "稻草人": 2,
    "洛": 2
  },
  "items": ["眼泪", "青龙刀", "狂徒"],
  "rankBand": "platinum"
}
```

返回最适配阵容、Meta/Fit/Discovery/Confidence 分数、留牌/卖牌、推荐原因和下一阶段操作建议。

## 技术栈

- Next.js 15.5.x + TypeScript
- React 19.2.x
- Cheerio 1.2.x
- GitHub Actions
- 纯函数评分/推荐引擎，后续可复用到 Tauri Windows 悬浮助手

## 本地运行

```bash
npm install
npm run check:data
npm run dev
```

打开 `http://localhost:3000`。

手动刷新真实数据：

```bash
npm run refresh:data
npm run check:data
```

## 目录

```text
app/                     Next.js 页面与 API
lib/                     类型、评分、推荐核心逻辑
data/latest.json         最新可信快照
data/comps.json          当前阵容数据
data/source-status.json  数据源健康状态
data/patch-authority.json 独立版本安全锁
data/history/            历史快照
scripts/sources/          数据源适配器
scripts/refresh-data.mjs  采集/校验/归一化主流程
.github/workflows/        CI 与自动刷新
```

## 重要原则

本项目定位为独立的数据分析/决策辅助工具：不注入游戏客户端、不读取游戏进程内存、不自动操作游戏。后续若增加屏幕识别，仅采用用户主动开启的截图/OCR方案，并单独评估合规性。

## 下一阶段

V0.2.1 的首要目标是寻找并核验**可稳定公开使用的铂金 → 大师分段统计源**，之后再进入 V0.3 的对局交互界面：商店来牌点选、装备/强化输入、实时留牌/转阵/D牌/升人口建议。
