# TFTGOLDENCHANCHAN

金铲铲之战（中国大陆服）实时阵容与对局决策助手。

## V0.4.2：视觉化输入 + 回合历史

V0.4.2 在 V0.4.1 快速录入基础上继续降低实战操作成本：

- DataJ `/equip` 公开结构化数据 → 腾讯 `game.gtimg.cn` 真实英雄头像
- DataJ `/equip` 公开结构化数据 → 真实装备图标
- 图片不可用时自动回退字形头像/装备字形，不影响离线决策
- Tauri CSP 仅允许腾讯图片域名，不开放任意图片源
- 点击“下一回合”前自动保存本局历史点，最多 20 个
- `Ctrl+Z` / “撤销”恢复上一回合前的表单、锁阵和同行记录
- “新开一局”二次确认后清空本局状态
- 强化符文支持最近使用的可视化点选，同时保留手工输入
- DataJ `/augment` 当前返回 404，因此项目明确不伪造“全量强化目录”

桌面增强逻辑继续复用同一份 `lib/recommender.ts` / `lib/game-state.ts`，没有第二套推荐算法。

## V0.4.1：快速实战录入

- 固定 5 格商店点选
- 场上/替补英雄点选与 `+/-` 张数
- 装备点选
- Top 3 阵容完成度
- 强化符文结构化评分
- 同行计数直接进入 Fit Score 与转阵建议
- 一键下一回合，保留持续状态

## V0.4：Windows 桌面悬浮助手

- Always-on-top 半透明无边框窗口
- `Alt+Q`：全局显示 / 隐藏
- `Alt+W`：全局鼠标穿透开关
- `Alt+E`：全局紧凑 / 展开模式
- Windows 程序不要求额外启动 Next.js 服务
- 打包内置可信 `data/latest.json`；联网时读取 `main/data/latest.json`
- 网络异常时使用内置快照继续决策

### 安全边界

- 不读取游戏进程内存
- 不 DLL 注入
- 不修改游戏客户端
- 不模拟点击或自动操作游戏
- 不自动替玩家执行购买、D牌或站位

它是独立的决策辅助窗口，不是游戏自动化工具。

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

支持阶段 / 人口 / 金币 / 血量 / 连胜连败 / 场上棋子 / 替补席 / 当前商店 / 装备 / 强化符文 / 锁阵。

决策动作：`buy` / `keep` / `sell` / `roll` / `level` / `pivot` / `item`，每项均带 `evidence`。

## V0.2.1：真实数据 + 安全推荐层

已完成：

- 国服当前版本核验
- 多源版本一致性闸门
- DataJ 公开结构化阵容解析
- 原始 `sampleCount`
- 核心/功能英雄、Carry、羁绊
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

当前 DataJ 为全段位汇总；尚未找到无需绕过访问控制、可稳定使用的国服铂金+ / 翡翠+ / 钻石+ / 大师+精确统计入口。

## Web API

- `GET /api/meta`
- `GET /api/status`
- `POST /api/recommend`

网页与桌面端共享核心推荐逻辑。

## 技术栈

- Web：Next.js 15.5.x / React 19.2.x / TypeScript / Cheerio 1.2.x
- Desktop：Tauri 2 / Rust / Vite / TypeScript
- Data / CI：GitHub Actions + 纯函数 Meta / Discovery / Fit / Round Decision 引擎

## 自动数据刷新

GitHub Actions 每天 6 次：UTC 00:05 / 04:05 / 08:05 / 12:05 / 16:05 / 20:05。

## 当前里程碑

- V0.1：基础 Meta / 推荐骨架 ✅
- V0.2：真实国服数据流水线 ✅
- V0.2.1：结构化阵容、装备语义、自动 enrichment、安全推荐 ✅
- V0.3：实战输入、跨回合锁阵、动作决策 ✅
- V0.4：Windows 独立悬浮助手、全局快捷键、portable 构建 ✅
- V0.4.1：5格商店、快速点选、同行与完成度 ✅
- **V0.4.2：真实图标、回合历史、强化最近使用 🚧**
