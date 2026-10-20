const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const directory = path.resolve(".smoke-user-data", `challenge-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const env = { ...process.env, BRAIN_GAME_CHALLENGE_SMOKE: "1", BRAIN_GAME_SMOKE_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require("electron"), ["."], { env, stdio: "inherit", windowsHide: true, timeout: 120000 });
console.log(`隔离验收目录：${directory}`);
if (result.error) console.error(result.error);
let passed = false;
try { passed = JSON.parse(fs.readFileSync(path.join(directory, "challenge-smoke.json"), "utf8")).success === true; }
catch (error) { console.error(`未取得验收完成报告：${error.message}`); }
process.exitCode = result.status === 0 && passed ? 0 : 1;
