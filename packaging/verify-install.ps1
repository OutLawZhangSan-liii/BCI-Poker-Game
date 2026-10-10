param([string]$Installer)
$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
$version = (Get-Content -LiteralPath (Join-Path $projectDirectory "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $Installer) { $Installer = "release\$version\Shengong-Shenyou-Setup-$version-x64.exe" }
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$qaDirectory = [IO.Path]::GetFullPath((Join-Path $projectDirectory ".smoke-user-data\packaging\$version\install"))
$installationDirectory = [IO.Path]::GetFullPath((Join-Path $qaDirectory "brain-game-desktop"))
if (-not $installationDirectory.StartsWith($projectDirectory + "\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Test installation must stay inside this workspace"
}
$uninstallRoot = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
$productName = -join (0x795E, 0x5DE5, 0x795E, 0x6E38 | ForEach-Object { [char]$_ })
$existing = @(Get-ChildItem $uninstallRoot | Get-ItemProperty | Where-Object { $_.DisplayName -like "$productName*" })
if ($existing.Count) { throw "An existing installed version is present; do not overwrite it during QA" }
New-Item -ItemType Directory -Path $qaDirectory -Force | Out-Null
# User data lives outside the installation directory and must survive uninstall.
$dataSentinel = Join-Path $qaDirectory "user-data-preserved.txt"
Set-Content -LiteralPath $dataSentinel -Value "packaging-data-preservation-check"
$process = Start-Process -FilePath $installerPath `
    -ArgumentList @("/S", "/currentuser", "/D=$installationDirectory") `
    -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(90000)) { throw "Installer exceeded 90 seconds" }
if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
$executable = Join-Path $installationDirectory "ShengongShenyou.exe"
if (-not (Test-Path -LiteralPath $executable)) { throw "Installed executable is missing" }
$registration = @(Get-ChildItem $uninstallRoot | Get-ItemProperty | Where-Object { $_.DisplayName -like "$productName*" })
if ($registration.Count -ne 1) { throw "Expected exactly one uninstall registration" }
$registeredUninstaller = ($registration[0].UninstallString -split '"')[1]
$registeredDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $registeredUninstaller)).TrimEnd('\')
if ($registeredDirectory -ne $installationDirectory) { throw "Unexpected installation directory: $registeredDirectory" }
$uninstaller = @(Get-ChildItem -LiteralPath $installationDirectory -File | Where-Object { $_.Name -like "Uninstall*.exe" })
if ($uninstaller.Count -ne 1) { throw "Uninstaller is missing" }
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "$productName.lnk"
$startShortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "$productName.lnk"
if (-not (Test-Path -LiteralPath $desktopShortcut) -or -not (Test-Path -LiteralPath $startShortcut)) { throw "Expected shortcuts are missing" }
$shortcutReader = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @($desktopShortcut, $startShortcut)) {
    $shortcut = $shortcutReader.CreateShortcut($shortcutPath)
    if ($shortcut.TargetPath -ne $executable) { throw "Shortcut points to an unexpected executable" }
}
& (Join-Path $projectDirectory ".venv-release\Scripts\python.exe") (Join-Path $PSScriptRoot "verify-icon.py") $installerPath $executable $uninstaller[0].FullName
if ($LASTEXITCODE -ne 0) { throw "Installed application / installer / uninstaller icon verification failed" }
$installedProfile = Join-Path $qaDirectory "installed-profile"
& node (Join-Path $PSScriptRoot "verify-app.cjs") $executable $installedProfile
if ($LASTEXITCODE -ne 0) { throw "Installed application smoke verification failed" }
# The registered target has been checked above before launching its remover.
$uninstallProcess = Start-Process -FilePath $uninstaller[0].FullName `
    -ArgumentList @("/S", "/currentuser") `
    -WorkingDirectory $qaDirectory -WindowStyle Hidden -PassThru
if (-not $uninstallProcess.WaitForExit(90000)) { throw "Uninstaller exceeded 90 seconds" }
if ($uninstallProcess.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstallProcess.ExitCode)" }
# Normal NSIS uninstall relaunches from a temporary folder to remove itself.
$cleanupDeadline = [DateTime]::UtcNow.AddSeconds(45)
do {
    $remainingRegistration = @(Get-ChildItem $uninstallRoot | Get-ItemProperty | Where-Object { $_.DisplayName -like "$productName*" })
    $cleanupPending = $remainingRegistration.Count -or (Test-Path -LiteralPath $executable) -or
        (Test-Path -LiteralPath $uninstaller[0].FullName) -or
        (Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startShortcut)
    if ($cleanupPending) { Start-Sleep -Milliseconds 200 }
} while ($cleanupPending -and [DateTime]::UtcNow -lt $cleanupDeadline)
if ($cleanupPending) { throw "Uninstall did not remove the application registration/files/shortcuts" }
if (-not (Test-Path -LiteralPath $dataSentinel) -or -not (Test-Path -LiteralPath (Join-Path $installedProfile "package-smoke.json"))) { throw "Uninstall removed user data" }
$report = [ordered]@{
    success = $true; installerExit = $process.ExitCode; uninstallerExit = $uninstallProcess.ExitCode
    installedAppVerified = $true; uninstallRegistrationRemoved = $true; shortcutsRemoved = $true
    uninstallerSelfRemoved = $true
    iconResourcesVerified = $true; shortcutTargetsVerified = $true
    userDataPreserved = $true; installedAt = $installationDirectory
}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaDirectory "install-verification.json") -Encoding UTF8
$report | ConvertTo-Json
