import "./v060.css";
import { activeRules, ruleStatusLabel } from "../../lib/rules";

type VisionTauriGlobal = {
  core?: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
};

type CaptureWindowInfo = {
  id: string;
  title: string;
  app_name: string;
  width: number;
  height: number;
  focused: boolean;
};

type CaptureFrame = {
  window_id: string;
  title: string;
  width: number;
  height: number;
  captured_at_ms: number;
  data_url: string;
};

declare global {
  interface Window {
    __TFT_LATEST_VISION_FRAME__?: CaptureFrame;
  }
}

const WINDOW_KEY = "tftgolden.vision.window.v060";
const ENABLED_KEY = "tftgolden.vision.enabled.v060";
const POLL_MS = 1000;
const WINDOW_REFRESH_MS = 6000;

let windows: CaptureWindowInfo[] = [];
let selectedWindowId = localStorage.getItem(WINDOW_KEY) ?? "";
let running = localStorage.getItem(ENABLED_KEY) !== "false";
let captureBusy = false;
let lastCaptureAt = 0;
let captureCount = 0;
let windowRefreshTimer = 0;
let captureTimer = 0;

function tauriGlobal(): VisionTauriGlobal | undefined {
  return (window as Window & { __TAURI__?: VisionTauriGlobal }).__TAURI__;
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const fn = tauriGlobal()?.core?.invoke;
  if (!fn) return Promise.reject(new Error("tauri_unavailable"));
  return fn<T>(command, args);
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function candidateScore(item: CaptureWindowInfo): number {
  const haystack = `${item.title} ${item.app_name}`.toLowerCase();
  if (/golden chanchan|tftgoldenchanchan/.test(haystack)) return -1000;
  let score = item.focused ? 20 : 0;
  if (/金铲铲/.test(haystack)) score += 120;
  if (/jcc|battle of golden spatula/.test(haystack)) score += 80;
  if (/mumu|雷电|ldplayer|bluestacks|腾讯手游助手|gameloop|模拟器/.test(haystack)) score += 36;
  if (item.width >= 900 && item.height >= 600) score += 8;
  return score;
}

function autoSelectWindow() {
  if (selectedWindowId && windows.some((item) => item.id === selectedWindowId)) return;
  const savedTitle = localStorage.getItem(`${WINDOW_KEY}.title`) ?? "";
  if (savedTitle) {
    const titleMatch = windows.find((item) => item.title === savedTitle);
    if (titleMatch) {
      selectedWindowId = titleMatch.id;
      return;
    }
  }
  const ranked = [...windows].sort((a, b) => candidateScore(b) - candidateScore(a));
  if (ranked[0] && candidateScore(ranked[0]) > 20) selectedWindowId = ranked[0].id;
}

function renderWindowOptions() {
  const select = byId<HTMLSelectElement>("vision-window-select");
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = windows.length ? "选择游戏窗口…" : "未发现可捕获窗口";
  select.append(placeholder);
  for (const item of windows) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.focused ? "● " : ""}${item.title} · ${item.width}×${item.height}`;
    option.selected = item.id === selectedWindowId;
    select.append(option);
  }
}

function setStatus(text: string, kind: "ok" | "warn" | "error" = "warn") {
  const status = byId<HTMLElement>("vision-status");
  if (!status) return;
  status.textContent = text;
  status.dataset.kind = kind;
}

async function refreshWindows() {
  try {
    windows = await invoke<CaptureWindowInfo[]>("list_capture_windows");
    autoSelectWindow();
    renderWindowOptions();
    if (selectedWindowId) {
      const selected = windows.find((item) => item.id === selectedWindowId);
      if (selected) {
        localStorage.setItem(WINDOW_KEY, selected.id);
        localStorage.setItem(`${WINDOW_KEY}.title`, selected.title);
      }
    }
    if (!windows.length) setStatus("未发现可捕获窗口", "warn");
    else if (!selectedWindowId) setStatus("请选择金铲铲或模拟器窗口", "warn");
  } catch (error) {
    setStatus(`窗口枚举失败：${String(error)}`, "error");
  }
}

async function captureOnce() {
  if (!running || captureBusy || !selectedWindowId) return;
  captureBusy = true;
  try {
    const frame = await invoke<CaptureFrame>("capture_window_frame", {
      windowId: selectedWindowId,
      previewWidth: 960
    });
    window.__TFT_LATEST_VISION_FRAME__ = frame;
    captureCount += 1;
    const now = Date.now();
    const delta = lastCaptureAt ? now - lastCaptureAt : 0;
    lastCaptureAt = now;

    const preview = byId<HTMLImageElement>("vision-preview");
    if (preview) {
      preview.src = frame.data_url;
      preview.alt = `实时捕获：${frame.title}`;
    }
    const meta = byId<HTMLElement>("vision-frame-meta");
    if (meta) meta.textContent = `${frame.width}×${frame.height} · frame ${captureCount}${delta ? ` · ${(1000 / delta).toFixed(1)} FPS` : ""}`;
    setStatus(`AUTO CAPTURE · ${frame.title}`, "ok");
    window.dispatchEvent(new CustomEvent<CaptureFrame>("tft-vision-frame", { detail: frame }));
  } catch (error) {
    const message = String(error);
    if (/not_found|minimized/.test(message)) {
      selectedWindowId = "";
      localStorage.removeItem(WINDOW_KEY);
      await refreshWindows();
    }
    setStatus(`抓帧失败：${message}`, "error");
  } finally {
    captureBusy = false;
  }
}

function scheduleCapture() {
  window.clearTimeout(captureTimer);
  const tick = async () => {
    await captureOnce();
    captureTimer = window.setTimeout(tick, POLL_MS);
  };
  captureTimer = window.setTimeout(tick, 120);
}

function scheduleWindowRefresh() {
  window.clearInterval(windowRefreshTimer);
  windowRefreshTimer = window.setInterval(() => void refreshWindows(), WINDOW_REFRESH_MS);
}

function renderRunningState() {
  const toggle = byId<HTMLButtonElement>("vision-toggle");
  if (toggle) {
    toggle.textContent = running ? "暂停自动读取" : "启动自动读取";
    toggle.dataset.running = running ? "1" : "0";
  }
  localStorage.setItem(ENABLED_KEY, String(running));
}

function mountPanel() {
  if (byId("vision-panel")) return;
  const panel = document.createElement("section");
  panel.id = "vision-panel";
  panel.className = "v060-panel";
  panel.innerHTML = `
    <div class="v060-head">
      <div>
        <strong>V0.6 AUTO VISION</strong>
        <span id="vision-status" data-kind="warn">初始化窗口捕获…</span>
      </div>
      <button id="vision-toggle" type="button"></button>
    </div>
    <div class="v060-controls">
      <select id="vision-window-select" aria-label="自动视觉目标窗口"></select>
      <button id="vision-refresh-windows" type="button">重新扫描</button>
    </div>
    <div class="v060-preview-wrap">
      <img id="vision-preview" alt="等待游戏窗口画面" />
      <div class="v060-preview-empty">等待金铲铲窗口画面</div>
    </div>
    <div class="v060-foot">
      <span id="vision-frame-meta">0 frames</span>
      <span>视觉状态：Capture READY · OCR/英雄识别下一层接入</span>
    </div>
    <div class="v060-rule-status">${ruleStatusLabel(activeRules())}</div>
  `;
  const anchor = document.querySelector(".quick-state");
  anchor?.parentElement?.insertBefore(panel, anchor);

  byId<HTMLButtonElement>("vision-toggle")?.addEventListener("click", () => {
    running = !running;
    renderRunningState();
    if (running) scheduleCapture();
    else window.clearTimeout(captureTimer);
  });
  byId<HTMLButtonElement>("vision-refresh-windows")?.addEventListener("click", () => void refreshWindows());
  byId<HTMLSelectElement>("vision-window-select")?.addEventListener("change", (event) => {
    selectedWindowId = (event.currentTarget as HTMLSelectElement).value;
    const selected = windows.find((item) => item.id === selectedWindowId);
    if (selected) {
      localStorage.setItem(WINDOW_KEY, selected.id);
      localStorage.setItem(`${WINDOW_KEY}.title`, selected.title);
      setStatus(`已选择：${selected.title}`, "ok");
    } else {
      localStorage.removeItem(WINDOW_KEY);
    }
    scheduleCapture();
  });
  renderRunningState();
}

async function boot() {
  mountPanel();
  if (!tauriGlobal()?.core?.invoke) {
    setStatus("自动视觉仅在 Windows 桌面版启用", "warn");
    return;
  }
  await refreshWindows();
  scheduleWindowRefresh();
  if (running) scheduleCapture();
}

void boot();
