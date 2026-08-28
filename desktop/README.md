# TFTGOLDENCHANCHAN Overlay V0.6

Windows 桌面悬浮助手，基于 Tauri 2 + Vite。

## V0.6.0 Auto Vision Foundation

- Windows 原生窗口枚举 + `xcap` / Windows Graphics Capture（WGC）窗口抓帧
- Overlay 启动后默认低频持续捕获，优先自动匹配“金铲铲 / JCC / 常见安卓模拟器”窗口
- 自动匹配失败时保留一次性手动选择窗口的 fallback；选择结果会持久化
- 捕获帧通过本地 Tauri IPC 返回，前端发出 `tft-vision-frame` 事件，供 OCR / 英雄模板识别继续消费
- 当前捕获频率约 1 FPS，避免为了决策辅助无意义占用 60 FPS
- 视觉帧只来自玩家屏幕已显示内容；不读取游戏进程内存、不注入、不抓取/解密客户端网络协议
- `lib/vision.ts` 提供多帧置信度 + 时间衰减融合，避免单帧 OCR 误识别直接污染状态
- `lib/pool.ts` 提供自己/对手持牌、同行压力、淘汰返池和识别置信度衰减模型
- `lib/ev.ts` 提供当前相对路线 EV；未核准规则下明确禁止伪精确 Top1 / Top4 / D牌命中概率
- `rules/S18/18.1b.json` 为版本化规则入口；当前 S18 公开卡池资料存在冲突，因此标记 `provisional / precisionUse=blocked`
- CI 新增 `check:rules` 门禁：只有规则状态为 `verified` 且存在完整商店概率时才允许开启精确概率模式

### 当前 V0.6 状态

- Capture / Window Tracking：✅
- Temporal Vision Fusion：✅
- Pool Pressure Engine：✅
- Relative EV Guardrail：✅
- OCR（阶段/金币/HP/人口）：下一步
- 商店5格英雄识别：下一步
- 场上/备战席/装备识别：下一步
- 对手数据库自动重建：后续 V0.6.x
- 精确 Top1 / Top4 / Expected Placement：等待规则核验 + 视觉状态输入

## V0.5 整局动态运营

- 直接读取 V0.4.2 已保存的本局历史状态，最近最多回放 7 个状态点
- 每个历史点重新使用同一份 `lib/recommender.ts` 计算，不建立第二套阵容推荐器
- 共享 `lib/trajectory.ts` 分析 HP / 金币 / 人口 / Fit / 完成度 / 同行压力趋势
- 宏观决策：止血、止损转阵、追三星、提人口、冲9、继续收束、恢复经济
- 锁阵止损会追踪锁定阵容自身的连续 Fit / 完成度，而不是只看当前最佳方向
- 低费追三窗口结合主C费用、阵容“赌/追三”语义、已持有张数、血量、经济和同行判断
- 时间轴展示最近状态点的阶段、Fit、完成度、HP 和金币
- 所有宏观结论均显示证据和置信度

## V0.4.3 一眼决策与风险控制

- 当前 Top1 阵容、Fit 和完成度
- 阵容核心牌 / 核心装备 / 人口缺口
- 5 格商店按必拿 / 建议拿 / 转阵保留 / 可跳过排序
- 买入掉利息提醒
- 锁阵转阵风险
- 装备终局持有者冲突
- Top3 同行压力

## V0.4.2 视觉与对局连续性

- 真实英雄头像：DataJ `/equip` 的公开结构化数据返回英雄 `picture`，源地址来自腾讯 `game.gtimg.cn`
- 真实装备图标：同一公开结构化数据返回装备 `picture`
- 图片不可用时自动回退字形头像 / 装备字形，不影响录入和决策
- CSP 仅允许 `https://game.gtimg.cn` 图片，不开放任意远程资源
- 回合历史：点击“下一回合”前自动保存当前本局状态，最多保留 20 个历史点
- 撤销回合：恢复表单、锁阵、同行记录并重新载入一致状态；支持 `Ctrl+Z`
- 新开一局：二次点击确认后清空本局表单、锁阵、同行和历史；最近使用强化保留
- 强化符文：提供最近使用可视化点选，并继续保留手工文本输入
- DataJ 当前没有稳定公开的全量强化目录，因此不伪造“全量强化数据库”

## V0.4.1 实战录入强化

- 固定 5 格商店：点击格子后直接点选英雄
- 英雄快速选择器：场上 / 替补席一键添加，已选英雄可直接 `+ / -` 张数
- 装备快速选择器：从当前可信快照的已核验装备名称中点选
- 阵容完成度：Top 3 候选显示当前核心英雄 + 核心装备完成度（0–100）
- 强化符文结构化评分
- 同行侦察直接进入阵容排序与转阵建议
- 下一回合自动推进阶段、清空商店并保留持续状态
- 文本输入继续保留作为备用

## 设计目标

- Always-on-top 悬浮窗
- Alt+Q：全局显示 / 隐藏
- Alt+W：全局切换鼠标穿透
- Alt+E：全局切换紧凑 / 展开
- Ctrl+Z：撤销上一回合历史点
- 直接复用仓库 `lib/recommender.ts` / `lib/game-state.ts` / `lib/trajectory.ts`
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