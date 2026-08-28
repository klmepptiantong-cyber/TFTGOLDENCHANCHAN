# TFTGOLDENCHANCHAN Overlay V0.4

Windows 桌面悬浮助手，基于 Tauri 2 + Vite。

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
