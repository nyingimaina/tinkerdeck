# Builds the release exe, regenerates icons, then compiles the Inno Setup installer.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

Write-Host "==> icons"
node scripts/make-icons.mjs
if ($LASTEXITCODE -ne 0) { throw "icon generation failed" }

Write-Host "==> release build (tauri build, no bundle)"
npx tauri build --no-bundle
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

Write-Host "==> tdk (command line and MCP)"
cargo build --release --manifest-path src-tauri/Cargo.toml --bin tdk
if ($LASTEXITCODE -ne 0) { throw "tdk build failed" }

$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6 (ISCC.exe) not found" }

Write-Host "==> installer"
& $iscc "installer\tinkerdeck.iss"
if ($LASTEXITCODE -ne 0) { throw "ISCC failed" }
Write-Host "==> sign the update manifest"
$key = if ($env:TD_UPDATE_KEY_FILE) { $env:TD_UPDATE_KEY_FILE } else { "$env:USERPROFILE\.lite-commander\update-signing.key" }
if (Test-Path $key) {
  $ver = (Get-Content package.json -Raw | ConvertFrom-Json).version
  node scripts/sign-release.mjs "installer\output\RELEASE-NOTES-$ver.md"
  if ($LASTEXITCODE -ne 0) { throw "signing failed" }
} else {
  Write-Host "No signing key at ${key}: skipping latest.json (run node scripts/new-update-key.mjs)."
}
Get-ChildItem installer\output\*.exe | ForEach-Object { Write-Host "Built $($_.FullName) ($([math]::Round($_.Length/1MB,1)) MB)" }
