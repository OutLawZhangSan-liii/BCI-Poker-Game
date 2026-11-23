// Exercise the built renderer in isolation without EEG or score writes.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = require("node:child_process").spawnSync(require("electron"), [__filename], {
    env, stdio: "inherit", windowsHide: true, timeout: 30000,
  });
  if (run.error) console.error(run.error);
  process.exitCode = run.status === 0 ? 0 : 1;
} else {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const root = path.resolve(__dirname, "..");
  const out = path.join(root, ".smoke-user-data", "butterworth-ui-" + new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(out, { recursive: true });
  app.setPath("userData", path.join(out, "user-data"));
  app.disableHardwareAcceleration();
  ipcMain.handle("gateway:get-status", () => "stopped");
  ipcMain.handle("gateway:get-connection", () => null);
  ipcMain.handle("challenge:list", () => ({ records: [], warnings: [] }));
  ipcMain.handle("window:set-appearance", () => undefined);

  app.whenReady().then(async () => {
    const window = new BrowserWindow({
      show: false, width: 1280, height: 800, useContentSize: true,
      webPreferences: {
        preload: path.join(root, "dist-desktop/preload/preload.cjs"),
        sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false,
      },
    });
    const checks = [];
    const errors = [];
    window.webContents.on("console-message", message => {
      if (message.level === "error") errors.push(message.message);
    });
    const evaluate = source => window.webContents.executeJavaScript(source);
    const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const loadSetup = async () => {
      await window.loadFile(path.join(root, "dist-renderer/index.html"));
      for (let i = 0; i < 100; i++) {
        if (await evaluate("!!document.querySelector('.game-settings-fold')")) return;
        await evaluate("document.querySelector('.intro-flip')?.click()");
        await pause(100);
      }
      throw new Error("Game setup unavailable");
    };
    const verifySetup = async label => {
      const setup = await evaluate(`({
        controls: [...document.querySelectorAll(".game-settings-fold__trigger")].map(button => button.dataset.foldTrigger),
        profile: document.querySelector(".game-table-frame").dataset.classifier,
      })`);
      assert.deepEqual(setup, { controls: ["mode", "length"], profile: "butterworth-trial-v1" });
      checks.push(label);
    };

    let error;
    try {
      await loadSetup();
      await verifySetup("Fresh setup uses Butterworth and exposes only difficulty and length");
      await evaluate("localStorage.setItem('game-classifier-profile', 'fir-baseline-v1')");
      await loadSetup();
      await verifySetup("A saved FIR preference cannot change the default");
      await evaluate(`document.querySelector("[data-fold-trigger=length]").click()`);
      await evaluate(`document.querySelector("[data-fold-options=length] button:last-child").click()`);
      const selected = await evaluate(`document.querySelector("[data-fold-options=length] button:last-child").getAttribute("aria-pressed")`);
      assert.equal(selected, "true");
      checks.push("Round count can still be changed");
    } catch (cause) {
      error = String(cause);
    }
    const result = { success: !error && !errors.length, checks, errors, error, out };
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    app.exit(result.success ? 0 : 1);
  }).catch(error => { console.error(error); app.exit(1); });
}
