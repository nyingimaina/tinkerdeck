# Tests for scripts/ship.ps1 (no framework needed):  powershell -File scripts/ship.tests.ps1
# Exits non-zero when anything fails.
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\ship.ps1"

$script:failed = 0
function Check($name, $ok) {
  if ($ok) { Write-Host "  ok   $name" } else { Write-Host "  FAIL $name" -ForegroundColor Red; $script:failed++ }
}
function Throws($block) { try { & $block; return $false } catch { return $true } }

Write-Host "Get-NextVersion"
Check "patch"          ((Get-NextVersion "1.2.3" "patch") -eq "1.2.4")
Check "minor resets patch" ((Get-NextVersion "1.2.3" "minor") -eq "1.3.0")
Check "major resets both"  ((Get-NextVersion "1.2.3" "major") -eq "2.0.0")
Check "explicit version"   ((Get-NextVersion "1.2.3" "3.4.5") -eq "3.4.5")
Check "explicit may be lower" ((Get-NextVersion "2.0.0" "1.9.9") -eq "1.9.9")
Check "rejects nonsense"   (Throws { Get-NextVersion "1.2.3" "abc" })
Check "rejects two parts"  (Throws { Get-NextVersion "1.2.3" "1.2" })
Check "rejects a bad current version" (Throws { Get-NextVersion "x" "patch" })

Write-Host "Set-ProjectVersion"
$root = Join-Path ([IO.Path]::GetTempPath()) ("ship-test-" + [guid]::NewGuid().ToString("N"))
foreach ($d in "src-tauri", "mcp", "installer") { New-Item -ItemType Directory -Force (Join-Path $root $d) | Out-Null }
function Put($rel, $text) { [IO.File]::WriteAllText((Join-Path $root $rel), $text, (New-Object Text.UTF8Encoding($false))) }
function Get-Text($rel) { [IO.File]::ReadAllText((Join-Path $root $rel)) }
Put "package.json" "{`n  `"name`": `"x`",`n  `"version`": `"1.2.3`",`n  `"dependencies`": { `"a`": `"^1.2.3`" }`n}`n"
Put "package-lock.json" "{`n  `"name`": `"x`",`n  `"version`": `"1.2.3`",`n  `"packages`": {`n    `"`": {`n      `"name`": `"x`",`n      `"version`": `"1.2.3`"`n    },`n    `"node_modules/dep`": {`n      `"version`": `"1.2.3`"`n    }`n  }`n}`n"
Put "src-tauri\tauri.conf.json" "{`n  `"productName`": `"X`",`n  `"version`": `"1.2.3`"`n}`n"
Put "src-tauri\Cargo.toml" "[package]`nname = `"x`"`nversion = `"1.2.3`"`n`n[dependencies]`nfoo = { version = `"1.2.3`" }`n"
Put "mcp\server.json" "{`n  `"version`": `"1.2.3`",`n  `"identifier`": `"https://github.com/o/r/releases/download/v1.2.3/Tinkerdeck-Setup-1.2.3.exe`"`n}`n"
Put "installer\tinkerdeck.iss" "#define AppName `"X`"`n#define AppVersion `"1.2.0`"`n"  # deliberately not in step with the rest
Put "README.md" "Run installer\output\Tinkerdeck-Setup-1.2.3.exe now. Needs Node 1.2.3+.`n"

$changed = Set-ProjectVersion $root "1.3.0"
Check "reports all seven files" (@($changed).Count -eq 7)
Check "package.json"       ((Get-Text "package.json") -match '"version": "1\.3\.0"')
Check "dependency ranges are left alone" ((Get-Text "package.json") -match '"\^1\.2\.3"')
$lock = Get-Text "package-lock.json"
Check "lock: both root versions"  (([regex]::Matches($lock, '"version": "1\.3\.0"')).Count -eq 2)
Check "lock: other packages untouched" ($lock -match 'node_modules/dep[^}]*"version": "1\.2\.3"')
Check "tauri.conf.json"    ((Get-Text "src-tauri\tauri.conf.json") -match '"version": "1\.3\.0"')
$cargo = Get-Text "src-tauri\Cargo.toml"
Check "Cargo.toml package version" ($cargo -match '(?m)^version = "1\.3\.0"')
Check "Cargo.toml dependency untouched" ($cargo -match 'foo = \{ version = "1\.2\.3" \}')
$mcp = Get-Text "mcp\server.json"
Check "server.json version" ($mcp -match '"version": "1\.3\.0"')
Check "server.json download address" ($mcp -match 'v1\.3\.0/Tinkerdeck-Setup-1\.3\.0\.exe')
Check "installer script, even though it said something else" ((Get-Text "installer\tinkerdeck.iss") -match '#define AppVersion "1\.3\.0"')
$readme = Get-Text "README.md"
Check "README installer name" ($readme -match 'Tinkerdeck-Setup-1\.3\.0\.exe')
Check "README other numbers untouched" ($readme -match 'Node 1\.2\.3\+')
Check "files keep no byte order mark" (([IO.File]::ReadAllBytes((Join-Path $root "package.json")))[0] -eq 123)

$again = Set-ProjectVersion $root "1.3.0"
Check "running it again changes nothing" (@($again).Count -eq 0)
$next = Set-ProjectVersion $root "1.3.1"
Check "a later bump updates them all again" (@($next).Count -eq 7)

Write-Host "Test-Changelog"
Put "CHANGELOG.md" "# Changelog`n`n## 1.3.0`n- thing`n`n## 1.2.3`n- old`n"
Check "finds the section"     (Test-Changelog $root "1.3.0")
Check "missing section"       (-not (Test-Changelog $root "1.4.0"))
Check "does not match a prefix" (-not (Test-Changelog $root "1.3"))
Remove-Item (Join-Path $root "CHANGELOG.md")
Check "no changelog at all"   (-not (Test-Changelog $root "1.3.0"))

Write-Host "Get-PushTarget"
Check "an upstream with another branch name" ((Get-PushTarget "origin/main" "master") -eq "origin HEAD:main")
Check "no upstream: same name, set tracking" ((Get-PushTarget "" "feature") -eq "-u origin feature")

Remove-Item $root -Recurse -Force
if ($script:failed -gt 0) { Write-Host "`n$($script:failed) failed" -ForegroundColor Red; exit 1 }
Write-Host "`nall passed"
