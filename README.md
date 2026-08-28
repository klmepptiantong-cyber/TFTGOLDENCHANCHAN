# TFTGOLDENCHANCHAN

金铲铲之战（中国大陆服）实时阵容与对局决策助手。

## V0.2.1：真实数据 + 安全推荐层

V0.2.1 在 V0.2 真实数据流水线基础上继续强化数据可信度和实战安全：

- 自动识别/核验当前国服版本
- 抓取公开阵容统计并归一化为统一快照
- 版本一致性闸门：统计源版本与独立版本权威不一致时拒绝覆盖
- 安全回退：采集失败或版本不一致时保留上一份可信快照
- 历史快照：用于约 24 小时趋势和冷门阵容发现
- 当前阵容榜：平均名次、前四率、登顶率、出场率、原始样本量、趋势
- 冷门阵容雷达：优先发现低出场率但高表现/快速升温的阵容
- 结构化 DataJ 解析：优先读取公开 Next.js 序列化数据中的 `sampleCount / heroes / carries / traits / equips`
- 自动 enrichment 队列：实时发现的新阵容自动进入待补全队列，并记录首次发现、最近出现、优先级和缺失字段
- 部分自动补全：新阵容可自动核验核心英雄、完整阵容、Carry、羁绊与装备 ID；未核验字段继续保持 `partial`
- 推荐安全隔离：`needsEnrichment=true`、无完整可信运营/装备语义的阵容不会进入局内自动推荐
- 样本量校验：优先使用 DataJ 源站 `sampleCount`；只有结构化数据不可用时才按出场率百分比估算，并按不同样本口径分别校验

## 数据源与校验

当前使用多源架构，而不是把一个第三方站点当作唯一真相：

1. **官方/TapTap**：优先作为版本权威源。
2. **DataTFT / jcc**：验证中国大陆服高分段公开能力和检索器元数据。
3. **DataJ**：当前阵容统计与阵容结构适配器，公开页面可提供表现数据、原始样本数、阵容英雄、Carry、羁绊及装备 ID。
4. **`data/patch-authority.json`**：独立核验后的版本安全锁。
5. **`data/rank-capability.json`**：记录已核验的国服公共段位能力，避免把通用前端枚举误报成真实国服分段覆盖。

当前版本安全锁为 `18.1b`。实时阵容快照只有在统计源版本与独立版本权威一致时才会被接受。

## 段位覆盖：V0.2.1 的明确边界

DataTFT 通用前端代码中存在铂金、翡翠、钻石、大师、宗师、王者等段位枚举，但**中国大陆服 jcc 公共界面当前将段位选择限制为“宗师及以上”**。

因此项目现在明确区分：

- `rankCoverage=["all"]`：当前真正写入阵容快照的数据仍为 DataJ 全段位汇总。
- `verifiedPublicRankBands=["grandmaster+"]`：已经核验 DataTFT 国服公共页面支持宗师及以上统计能力。
- `targetRankCoverage=false`：用户目标中的铂金+ / 翡翠+ / 钻石+ / 大师+尚没有找到可稳定公开使用的国服统计源。

项目不会把通用前端的段位枚举伪装成国服已经开放的数据，也不会为了取数绕过第三方站点的访问控制。

> “宗师及以上”属于累计段位口径，不代表独立的“宗师段”样本。后续任何分段统计也会明确标注口径，避免将累计区间误当成互斥区间。

## 结构化样本与自动 enrichment

DataJ `/comp` 公开页面的 Next.js 序列化数据是 V0.2.1 的主要结构化入口。适配器优先读取：

```text
compId
sampleCount
heroes / isCore / isCarry / isSubCarry
traits
equips
```

因此阵容样本量现在优先采用源站 `sampleCount`，不再把“总局数 × 出场率”作为主样本口径。只有结构化数据临时失效时，文本解析器才会回退到百分比估算。

新出现的实时阵容如果本地知识库还没有完整装备名称和运营信息，会自动进入：

```text
data/enrichment-queue.json
```

队列按出场率、前四率、登顶率与趋势计算优先级，并保留：

```text
firstSeenAt
lastSeenAt
priority
verifiedFields
metrics
missing
```

当前自动 enrichment 有三种状态：

- `full`：本地可信知识已补齐，可进入实战推荐候选。
- `partial`：公开结构化数据已核验阵容英雄 / Carry / 羁绊 / 装备 ID，但装备名称映射、装备携带者语义或运营节奏仍缺失。
- `pending`：连稳定阵容结构都尚未取得。

`partial` 与 `pending` 均继续保持 `needsEnrichment=true`，可以出现在 Meta / 冷门雷达中，但不会进入 `/api/recommend` 的局内自动推荐。

## 自动刷新

GitHub Actions 每天刷新 6 次（UTC `00:05 / 04:05 / 08:05 / 12:05 / 16:05 / 20:05`，北京时间约 `08:05 / 12:05 / 16:05 / 20:05 / 00:05 / 04:05`）。

刷新流程：

```text
版本权威核验
   ↓
公开统计 + 结构化阵容采集
   ↓
版本一致性校验
   ↓
归一化 + 分口径样本完整性校验
   ↓
自动补全已核验阵容结构
   ↓
生成 / 更新 enrichment 队列
   ↓
更新 latest.json / comps.json
   ↓
保存 history 快照
   ↓
Meta / Discovery / Recommendation 使用可信数据
```

同一分支的刷新任务采用并发锁，并在 push 前 rebase，避免定时任务和人工提交同时发生时出现 non-fast-forward 冲突。

## API

### `GET /api/meta`

返回当前已验证快照、阵容排名所需统计，以及 `metaScore` / `discoveryScore`。

### `GET /api/status`

返回当前版本权威、各数据源健康状态、是否接受本轮实时数据、实际段位覆盖和已验证公共段位能力。

### `POST /api/recommend`

输入阶段、人口、金币、血量、已有英雄和装备，返回最适配阵容、Meta/Fit/Discovery/Confidence 分数、留牌/卖牌、推荐原因和下一阶段操作建议。

未达到 `full` enrichment 的阵容不会进入这一接口的候选集。

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
app/                       Next.js 页面与 API
lib/                       类型、评分、推荐核心逻辑
data/latest.json           最新可信快照
data/comps.json            当前阵容数据
data/source-status.json    数据源健康状态
data/enrichment-queue.json 自动 enrichment 队列
data/rank-capability.json  已核验国服公共段位能力
data/patch-authority.json  独立版本安全锁
data/history/              历史快照
scripts/sources/            数据源适配器
scripts/refresh-data.mjs    采集/校验/归一化主流程
.github/workflows/          CI、自动刷新与诊断探针
```

## 重要原则

本项目定位为独立的数据分析/决策辅助工具：不注入游戏客户端、不读取游戏进程内存、不自动操作游戏。后续若增加屏幕识别，仅采用用户主动开启的截图/OCR方案，并单独评估合规性。

## 下一阶段

V0.2.1 剩余工作集中在两项：

1. 寻找无需绕过访问控制、可稳定公开使用的国服铂金+ → 大师+统计源；若始终不存在，则保留“全段位 + 宗师+验证层”，而不是制造不存在的精确分段。
2. 为 `partial` 阵容建立可信的装备 ID→装备名称映射，并从公开资料补齐 `keyItems / itemCarriers / stagePlan`，达到条件后自动晋升为 `full`。

完成后进入 V0.3：商店来牌、装备、强化符文和经济状态输入，以及实时留牌、转阵、D牌和升人口建议。
