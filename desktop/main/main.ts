import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GatewaySidecar } from "./sidecar.js";
import { IPC } from "./types.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../..");
let mainWindow: BrowserWindow | null = null;
let sidecar: GatewaySidecar | null = null;
let quitting = false;

// The capture/smoke environment may not provide a usable GPU process (for
// example, a missing driver DLL).  Opt into Chromium's software compositor
// before app readiness so the complete production page can still render and
// be captured.  Normal launches keep the platform default.
if (process.env.BRAIN_GAME_SCREENSHOT === "1" || process.env.BRAIN_GAME_RENDERER_SMOKE_TEST === "1") {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("no-sandbox");
  app.disableHardwareAcceleration();
}

if (process.env.BRAIN_GAME_SMOKE_USER_DATA) {
  const smokeUserData = path.resolve(process.env.BRAIN_GAME_SMOKE_USER_DATA);
  app.setPath("userData", smokeUserData);
  app.setPath("cache", path.join(smokeUserData, "cache"));
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function createDirectories() {
  const localRoot = path.join(app.getPath("userData"));
  const sessions = path.join(app.getPath("documents"), "BrainGame", "Sessions");
  const directories = {
    logs: path.join(localRoot, "logs"),
    syncQueue: path.join(localRoot, "sync-queue"),
    sessions,
  };
  for (const directory of Object.values(directories)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return directories;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#07111f",
    webPreferences: {
      preload: path.join(currentDirectory, "../preload/preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env.BRAIN_GAME_RENDERER_SMOKE_TEST === "1") {
    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      console.error(`RENDERER_CONSOLE level=${level} ${message} (${sourceId}:${line})`);
    });
    window.webContents.on("did-fail-load", (_event, code, description, url) => {
      console.error(`RENDERER_LOAD_FAILED code=${code} ${description} url=${url}`);
    });
  }
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) event.preventDefault();
  });
  window.on("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
  });
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(path.join(projectRoot, "dist-renderer", "index.html"));
  return window;
}

function registerIpc(sessionsDirectory: string): void {
  ipcMain.handle(IPC.getStatus, () => sidecar?.getStatus() ?? "stopped");
  ipcMain.handle(IPC.getConnection, () => sidecar?.getConnection() ?? null);
  ipcMain.handle(IPC.restart, async () => sidecar?.restart());
  ipcMain.handle(IPC.openSessionFolder, async (_event, sessionId?: string) => {
    const target = sessionId ? path.join(sessionsDirectory, sessionId) : sessionsDirectory;
    const resolved = path.resolve(target);
    if (resolved !== path.resolve(sessionsDirectory) && !resolved.startsWith(path.resolve(sessionsDirectory) + path.sep)) {
      throw new Error("invalid session path");
    }
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  });
}

