# TFTGOLDENCHANCHAN Overlay V0.4.2

Windows 桌面悬浮助手，基于 Tauri 2 + Vite。

## V0.4.2 视觉与对局连续性

- 真实英雄头像：DataJ `/equip` 的公开结构化数据返回英雄 `picture`，源地址来自腾讯 `game.gtimg.cn`
- 真实装备图标：同一公开结构化数据返回装备 `picture`
- 图片不可用时自动回退 V0.4.1 字形头像 / 装备字形，不影响录入和决策
- CSP 仅新增允许 `https://game.gtimg.cn` 图片，不开放任意远程资源
- 回合历史：点击“下一回合”前自动保存当前本局状态，最多保留 20 个历史点
- 撤销回合：恢复表单、锁阵、同行记录并重新载入一致状态；支持 `Ctrl+Z`（输入框聚焦时不会抢占文本撤销）
- 新开一局：二次点击确认后清空本局表单、锁阵、同行和历史；最近使用强化保留
- 强化符文：提供最近使用可视化点选，并继续保留手工文本输入
- DataJ 当前没有稳定公开的全量强化目录：`/augment` 返回 404，因此 V0.4.2 不伪造“全量强化数据库”

## V0.4.1 实战录入强化

- 固定 5 格商店：点击格子后直接点选英雄
- 英雄快速选择器：场上 / 替补席一键添加，已选英雄可直接 `+ / -` 张数
- 装备快速选择器：从当前可信快照的已核验装备名称中点选
- 阵容完成度：Top 3 候选显示当前核心英雄 + 核心装备完成度（0–100）
- 强化符文结构化评分：羁绊定向、战力、经济、通用四类信号进入评分（0–100）
- 同行侦察：每套候选可直接 `+ / -` 记录同行数，并实时进入阵容排序与转阵建议
- 下一回合：自动推进阶段、清空 5 格商店，保留场上 / 替补 / 装备 / 强化 / 锁阵 / 同行状态
- 文本输入仍保留作为备用，不强制只能点选

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

桌面端只从本仓库公开的、已经通过 V0.2.1 版本闸门和数据校验的 `data/latest.json` 获取最新快照。视觉图片 URL 同样来自 DataJ 已公开的结构化字段，并限制到腾讯图片域名。不会从未知接口绕过第三方站点访问控制。
