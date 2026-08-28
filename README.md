# TFTGOLDENCHANCHAN

金铲铲之战（中国大陆服）实时阵容与对局决策助手。

## V0.4：Windows 桌面悬浮助手

V0.4 在 V0.3 实战决策引擎之上增加独立 Windows Overlay。桌面端不复制另一套算法，而是直接复用仓库中的：

- `lib/game-state.ts`
- `lib/recommender.ts`
- `lib/scoring.ts`
- `lib/types.ts`

因此网页和桌面端使用同一套输入归一化、阵容评分、买/留/卖/D牌/升人口/转阵/装备逻辑。

### 桌面端能力

- Always-on-top 悬浮窗
- 半透明无边框窗口
- `Alt+Q`：全局显示 / 隐藏
- `Alt+W`：全局鼠标穿透开关
- `Alt+E`：全局紧凑 / 展开模式
- 当前回合输入：阶段、人口、金币、血量、连胜/连败、场上棋子、替补席、商店、装备、强化符文
- Top 3 实时阵容候选
- 锁阵后跨回合持续决策
- 每条建议继续输出证据，而不是黑箱结果

### 独立运行与数据更新

Windows 程序不要求额外启动 Next.js 服务。

1. 打包时内置当前已经通过 V0.2.1 数据门禁的 `data/latest.json`；
2. 启动后从本仓库 `main/data/latest.json` 获取最新可信快照；
3. GitHub 数据刷新仍按每天 6 次运行；
4. 网络异常时自动回退到程序内置快照，决策引擎仍可继续运行。

桌面端只消费本项目已经经过版本一致性校验的数据，不直接绕过第三方站点访问控制。

### 安全边界

V0.4 仍坚持：

- 不读取游戏进程内存
- 不 DLL 注入
- 不修改游戏客户端
- 不模拟点击或自动操作游戏
- 不自动替玩家执行购买、D牌或站位

它是独立的决策辅助窗口，而不是游戏自动化工具。

## Windows 开发 / 构建

```bash
cd desktop
npm install
npm run tauri:dev
```

Portable Windows 构建：

```bash
cd desktop
npm run build:portable
```

输出：

```text
desktop/src-tauri/target/release/tftgoldenchanchan-overlay.exe
```

`.github/workflows/desktop-ci.yml` 会在真实 `windows-latest` runner 上执行：

1. npm dependency audit
2. TypeScript + Vite build
3. Rust `cargo check`
4. Tauri portable `.exe` 编译
5. 上传 `TFTGOLDENCHANCHAN-Windows-portable` artifact

详细桌面说明见 `desktop/README.md`。

---

## V0.3：实战输入 + 回合决策层

V0.3 已支持：

- 阶段 / 人口 / 金币 / 血量 / 连胜连败
- 场上棋子 / 替补席 / 当前商店
- 散件 / 成装 / 已装备英雄
- 强化符文
- 锁定阵容并继续下一回合

决策动作：

- `buy`
- `keep`
- `sell`
- `roll`
- `level`
- `pivot`
- `item`

每项动作均带 `evidence`。

## V0.2.1：真实数据 + 安全推荐层

已完成：

- 国服当前版本核验
- 多源版本一致性闸门
- DataJ 公开结构化阵容解析
- 原始 `sampleCount`
- 核心 / 功能英雄、Carry、羁绊
- 装备 ID → 中文名称完整映射门禁
- `derived-economy-v1` 可审计运营节奏
- 自动 enrichment
- 历史快照 / 24H 趋势 / 冷门阵容雷达
- CI 数据门禁

### 当前段位数据边界

```text
rankCoverage=["all"]
verifiedPublicRankBands=["grandmaster+"]
targetRankCoverage=false
```

当前 DataJ 为全段位汇总；已核验 DataTFT 国服公共页面存在“宗师及以上”能力，但仍没有找到无需绕过访问控制、可以稳定使用的国服铂金+ / 翡翠+ / 钻石+ / 大师+精确统计入口。

## Web API

- `GET /api/meta`
- `GET /api/status`
- `POST /api/recommend`

网页与桌面端共享核心推荐逻辑。

## 技术栈

### Web

- Next.js 15.5.x
- React 19.2.x
- TypeScript
- Cheerio 1.2.x

### Desktop

- Tauri 2
- Rust
- Vite
- TypeScript

### Data / CI

- GitHub Actions
- 纯函数 Meta / Discovery / Fit / Round Decision 引擎

## 自动数据刷新

GitHub Actions 每天 6 次：

```text
UTC 00:05 / 04:05 / 08:05 / 12:05 / 16:05 / 20:05
```

北京时间约：

```text
08:05 / 12:05 / 16:05 / 20:05 / 00:05 / 04:05
```

## 当前里程碑

- V0.1：基础 Meta / 推荐骨架 ✅
- V0.2：真实国服数据流水线 ✅
- V0.2.1：结构化阵容、装备语义、自动 enrichment、安全推荐 ✅
- V0.3：实战输入、跨回合锁阵、动作决策 ✅
- **V0.4：Windows 独立悬浮助手、全局快捷键、portable 构建 🚧**
