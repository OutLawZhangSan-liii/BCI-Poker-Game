import { ipcMain, shell, app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { validateLabRecord } from "./labRecord.js";

export function registerLabIpc(projectRoot: string, sessionsDirectory: string) {
  const root = path.join(app.getPath("userData"), "stimulus-lab");
  fs.mkdirSync(root, { recursive: true });
  const idPath = (id: string) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid experiment id"); return path.join(root, id); };
  const active = new Set<string>();
  ipcMain.handle("lab:list", () => fs.readdirSync(root).filter(id => /^[0-9a-f-]{36}$/i.test(id)).flatMap(id => {
    const file = path.join(idPath(id), "run.json"); if (!fs.existsSync(file)) return [];
    const run = JSON.parse(fs.readFileSync(file, "utf8"));
    return [{ id, createdAt: run.createdAt, completed: run.attempts.filter((a: {status: string}) => a.status === "complete").length }];
  }));
  ipcMain.handle("lab:load", (_event, id: string) => JSON.parse(fs.readFileSync(path.join(idPath(id), "run.json"), "utf8")));
  ipcMain.handle("lab:save", (_event, run) => {
    if (active.has(run.id)) throw new Error("analysis in progress; experiment record is locked");
    const directory = idPath(run.id); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "run.json");
    const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
    validateLabRecord(run, previous);
    const revision = previous?.revision ?? 0;
    if (revision !== run.revision) throw new Error("experiment record changed; reload before continuing");
    if (fs.existsSync(path.join(directory,"analysis","evaluation-lock.json"))) {
      if (JSON.stringify(previous)===JSON.stringify(run)) return previous;
      throw new Error("final evaluation is locked; acquisition record cannot be changed");
    }
    const saved = { ...run, revision: revision + 1 };
    fs.writeFileSync(file + ".tmp", JSON.stringify(saved, null, 2), "utf8"); fs.renameSync(file + ".tmp", file);
    return saved;
  });
  ipcMain.handle("lab:analyze", async (_event, id: string, final: boolean) => {
    const directory = idPath(id), runFile = path.join(directory, "run.json");
    if (active.has(id)) throw new Error("analysis already running");
    if (app.isPackaged) throw new Error("此实验分支的分析需在开发环境运行 Python/Node；当前安装包尚未包含分析运行环境。");
    active.add(id);
    try {
      const args = ["-m", "tools.stimulus_lab.analyze", "--run", runFile, "--sessions", sessionsDirectory, "--out", path.join(directory, "analysis"), ...(final ? ["--final"] : [])];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.env.BRAIN_GAME_ANALYSIS_PYTHON || "python", args, { cwd: projectRoot, windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" }, stdio: ["ignore", "pipe", "pipe"] });
        let diagnostics = "";
        child.stderr.on("data", data => { diagnostics = (diagnostics + data.toString()).slice(-12000); });
        child.stdout.on("data", () => {});
        child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(diagnostics || `analysis exited ${code}`)));
      });
      return JSON.parse(fs.readFileSync(path.join(directory, "analysis", final ? "final-summary.json" : "development-summary.json"), "utf8"));
    } finally { active.delete(id); }
  });
  ipcMain.handle("lab:open-report", async (_event, id: string, final: boolean) => {
    const error = await shell.openPath(path.join(idPath(id), "analysis", final ? "final-report.html" : "development-report.html"));
    if (error) throw new Error(error);
  });
}
