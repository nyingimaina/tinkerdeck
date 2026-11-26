"""One-off patch for scripts/ship.ps1: make the version bump set the version everywhere, whatever each
file currently says (the installer script once disagreed with the rest, so a "replace the old version"
bump missed it). Run it through scripts/fix-ship-bump.ps1. Safe to run twice: it says so and stops
when the fix is already in.
"""
import sys
from pathlib import Path

base = Path(__file__).resolve().parent
ship = base / "ship.ps1"
tests = base / "ship.tests.ps1"

s = ship.read_text(encoding="utf-8")
if "whatever each one currently says" in s:
    print("already applied: ship.ps1 already sets the version everywhere. Nothing to do.")
    sys.exit(0)

# ---- tests first
t = tests.read_text(encoding="utf-8")
t = t.replace(
    'Put "installer\\tinkerdeck.iss" "#define AppName `"X`"`n#define AppVersion `"1.2.3`"`n"',
    'Put "installer\\tinkerdeck.iss" "#define AppName `"X`"`n#define AppVersion `"1.2.0`"`n"  # deliberately not in step with the rest',
)
t = t.replace('$changed = Set-ProjectVersion $root "1.2.3" "1.3.0"', '$changed = Set-ProjectVersion $root "1.3.0"')
old_missing = '''$missing = Set-ProjectVersion $root "9.9.9" "9.9.10"
Check "a version that is not there changes nothing" (@($missing).Count -eq 0)'''
new_missing = '''$again = Set-ProjectVersion $root "1.3.0"
Check "running it again changes nothing" (@($again).Count -eq 0)
$next = Set-ProjectVersion $root "1.3.1"
Check "a later bump updates them all again" (@($next).Count -eq 7)'''
if old_missing not in t:
    sys.exit("ship.tests.ps1 is not in the shape this patch expects; nothing was changed.")
tests.write_text(t.replace(old_missing, new_missing), encoding="utf-8", newline="\n")

# ---- implementation
start = s.index("# Writes the new version into every file that carries it.")
end = s.index("function Test-Changelog")
new_fn = '''# Writes the new version into every file that carries it, whatever each one currently says.
# Returns the names of the files that changed.
function Set-ProjectVersion([string]$root, [string]$new) {
  $semver = '\\d+\\.\\d+\\.\\d+'
  $changed = @()
  $jobs = @(
    @{ f = "package.json";              p = "(`"version`"\\s*:\\s*`")$semver(`")";   r = "`${1}$new`${2}"; n = 1 },
    @{ f = "package-lock.json";         p = "(`"version`"\\s*:\\s*`")$semver(`")";   r = "`${1}$new`${2}"; n = 2 },
    @{ f = "src-tauri\\tauri.conf.json"; p = "(`"version`"\\s*:\\s*`")$semver(`")";   r = "`${1}$new`${2}"; n = 1 },
    @{ f = "src-tauri\\Cargo.toml";      p = "^(version\\s*=\\s*`")$semver(`")";      r = "`${1}$new`${2}"; n = 1 },
    @{ f = "mcp\\server.json";           p = "(`"version`"\\s*:\\s*`")$semver(`")";   r = "`${1}$new`${2}"; n = 1 },
    @{ f = "mcp\\server.json";           p = "v$semver/Tinkerdeck-Setup-$semver";    r = "v$new/Tinkerdeck-Setup-$new"; n = 1 },
    @{ f = "installer\\tinkerdeck.iss";  p = "(#define AppVersion `")$semver(`")";    r = "`${1}$new`${2}"; n = 1 },
    @{ f = "README.md";                 p = "Tinkerdeck-Setup-$semver\\.exe";        r = "Tinkerdeck-Setup-$new.exe"; n = 5 }
  )
  foreach ($j in $jobs) {
    if ((Set-FirstMatches (Join-Path $root $j.f) $j.p $j.r $j.n) -and ($changed -notcontains $j.f)) { $changed += $j.f }
  }
  return $changed
}

'''
s = s[:start] + new_fn + s[end:]
s = s.replace(
    '$files = Set-ProjectVersion $Root $current $version\n    if (@($files).Count -eq 0) { throw "No version file contained $current." }',
    '$files = Set-ProjectVersion $Root $version\n    if (@($files).Count -eq 0) { throw "No version file needed changing; are you in the right folder?" }',
)
ship.write_text(s, encoding="utf-8", newline="\n")
print("applied: ship.ps1 and ship.tests.ps1 updated.")
