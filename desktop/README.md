# TFTGOLDENCHANCHAN Overlay V0.4.1

Windows 桌面悬浮助手，基于 Tauri 2 + Vite。

## V0.4.1 实战录入强化

- 固定 5 格商店：点击格子后直接点选英雄
- 英雄快速选择器：场上 / 替补席一键添加，已选英雄可直接 `+ / -` 张数
- 装备快速选择器：从当前可信快照的已核验装备名称中点选
- 阵容完成度：Top 3 候选显示当前核心英雄 + 核心装备完成度（0–100）
- 强化符文结构化评分：羁绊定向、战力、经济、通用四类信号进入评分（0–100）
- 同行侦察：每套候选可直接 `+ / -` 记录同行数，并实时进入阵容排序与转阵建议
- 下一回合：自动推进阶段、清空 5 格商店，保留场上 / 替补 / 装备 / 强化 / 锁阵 / 同行状态并立即开始下一轮录入
- 文本输入仍保留作为备用，不强制只能点选

英雄选择器当前使用**本地字形头像 fallback + 费用标识**，不依赖第三方图片 CDN；这样断网时仍可完整操作。后续如果接入可审计、稳定的英雄图像资源，可在不改变决策逻辑的情况下替换视觉层。

## 设计目标

- Always-on-top 悬浮窗
- Alt+Q：全局显示 / 隐藏
- Alt+W：全局切换鼠标穿透
- Alt+E：全局切换紧凑 / 展开
- 直接复用仓库 `lib/recommender.ts` 与 `lib/game-state.ts`
- 启动时读取 GitHub `main/data/latest.json` 的最新可信快照
- 网络失败时使用打包时内置快照继续决策
- 不读取游戏进程内存、不注入客户端、不模拟点击或自动操作游戏

## 本地开发

```bash
cd desktop
npm install
npm run tauri:dev
```

## Windows Portable 构建

```bash
cd desktop
npm install
npm run build:portable
```

生成文件：

```text
desktop/src-tauri/target/release/tftgoldenchanchan-overlay.exe
```

GitHub Actions 的 `Desktop CI` 会在 Windows runner 上完成 TypeScript/Vite、Rust 与 portable exe 构建，并上传 `TFTGOLDENCHANCHAN-Windows-portable` artifact。

## 数据更新

桌面端只从本仓库公开的、已经通过 V0.2.1 版本闸门和数据校验的 `data/latest.json` 获取最新快照。不会从未知接口直接绕过第三方站点访问控制。
