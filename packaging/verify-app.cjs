const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const executable = path.resolve(process.argv[2]);
const profile = path.resolve(process.argv[3] || '.smoke-user-data/packaged-app');
fs.mkdirSync(profile, { recursive: true });
const resultPath = path.join(profile, 'package-smoke.json');
if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
const env = { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32'),
  BRAIN_GAME_PACKAGE_SMOKE: '1', BRAIN_GAME_SMOKE_USER_DATA: profile,
  // A packaged app must ignore any development server inherited from the host.
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.BRAIN_GAME_SCREENSHOT;
delete env.BRAIN_GAME_RENDERER_SMOKE_TEST;
const started = Date.now();
const child = spawn(executable, [], { cwd: path.dirname(executable), env,
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = '';
child.stdout.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
const timeout = setTimeout(() => { child.kill(); }, 35000);
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  clearTimeout(timeout);
  const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null;
  if (!result?.success || !result.packaged || code !== 0) {
    console.error(JSON.stringify({ code, result, diagnostics })); process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ success: true, elapsed_ms: Date.now() - started,
      report: resultPath, version: result.version, ui: result.ui,
      electron_working_set_mb: Math.round(result.metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024) }));
  }
});
