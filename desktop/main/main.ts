import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GatewaySidecar } from "./sidecar.js";
import { IPC } from "./types.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../..");
const packageSmoke = process.env.BRAIN_GAME_PACKAGE_SMOKE === "1";
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
  const sessions = packageSmoke && process.env.BRAIN_GAME_SMOKE_USER_DATA
    ? path.join(localRoot, "test-sessions")
    : path.join(app.getPath("documents"), "BrainGame", "Sessions");
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
    title: "神工 · 神游",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#111a15", symbolColor: "#eee9dc", height: 64 },
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "app-icon.ico")
      : path.join(projectRoot, "packaging", "icon.ico"),
    backgroundColor: "#111a15",
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
  window.on("ready-to-show", () => { if (!packageSmoke) window.show(); });
  window.on("closed", () => {
    mainWindow = null;
  });
  const developmentUrl = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL;
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
  Menu.setApplicationMenu(null);
  if (process.platform === "win32") app.setAppUserModelId("cn.shengong.shenyou.bcipoker");
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
    if (packageSmoke) {
      fs.writeFileSync(path.join(app.getPath("userData"), "package-smoke.json"), JSON.stringify({ success: false, error: String(error) }));
      app.exit(1);
    }
    return;
  }
  if (packageSmoke && mainWindow) {
    try {
      if (mainWindow.webContents.isLoadingMainFrame()) {
        await new Promise<void>((resolve, reject) => {
          mainWindow!.webContents.once("did-finish-load", () => resolve());
          mainWindow!.webContents.once("did-fail-load", (_event, code, description) => reject(new Error(`${code}: ${description}`)));
        });
      }
      if (process.env.BRAIN_GAME_BRAND_PREVIEW === "1") {
        await mainWindow.webContents.executeJavaScript(`(async () => {
          await document.fonts.ready;
          for (let i = 0; i < 80 && !document.querySelector('.intro-flip--running'); i++)
            await new Promise(resolve => setTimeout(resolve, 25));
          if (!document.querySelector('.intro-flip--running')) throw new Error('Intro did not start');
        })()`);
        for (const [name, time] of [["intro-before", 2700], ["intro-drawing", 3150], ["intro-complete", 3750]] as const) {
          const preview = await mainWindow.webContents.executeJavaScript(`(() => {
            const intro = document.querySelector('.intro-flip');
            for (const animation of intro.getAnimations({ subtree: true })) {
              animation.pause(); animation.currentTime = ${time};
            }
            const logo = intro.querySelector('.intro-flip__neuron');
            const trace = intro.querySelector('.intro-flip__neuron-trace');
            return { wordmarkPresent: Boolean(intro.querySelector('.brand-wordmark')),
              logoPresent: Boolean(logo), dashOffset: getComputedStyle(trace).strokeDashoffset };
          })()`);
          await new Promise(resolve => setTimeout(resolve, 80));
          fs.writeFileSync(path.join(app.getPath("userData"), `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG());
          console.log(`BRAND_PREVIEW=${JSON.stringify({ name, ...preview })}`);
        }
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.intro-flip').click()`);
      }
      const ui = await mainWindow.webContents.executeJavaScript(`(async () => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        await sleep(6000);
        const sections = [];
        for (const label of ['教学模式', '设备与实验', '游戏牌桌']) {
          const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
          if (!button) throw new Error('Missing navigation: ' + label);
          button.click(); await sleep(400); sections.push(label);
        }
        return { sections, gatewayStatus: await window.brainGameDesktop.getGatewayStatus(),
          preloadAvailable: !!window.brainGameDesktop,
          brokenImages: [...document.images].filter(image => !image.complete || !image.naturalWidth).length,
          textLength: document.body.innerText.length };
      })()`);
      if (ui.gatewayStatus !== "ready" || ui.brokenImages > 0 || ui.textLength < 50) {
        throw new Error(`Packaged application verification failed: ${JSON.stringify(ui)}`);
      }
      const headerChecks = [];
      for (const [width, height] of [[1920, 1080], [1280, 800], [960, 640]]) {
        mainWindow.setContentSize(width, height);
        const checks = await mainWindow.webContents.executeJavaScript(`(async () => {
          const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
          const checks = [];
          for (const label of ['游戏牌桌', '教学模式', '设备与实验']) {
            [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label).click();
            await sleep(160);
            const header = document.querySelector('.app-header');
            const identity = header.querySelector('.app-header__identity');
            const nav = header.querySelector('.view-nav');
            const status = header.querySelector('.app-header__status');
            const icon = header.querySelector('.app-header__icon');
            const wordmark = header.querySelector('.brand-wordmark');
            const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
            const h = rect(header), i = rect(identity), n = rect(nav), s = rect(status);
            const safeRight = innerWidth - parseFloat(getComputedStyle(header).paddingRight);
            const noOverlap = i.right <= n.left + 1 && n.right <= s.left + 1 && s.right <= safeRight + 1;
            const wordmarkBounds = rect(wordmark);
            const wordmarkVisible = getComputedStyle(wordmark).maskImage.includes('shoujin-wordmark.svg') &&
              wordmarkBounds.top >= h.top && wordmarkBounds.bottom <= h.bottom && wordmarkBounds.right <= n.left;
            const valid = noOverlap && wordmarkVisible && Math.abs(h.top) <= 1 && icon.complete && icon.naturalWidth > 0 &&
              getComputedStyle(header).webkitAppRegion === 'drag' && getComputedStyle(nav).webkitAppRegion === 'no-drag' &&
              document.documentElement.scrollWidth <= innerWidth + 1;
            checks.push({ page: label, valid, noOverlap, header: h, identity: i, nav: n, status: s, safeRight,
              title: header.querySelector('h1').textContent, wordmarkVisible, wordmarkBounds, iconWidth: icon.naturalWidth,
              viewport: [innerWidth, innerHeight] });
          }
          return checks;
        })()`);
        headerChecks.push(...checks);
        if (checks.some((check: { valid: boolean }) => !check.valid)) {
          throw new Error(`Window header validation failed: ${JSON.stringify(checks)}`);
        }
        await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.view-nav button')[0].click()`);
        await new Promise(resolve => setTimeout(resolve, 180));
        fs.writeFileSync(path.join(app.getPath("userData"), `window-${width}.png`), (await mainWindow.webContents.capturePage()).toPNG());
      }
      const windowControls = { menuRemoved: Menu.getApplicationMenu() === null,
        minimizable: mainWindow.isMinimizable(), maximizable: mainWindow.isMaximizable(),
        closable: mainWindow.isClosable(), resizable: mainWindow.isResizable() };
      if (Object.values(windowControls).some(value => !value)) throw new Error("Native window controls are unavailable");
      fs.writeFileSync(path.join(app.getPath("userData"), "package-smoke.json"), JSON.stringify({
        success: true, version: app.getVersion(), packaged: app.isPackaged,
        bundledGateway: fs.existsSync(path.join(process.resourcesPath, "device_gateway", "device_gateway.exe")),
        ui, headerChecks, windowControls,
        customIcon: fs.existsSync(path.join(process.resourcesPath, "app-icon.ico")),
        metrics: app.getAppMetrics().map(({ type, cpu, memory }) => ({ type, cpu, memory })),
      }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(app.getPath("userData"), "package-smoke.json"), JSON.stringify({ success: false, error: String(error) }));
      process.exitCode = 1;
    } finally {
      app.quit();
    }
  } else if (process.env.BRAIN_GAME_RENDERER_SMOKE_TEST === "1" && mainWindow) {
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
