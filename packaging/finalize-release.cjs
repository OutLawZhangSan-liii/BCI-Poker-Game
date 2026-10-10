const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const directory = path.join(root, 'release', pkg.version);
const installerName = `Shengong-Shenyou-Setup-${pkg.version}-x64.exe`;
const targets = [installerName, 'win-unpacked/ShengongShenyou.exe',
  'win-unpacked/resources/app.asar', 'win-unpacked/resources/app-icon.ico',
  'win-unpacked/resources/device_gateway/device_gateway.exe'];
const files = targets.map(name => {
  const filename = path.join(directory, name);
  return { name, bytes: fs.statSync(filename).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') };
});
fs.copyFileSync(path.join(__dirname, 'WINDOWS-RELEASE.md'), path.join(directory, '安装与卸载说明.md'));
const metadata = { product: '神工 · 神游', version: pkg.version, platform: 'win32-x64',
  packagedAt: new Date().toISOString(), electron: fs.readFileSync(path.join(root, 'node_modules/electron/dist/version'), 'utf8').trim(),
  pythonGateway: 'bundled, onedir', signed: false, files };
fs.writeFileSync(path.join(directory, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), files.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n');
console.log(JSON.stringify({ installer: path.join(directory, installerName), mb: +(files[0].bytes / 1024 / 1024).toFixed(1), sha256: files[0].sha256 }));
