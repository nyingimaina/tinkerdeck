# Publishes the current version as a GitHub release, including the signed update manifest that makes
# installed copies offer the update. Run after `npm run installer` (which also signs).
#
#   powershell -File scripts/publish-release.ps1            # publishes v<version> from package.json
#
# Needs: gh signed in (gh auth login), the signing key (scripts/new-update-key.mjs), a pushed tag.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$ver = (Get-Content package.json -Raw | ConvertFrom-Json).version
$out = "installer\output"
$exe = "$out\Tinkerdeck-Setup-$ver.exe"
foreach ($f in @($exe, "$out\latest.json", "$out\latest.json.sig")) {
  if (-not (Test-Path $f)) { throw "Missing $f. Run: npm run installer" }
}

# the manifest must describe exactly this installer
$m = Get-Content "$out\latest.json" -Raw | ConvertFrom-Json
if ($m.version -ne $ver) { throw "latest.json is for $($m.version), not $ver. Re-run: npm run installer" }
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
if ($m.sha256 -ne $sha) { throw "latest.json does not match the installer on disk. Re-run: npm run installer" }

# release notes = this version's section of CHANGELOG.md
$log = Get-Content CHANGELOG.md -Raw
if ($log -match "(?ms)^## $([regex]::Escape($ver))\r?\n(.*?)(?=^## |\z)") { $notes = $Matches[1].Trim() } else { $notes = "Tinkerdeck $ver" }
$notesFile = "$out\RELEASE-NOTES-$ver.md"
Set-Content $notesFile ($notes + "`n`n**SHA-256:** ``$sha```n") -Encoding UTF8

"$sha  Tinkerdeck-Setup-$ver.exe" | Set-Content "$out\Tinkerdeck-Setup-$ver.exe.sha256" -Encoding ASCII

git rev-parse "v$ver" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Tag v$ver does not exist. Create and push it first: git tag -a v$ver -m 'Tinkerdeck $ver'; git push origin v$ver" }

gh release create "v$ver" $exe "$out\Tinkerdeck-Setup-$ver.exe.sha256" "$out\latest.json" "$out\latest.json.sig" `
  --title "Tinkerdeck $ver" --notes-file $notesFile --verify-tag
if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
Write-Host "Published v$ver. Installed copies will offer the update within an hour (or at once with 'Check now')."
