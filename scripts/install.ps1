# Windows 10/11, Windows PowerShell 5.1 or PowerShell 7. Tandix runs its official wizard.
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'StudyTrail'),
    [switch]$NoStart,
    [switch]$SkipTandix,
    [switch]$RepairTandix
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($SkipTandix -and $RepairTandix) { throw '-SkipTandix and -RepairTandix cannot be combined.' }
function Get-Download([string]$Url, [string]$Destination) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec 120; return }
        catch { if ($attempt -eq 3) { throw }; Start-Sleep -Seconds 2 }
    }
}
$InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\', '/')
if (-not $InstallDir -or $InstallDir -eq [IO.Path]::GetPathRoot($InstallDir).TrimEnd('\', '/')) {
    throw 'Choose a non-root installation directory.'
}
$parent = Split-Path -Parent $InstallDir
[IO.Directory]::CreateDirectory($parent) | Out-Null
$lockPath = "$InstallDir.install-lock"
$lock = $null
$stage = $null
try {
    try { $lock = [IO.File]::Open($lockPath, 'CreateNew', 'Write', 'None') }
    catch { throw "Another installation is running, or a stale lock remains: $lockPath" }
    if (Test-Path -LiteralPath $InstallDir) {
        foreach ($required in @('.studytrail-installer-v1', 'runtime\node.exe', 'app\scripts\dev.cjs', 'Start StudyTrail.cmd')) {
            if (-not (Test-Path -LiteralPath (Join-Path $InstallDir $required) -PathType Leaf)) {
                throw "Not a complete installer-managed installation: $InstallDir. Choose another directory with -InstallDir. Existing files have been preserved."
            }
        }
        Write-Host "StudyTrail is already installed: $InstallDir (reusing it; no upgrade)."
    } else {
        $stage = Join-Path $parent ('.studytrail-install-' + [guid]::NewGuid().ToString('N'))
        $bundle = Join-Path $stage 'bundle'
        [IO.Directory]::CreateDirectory($bundle) | Out-Null
        $arch = $env:PROCESSOR_ARCHITECTURE
        if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
        switch ($arch.ToUpperInvariant()) {
            'AMD64' { $arch = 'x64' }
            'ARM64' { $arch = 'arm64' }
            default { throw "Unsupported Windows architecture: $arch (64-bit Windows required)." }
        }
        Write-Host 'Downloading a private Node.js 24 LTS runtime from nodejs.org...'
        $manifest = Join-Path $stage 'SHASUMS256.txt'
        Get-Download 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' $manifest
        $pattern = '^([a-fA-F0-9]{64})\s+(node-(v24\.\d+\.\d+)-win-' + $arch + '\.zip)$'
        $entries = @(Get-Content -LiteralPath $manifest | Where-Object { $_ -match $pattern })
        if ($entries.Count -ne 1) { throw 'Invalid Node.js download manifest.' }
        $entry = [regex]::Match($entries[0], $pattern)
        $expected = $entry.Groups[1].Value; $archive = $entry.Groups[2].Value; $version = $entry.Groups[3].Value
        $nodeZip = Join-Path $stage $archive
        Get-Download "https://nodejs.org/dist/$version/$archive" $nodeZip
        if ((Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash -ne $expected) { throw 'Node.js SHA-256 verification failed.' }
        Expand-Archive -LiteralPath $nodeZip -DestinationPath (Join-Path $stage 'node')
        Move-Item -LiteralPath (Join-Path $stage ('node\' + $archive.Replace('.zip', ''))) -Destination (Join-Path $bundle 'runtime')
        $node = Join-Path $bundle 'runtime\node.exe'
        & $node --version
        if ($LASTEXITCODE -ne 0) { throw 'Node.js cannot run on this computer.' }
        Write-Host 'Downloading StudyTrail...'
        $projectZip = Join-Path $stage 'project.zip'
        Get-Download 'https://github.com/samchen2009/studytrail/archive/refs/heads/main.zip' $projectZip
        Expand-Archive -LiteralPath $projectZip -DestinationPath (Join-Path $stage 'source')
        $app = Join-Path $bundle 'app'
        Move-Item -LiteralPath (Join-Path $stage 'source\studytrail-main') -Destination $app
        if (-not (Test-Path -LiteralPath (Join-Path $app 'scripts\dev.cjs')) -or -not (Test-Path -LiteralPath (Join-Path $app 'package-lock.json'))) { throw 'Incomplete project archive.' }
        Write-Host 'Installing application dependencies...'
        Push-Location -LiteralPath $app
        try {
            & $node (Join-Path $bundle 'runtime\node_modules\npm\bin\npm-cli.js') ci --include=optional --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your network and try again.' }
        } finally { Pop-Location }
        # ASCII content and CRLF work even when PowerShell uses a legacy code page.
        $launcher = @'
@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0app"
echo StudyTrail: http://127.0.0.1:8767/ (Ctrl+C to stop)
"%~dp0runtime\node.exe" scripts\dev.cjs --data-dir "%~dp0data" %*
if errorlevel 1 (
  echo Startup failed. Review the message above.
  pause
  exit /b 1
)
'@
        [IO.File]::WriteAllText((Join-Path $bundle 'Start StudyTrail.cmd'), ($launcher -replace '\r?\n', "`r`n"), [Text.Encoding]::ASCII)
        [IO.File]::WriteAllText((Join-Path $bundle '.studytrail-installer-v1'), "StudyTrail installer v1`r`nNode: $version`r`nSource: samchen2009/studytrail main`r`n")
        Move-Item -LiteralPath $bundle -Destination $InstallDir
    }
    Write-Host "StudyTrail installed: $InstallDir"
    $tandixMarker = Join-Path $InstallDir '.tandix-setup-v1'
    if ($SkipTandix) {
        Write-Host 'Tandix setup was explicitly skipped. AI grading is not ready.'
    } elseif ((Test-Path -LiteralPath $tandixMarker -PathType Leaf) -and -not $RepairTandix) {
        Write-Host 'Tandix setup previously completed. To reinstall or repair it, use -RepairTandix.'
    } else {
        if (-not $stage) {
            $stage = Join-Path $parent ('.studytrail-install-' + [guid]::NewGuid().ToString('N'))
            [IO.Directory]::CreateDirectory($stage) | Out-Null
        }
        $tandixInstaller = Join-Path $stage 'tandix-windows.ps1'
        Write-Host 'Installing Tandix using its official Windows wizard. Follow extension-loading and Codex sign-in prompts.'
        Write-Host 'If setup is interrupted, StudyTrail is preserved. Rerun this installer to retry Tandix.'
        # A failed repair must remain retryable, even if a previous setup succeeded.
        if (Test-Path -LiteralPath $tandixMarker) { Remove-Item -LiteralPath $tandixMarker -Force }
        Get-Download 'https://raw.githubusercontent.com/samchen2009/tandix/main/scripts/install/windows.ps1' $tandixInstaller
        $previousPath = $env:PATH
        try {
            # The child wizard reuses this permanent runtime and records it for its native host.
            $env:PATH = (Join-Path $InstallDir 'runtime') + ';' + $previousPath
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tandixInstaller -Agents codex -Agent codex
            if ($LASTEXITCODE -ne 0) { throw 'Tandix setup did not finish. StudyTrail is preserved; rerun this installer to retry. See %LOCALAPPDATA%\Tandix\install.log.' }
        } finally { $env:PATH = $previousPath }
        [IO.File]::WriteAllText($tandixMarker, "Official Tandix Windows wizard completed for Codex.`r`n")
        Write-Host 'Tandix extension files, native companion and Codex connection prepared. Reload Tandix in Chrome.'
    }
    Write-Host "Next time, double-click: $InstallDir\Start StudyTrail.cmd"
    Write-Host "Data and complete backups: $InstallDir\data"
    Write-Host 'For AI grading, select Codex in Tandix, then authorize this StudyTrail site on first use.'
} finally {
    if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
    if ($null -ne $lock) { $lock.Dispose(); Remove-Item -LiteralPath $lockPath -Force }
}
if (-not $NoStart) {
    $app = Join-Path $InstallDir 'app'
    Push-Location -LiteralPath $app
    try {
        & (Join-Path $InstallDir 'runtime\node.exe') scripts/dev.cjs --data-dir (Join-Path $InstallDir 'data')
        if ($LASTEXITCODE -ne 0) { throw 'StudyTrail stopped with an error. Review the message above.' }
    } finally { Pop-Location }
}
