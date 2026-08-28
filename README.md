# TFTGOLDENCHANCHAN

金铲铲之战（中国大陆服）实时阵容与对局决策助手。

## V0.2.1：真实数据 + 安全推荐层

V0.2.1 在 V0.2 真实数据流水线基础上完成了可审计的阵容 enrichment 与推荐放行链路：

- 自动识别/核验当前国服版本
- 抓取公开阵容统计并归一化为统一快照
- 版本一致性闸门：统计源版本与独立版本权威不一致时拒绝覆盖
- 安全回退：采集失败或版本不一致时保留上一份可信快照
- 历史快照：用于约 24 小时趋势和冷门阵容发现
- 当前阵容榜：平均名次、前四率、登顶率、出场率、原始样本量、趋势
- 冷门阵容雷达：优先发现低出场率但高表现/快速升温的阵容
- 结构化 DataJ 解析：优先读取公开 Next.js 序列化数据中的 `sampleCount / heroes / carries / traits / equips`
- 装备语义补全：从 DataJ `/equip` 公开数据建立 `equipId → 中文装备名` 字典，仅在装备 ID 100% 映射成功时写入 `keyItems / itemCarriers`
- 可审计运营节奏：当公开详情页没有稳定运营文本时，使用 `derived-economy-v1` 根据主C费用、目标星级及阵容费用结构生成阶段计划，并写入来源、置信度和证据
- 自动 enrichment 队列：只有无法满足结构、装备或阶段计划门禁的阵容才进入待补全队列
- 推荐安全隔离：未达到 `full` 的阵容不会进入局内自动推荐
- 样本量校验：优先使用 DataJ 源站 `sampleCount`；只有结构化数据不可用时才按出场率百分比估算，并按不同样本口径分别校验
- CI 门禁：校验装备必须是名称而非 ID、完整装备映射必须 `mapped === total`、derived stage plan 必须有来源/证据/置信度且只能晋升完整阵容

## 数据源与校验

当前使用多源架构，而不是把一个第三方站点当作唯一真相：

1. **官方/TapTap**：优先作为版本权威源。
2. **DataTFT / jcc**：验证中国大陆服高分段公开能力和检索器元数据。
3. **DataJ**：当前阵容统计、阵容结构、装备名称字典、站位/强化符文等公开数据入口。
4. **`data/patch-authority.json`**：独立核验后的版本安全锁。
5. **`data/rank-capability.json`**：记录已核验的国服公共段位能力，避免把通用前端枚举误报成真实国服分段覆盖。

当前版本安全锁为 `18.1b`。实时阵容快照只有在统计源版本与独立版本权威一致时才会被接受。

## 段位覆盖：V0.2.1 的明确边界

DataTFT 通用前端代码中存在铂金、翡翠、钻石、大师、宗师、王者等段位枚举，但**中国大陆服 jcc 公共界面当前将段位选择限制为“宗师及以上”**。

因此项目明确区分：

- `rankCoverage=["all"]`：当前真正写入阵容快照的数据仍为 DataJ 全段位汇总。
- `verifiedPublicRankBands=["grandmaster+"]`：已经核验 DataTFT 国服公共页面支持宗师及以上统计能力。
- `targetRankCoverage=false`：铂金+ / 翡翠+ / 钻石+ / 大师+尚没有找到可稳定公开使用的国服统计源。

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

DataJ `/equip` 用于建立公开装备名称字典。只有某套阵容的全部装备 ID 都成功映射后，系统才会把装备名称与携带者语义声明为 verified。

运营节奏与装备语义分开处理。DataJ 阵容详情页可以稳定提供阵容、站位、装备、强化符文与趋势，但没有稳定、可机器核验的“过渡/搜牌/升人口”文本字段。因此系统不会伪造源站攻略，而是使用：

```text
stagePlanSource = derived-economy-v1
stagePlanConfidence = high | medium
stagePlanEvidence = [carry, cost, targetStars, fiveCostUnits]
```

当前规则：

- 1/2/3 费主C且源数据明确目标三星：按对应低费搜牌层生成追三路线。
- 4 费主C且无高人口信号：8 人口作为主要成型层。
- 5 费主C、`95/九五` 阵容、或阵容中存在明显 5 费上限结构：按高人口路线处理。
- 无法解析主C费用、装备映射不完整或阵容结构不完整：继续留在 enrichment 队列，不自动放行。

三种状态：

- `full`：本地人工可信知识已补齐，或公开结构化阵容 + 100%装备映射 + 可审计阶段规则全部通过，可进入实战推荐候选。
- `partial`：已取得部分公开结构化语义，但尚未满足完整推荐门禁。
- `pending`：连稳定阵容结构都尚未取得。

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
装备 ID → 名称完整映射
   ↓
人工 stagePlan 或 derived-economy-v1 阶段计划
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

未达到 `full` enrichment 的阵容不会进入这一接口的候选集。由 `derived-economy-v1` 放行的阵容会在结果中保留阶段计划来源与证据，不冒充人工攻略。

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

## V0.2.1 收口与下一阶段

V0.2.1 的真实数据、安全刷新、结构化阵容、装备名称、可审计运营节奏、推荐隔离与 CI 门禁已形成闭环。

唯一保留的外部数据边界是：目前没有发现无需绕过访问控制、可稳定公开使用的国服铂金+ → 大师+精确统计源。因此继续保留“全段位统计 + 宗师及以上公共能力验证”，而不是制造不存在的精确分段。

下一阶段进入 **V0.3**：加入商店来牌、装备、强化符文和经济状态输入，增强实时留牌、转阵、D牌与升人口建议，并为后续 Windows 悬浮助手准备输入层。
