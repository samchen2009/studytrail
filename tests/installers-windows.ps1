# Offline integration tests for Windows PowerShell 5.1. Uses synthetic archives only.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('studytrail-installer-test-' + [guid]::NewGuid().ToString('N'))
$installer = Join-Path $PSScriptRoot '..\scripts\install.ps1'
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Write-Fixture([string]$File, [string]$Text) {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $File)) | Out-Null
    [IO.File]::WriteAllText($File, $Text)
}
function Assert-Fails([scriptblock]$Action) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    Assert-True $failed 'Expected installer failure.'
}
try {
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
    if ($arch -eq 'ARM64') { $arch = 'arm64' } else { $arch = 'x64' }
    $archive = "node-v24.0.0-win-$arch"
    $nodeRoot = Join-Path $root "fixture\$archive"
    [IO.Directory]::CreateDirectory($nodeRoot) | Out-Null
    Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $nodeRoot 'node.exe')
    Write-Fixture (Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js') @'
const fs=require('node:fs');
if(process.env.STUDYTRAIL_TEST_FAIL_NPM)process.exit(7);
fs.writeFileSync('npm-installed.json',JSON.stringify(process.argv.slice(2)));
'@
    $project = Join-Path $root 'fixture\studytrail-main'
    Write-Fixture (Join-Path $project 'package-lock.json') '{}'
    Write-Fixture (Join-Path $project 'scripts\dev.cjs') @'
const fs=require('node:fs'),path=require('node:path');
const i=process.argv.indexOf('--data-dir');
fs.mkdirSync(process.argv[i+1],{recursive:true});
fs.writeFileSync(path.join(process.argv[i+1],'started.json'),JSON.stringify(process.argv.slice(2)));
'@
    $global:StudyTrailInstallerNodeZip = Join-Path $root 'node.zip'
    $global:StudyTrailInstallerProjectZip = Join-Path $root 'project.zip'
    Compress-Archive -LiteralPath $nodeRoot -DestinationPath $global:StudyTrailInstallerNodeZip
    Compress-Archive -LiteralPath $project -DestinationPath $global:StudyTrailInstallerProjectZip
    $global:StudyTrailInstallerHash = (Get-FileHash -LiteralPath $global:StudyTrailInstallerNodeZip -Algorithm SHA256).Hash
    $global:StudyTrailInstallerArchive = $archive
    $global:StudyTrailInstallerDownloadCount = 0
    $global:StudyTrailInstallerTandixCount = 0
    $global:StudyTrailInstallerTandixScript = Join-Path $root 'tandix-windows.ps1'
    Write-Fixture $global:StudyTrailInstallerTandixScript @'
param([string[]]$Agents, [string]$Agent)
if ($Agents.Count -ne 1 -or $Agents[0] -ne 'codex' -or $Agent -ne 'codex') { throw 'Only the Codex backend is needed for grading.' }
$global:StudyTrailInstallerTandixCount++
$global:StudyTrailInstallerTandixPath = $env:PATH
$global:LASTEXITCODE = 0
if ($env:STUDYTRAIL_TEST_FAIL_TANDIX) { $global:LASTEXITCODE = 8 }
'@
    # Intercept the child wizard instead of installing software on the CI host.
    function global:powershell.exe {
        param([switch]$NoProfile, [string]$ExecutionPolicy, [string]$File, [string[]]$Agents, [string]$Agent)
        if (-not $NoProfile -or $ExecutionPolicy -ne 'Bypass') { throw 'Unexpected child PowerShell arguments.' }
        & $File -Agents $Agents -Agent $Agent
    }
    # Intercept all downloads. Unexpected URLs fail instead of touching the network.
    function global:Invoke-WebRequest {
        param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile, $TimeoutSec)
        $global:StudyTrailInstallerDownloadCount++
        if ($Uri -eq 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt') {
            $hash = $global:StudyTrailInstallerHash
            if ($env:STUDYTRAIL_TEST_BAD_HASH) { $hash = '0' * 64 }
            [IO.File]::WriteAllText($OutFile, "$hash  $global:StudyTrailInstallerArchive.zip`n")
        } elseif ($Uri -eq "https://nodejs.org/dist/v24.0.0/$global:StudyTrailInstallerArchive.zip") {
            Copy-Item -LiteralPath $global:StudyTrailInstallerNodeZip -Destination $OutFile
        } elseif ($Uri -eq 'https://github.com/samchen2009/studytrail/archive/refs/heads/main.zip') {
            Copy-Item -LiteralPath $global:StudyTrailInstallerProjectZip -Destination $OutFile
        } elseif ($Uri -eq 'https://raw.githubusercontent.com/samchen2009/tandix/main/scripts/install/windows.ps1') {
            Copy-Item -LiteralPath $global:StudyTrailInstallerTandixScript -Destination $OutFile
        } else { throw "Unexpected URL: $Uri" }
    }
    # Construct Unicode without a BOM so this test itself remains PS 5.1 compatible.
    $target = Join-Path $root ("parent with spaces $([char]0x5b66)$([char]0x8ff9)\Study'Trail")
    & $installer -InstallDir $target -NoStart
    Assert-True (Test-Path -LiteralPath (Join-Path $target '.studytrail-installer-v1')) 'Missing installation marker.'
    Assert-True (Test-Path -LiteralPath (Join-Path $target '.tandix-setup-v1')) 'Default installation must invoke Tandix.'
    Assert-True ($global:StudyTrailInstallerTandixCount -eq 1) 'Official wizard was not invoked exactly once.'
    Assert-True ($global:StudyTrailInstallerTandixPath.StartsWith((Join-Path $target 'runtime') + ';')) 'Tandix must receive the permanent Node path.'
    $npmArgs = Get-Content -Raw -LiteralPath (Join-Path $target 'app\npm-installed.json')
    Assert-True ($npmArgs -eq '["ci","--include=optional","--ignore-scripts","--no-audit","--no-fund"]') 'Wrong dependency installation arguments.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $target 'data'))) '-NoStart must not launch the application.'
    $launcher = Join-Path $target 'Start StudyTrail.cmd'
    & $launcher --port 8768
    Assert-True ($LASTEXITCODE -eq 0) 'Launcher failed.'
    $started = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'data\started.json') | ConvertFrom-Json
    Assert-True ($started[0] -eq '--data-dir' -and $started[1] -eq (Join-Path $target 'data') -and $started[3] -eq '8768') 'Wrong launch arguments.'
    $downloads = $global:StudyTrailInstallerDownloadCount
    Write-Fixture (Join-Path $target 'data\private-record') 'keep this'
    & $installer -InstallDir $target -NoStart
    Assert-True ($downloads -eq $global:StudyTrailInstallerDownloadCount) 'Rerun must not download or upgrade.'
    Assert-True ($global:StudyTrailInstallerTandixCount -eq 1) 'Rerun must not repeat a completed Tandix setup.'
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $target 'data\private-record')) -eq 'keep this') 'User data was changed.'
    & $installer -InstallDir $target
    $originalPath = $env:PATH
    $env:STUDYTRAIL_TEST_FAIL_TANDIX = '1'
    try { Assert-Fails { & $installer -InstallDir $target -NoStart -RepairTandix } }
    finally { Remove-Item Env:\STUDYTRAIL_TEST_FAIL_TANDIX }
    Assert-True ($env:PATH -eq $originalPath) 'Child wizard PATH must be restored after failure.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $target '.tandix-setup-v1'))) 'Failed repair must not keep the success marker.'
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $target 'data\private-record')) -eq 'keep this') 'Tandix failure must preserve personal data.'
    & $installer -InstallDir $target -NoStart
    Assert-True (Test-Path -LiteralPath (Join-Path $target '.tandix-setup-v1')) 'Tandix setup must retry without -RepairTandix after failure.'
    $failedFresh = Join-Path $root 'incomplete-tandix'
    $env:STUDYTRAIL_TEST_FAIL_TANDIX = '1'
    try { Assert-Fails { & $installer -InstallDir $failedFresh } }
    finally { Remove-Item Env:\STUDYTRAIL_TEST_FAIL_TANDIX }
    Assert-True (Test-Path -LiteralPath (Join-Path $failedFresh '.studytrail-installer-v1')) 'Failed Tandix setup must preserve the installed application.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $failedFresh 'data\started.json'))) 'Failed setup must not launch StudyTrail.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $failedFresh '.tandix-setup-v1'))) 'Failed setup must not be marked successful.'
    & $installer -InstallDir $failedFresh -NoStart
    $skipped = Join-Path $root 'skip-ai'
    $beforeSkip = $global:StudyTrailInstallerTandixCount
    & $installer -InstallDir $skipped -NoStart -SkipTandix
    Assert-True ($beforeSkip -eq $global:StudyTrailInstallerTandixCount) 'Explicit opt-out should not run Tandix.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $skipped '.tandix-setup-v1'))) 'Skipped setup must not be marked complete.'
    & $installer -InstallDir $skipped -NoStart
    Assert-True (Test-Path -LiteralPath (Join-Path $skipped '.tandix-setup-v1')) 'Skipped Tandix must be installable by rerunning.'
    $occupied = Join-Path $root 'unmanaged'
    Write-Fixture (Join-Path $occupied 'important') 'untouched'
    Assert-Fails { & $installer -InstallDir $occupied -NoStart }
    Assert-True ((Get-Content -Raw -LiteralPath (Join-Path $occupied 'important')) -eq 'untouched') 'Unmanaged files were changed.'
    foreach ($failure in @('STUDYTRAIL_TEST_BAD_HASH', 'STUDYTRAIL_TEST_FAIL_NPM')) {
        $failedTarget = Join-Path $root $failure
        [Environment]::SetEnvironmentVariable($failure, '1', 'Process')
        try { Assert-Fails { & $installer -InstallDir $failedTarget -NoStart } }
        finally { [Environment]::SetEnvironmentVariable($failure, $null, 'Process') }
        Assert-True (-not (Test-Path -LiteralPath $failedTarget)) 'Failed installation was published.'
        Assert-True (-not (Test-Path -LiteralPath "$failedTarget.install-lock")) 'Lock not cleaned after failure.'
    }
    $locked = Join-Path $root 'locked'
    Write-Fixture "$locked.install-lock" 'owned by another process'
    Assert-Fails { & $installer -InstallDir $locked -NoStart }
    Assert-True (Test-Path -LiteralPath "$locked.install-lock") 'Another installer lock was removed.'
    Assert-True (@(Get-ChildItem -LiteralPath $root -Filter '.studytrail-install-*' -Directory).Count -eq 0) 'Temporary installation leaked.'
    Write-Host 'Windows installer: fresh install, official Tandix handoff, Codex selection, permanent runtime, skip/repair/retry, data preservation, failures and locks passed.'
} finally {
    Remove-Item Function:\Invoke-WebRequest -ErrorAction SilentlyContinue
    Remove-Item Function:\powershell.exe -ErrorAction SilentlyContinue
    Remove-Variable -Name 'StudyTrailInstaller*' -Scope Global -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