async function runScreenshotCheck(window: BrowserWindow): Promise<void> {
  if (window.webContents.isLoadingMainFrame()) {
    await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
  }
  const screenshotDirectory = process.env.BRAIN_GAME_SCREENSHOT_DIR || app.getPath("userData");
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const capture = async (name: string) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(screenshotDirectory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  };
  const clickButton = async (label: string) => {
    const clicked = await window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(${JSON.stringify(label)}));
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`);
    if (!clicked) throw new Error(`Screenshot check could not click ${label}`);
  };
  await new Promise((resolve) => setTimeout(resolve, 700));
  await capture("game");
  await clickButton("设备与实验");
  await capture("lab");
  await clickButton("教学模式");
  await capture("teaching");
  await clickButton("游戏牌桌");
  await clickButton("开始本局");
  await clickButton("开始发牌");
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const stimulusState = await window.webContents.executeJavaScript(`({
    stage: document.querySelector('.game-console__status')?.textContent,
    canvasCount: document.querySelectorAll('.stimulus-canvas').length,
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
  })`);
  await capture("stimulus");
  console.log(`SCREENSHOT_CHECK_RESULT=${JSON.stringify(stimulusState)}`);
}

async function runRendererSmokeTest(window: BrowserWindow): Promise<void> {
  if (window.webContents.isLoadingMainFrame()) {
    await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
  }
  const result = await window.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const button = (text) => [...document.querySelectorAll('button')].find((item) => item.textContent.includes(text));
    await sleep(600);
    const labViewButton = button('设备与实验');
    if (!labViewButton) throw new Error('stage 15 navigation is missing');
    labViewButton.click();
    await sleep(100);
    const connectButton = button('连接网关');
    if (!connectButton) throw new Error('renderer did not render controls: ' + document.body.innerText);
    connectButton.click();
    await sleep(1200);
    button('开始采集').click();
    await sleep(1200);
    const calibrationButton = button('采集下一校准样本');
    if (!calibrationButton) throw new Error('stage 9 calibration control is missing');
    for (let index = 0; index < 4; index += 1) {
      while (calibrationButton.disabled) await sleep(100);
      calibrationButton.click();
      await sleep(500);
      while (calibrationButton.disabled) await sleep(100);
    }
    const trainButton = button('训练 eTRCA');
    if (!trainButton || trainButton.disabled) throw new Error('eTRCA training did not become available');
    trainButton.click();
    await sleep(2000);
    const trialButton = button('运行一次试次');
    if (!trialButton) throw new Error('stage 8 trial control is missing');
    trialButton.click();
    await sleep(8000);
    button('停止采集').click();
    await sleep(500);
    const labPageText = document.body.innerText;
    const has1000Hz = labPageText.includes('1000 Hz');
    const modelTrained = labPageText.includes('eTRCA 已训练');
    button('游戏牌桌').click();
    await sleep(100);
    const difficultOneButton = button('困难 1');
    if (!difficultOneButton || difficultOneButton.disabled) throw new Error('stage 11 mode selector is missing');
    difficultOneButton.click();
    const quickGameButton = button('快速局 10 轮');
    while (quickGameButton.disabled) await sleep(100);
    quickGameButton.click();
    await sleep(200);
    const dealButton = button('开始发牌');
    while (dealButton.disabled) await sleep(100);
    dealButton.click();
    await sleep(2300);
    const canvas = document.querySelector('.stimulus-canvas');
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + bounds.width * .25, clientY: bounds.top + bounds.height * .3 }));
    await sleep(3500);
    for (let round = 1; round < 10; round += 1) {
      const nextButton = button('发下一轮');
      while (nextButton.disabled) await sleep(100);
      nextButton.click();
      await sleep(2300);
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + bounds.width * .25, clientY: bounds.top + bounds.height * .3 }));
      await sleep(1700);
    }
    await sleep(500);
    const values = [...document.querySelectorAll('dd')].map((item) => item.textContent);
    const pageText = document.body.innerText;
    const gameText = document.querySelector('.game-panel')?.innerText ?? '';
    const quickButtonAfterGame = button('快速局 10 轮');
    return { values, has1000Hz, modelTrained, difficultOneSelected: gameText.includes('困难 1'),
      gameCompleted: gameText.includes('10/10'), summaryVisible: gameText.includes('本局结算') && gameText.includes('正确次数') && gameText.includes('平均识别用时'),
      restEnforced: quickButtonAfterGame.disabled && gameText.includes('请休息'), gameText,
      trialReady: pageText.includes('未能确定选择') || pageText.includes('识别目标') || pageText.includes('正确') || pageText.includes('选择错误'), error: document.querySelector('[role=alert]')?.textContent ?? null };
  })()`);
  console.log(`RENDERER_SMOKE_RESULT=${JSON.stringify(result)}`);
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  const directories = createDirectories();
  sidecar = new GatewaySidecar({
    projectRoot,
    logsDirectory: directories.logs,
    sessionsDirectory: directories.sessions,
    packagedExecutable: app.isPackaged
      ? path.join(process.resourcesPath, "device_gateway", "device_gateway.exe")
      : undefined,
  });
  registerIpc(directories.sessions);
  mainWindow = createWindow();
  sidecar.on("status", (status) => mainWindow?.webContents.send(IPC.statusChanged, status));
  sidecar.on("stderr", (message) => console.error(`[device-gateway] ${message}`));
  if (process.env.BRAIN_GAME_SCREENSHOT === "1") {
    try {
      await runScreenshotCheck(mainWindow);
    } catch (error) {
      console.error("SCREENSHOT_CHECK_FAILED", error);
      app.exit(1);
      return;
    }
    app.quit();
    return;
  }
  try {
    await sidecar.start();
  } catch (error) {
    console.error("Failed to start device gateway", error);
    return;
  }
  if (process.env.BRAIN_GAME_RENDERER_SMOKE_TEST === "1" && mainWindow) {
    try {
      await runRendererSmokeTest(mainWindow);
    } catch (error) {
      console.error("RENDERER_SMOKE_FAILED", error);
    } finally {
      app.quit();
    }
  } else if (process.env.BRAIN_GAME_SMOKE_TEST === "1") {
    setTimeout(() => app.quit(), 1_500);
  }
});

app.on("before-quit", (event) => {
  if (quitting || !sidecar) return;
  event.preventDefault();
  quitting = true;
  void sidecar.stop().finally(() => app.quit());
});

app.on("window-all-closed", () => app.quit());
