param([string]$Python = "python")
$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
$environmentDirectory = Join-Path $projectDirectory ".venv-release"
$buildPython = Join-Path $environmentDirectory "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $buildPython)) {
    & $Python -m venv $environmentDirectory
    if ($LASTEXITCODE -ne 0) { throw "Could not create packaging Python environment" }
}
& $buildPython -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not install gateway packaging dependencies" }
& $buildPython -m PyInstaller --noconfirm --onedir --console --noupx `
    --name device_gateway --paths $projectDirectory `
    --distpath (Join-Path $projectDirectory "build\gateway") `
    --workpath (Join-Path $projectDirectory "build\pyinstaller") `
    --specpath (Join-Path $projectDirectory "build") `
    (Join-Path $PSScriptRoot "gateway_entry.py")
if ($LASTEXITCODE -ne 0) { throw "Gateway executable build failed" }
