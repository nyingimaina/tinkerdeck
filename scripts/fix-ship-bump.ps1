<#
.SYNOPSIS
  Runs scripts\fix_ship_bump.py (the one-off patch that makes ship.ps1 set the version everywhere).

.DESCRIPTION
  Finds a Python 3 that really runs (the "py" launcher, "python" or "python3"; one that is listed but
  cannot be started is skipped), runs the patch with it, and passes its exit code on. Safe to run
  twice: the patch says "already applied" and changes nothing.

    powershell -File scripts\fix-ship-bump.ps1
#>
$ErrorActionPreference = "Stop"

$patch = Join-Path $PSScriptRoot "fix_ship_bump.py"
if (-not (Test-Path $patch)) { throw "Cannot find $patch next to this script." }

# Does this interpreter start and report Python 3? (The py launcher can point at an install we may not run.)
function Test-Python($candidate) {
  if (-not (Get-Command $candidate[0] -ErrorAction SilentlyContinue)) { return $false }
  $extra = @()
  if ($candidate.Count -gt 1) { $extra += $candidate[1..($candidate.Count - 1)] }
  try {
    $out = & $candidate[0] @extra -c "import sys; print(sys.version_info[0])" 2>$null
    return ($LASTEXITCODE -eq 0 -and "$out".Trim() -eq "3")
  } catch { return $false }
}

$python = $null
foreach ($candidate in @(@("py", "-3"), @("python"), @("python3"))) {
  if (Test-Python $candidate) { $python = $candidate; break }
}
if (-not $python) { throw "No working Python 3 was found. Install it from https://www.python.org/downloads/ or the Microsoft Store, then run this again." }

$pyArgs = @()
if ($python.Count -gt 1) { $pyArgs += $python[1..($python.Count - 1)] }
$pyArgs += @("-I", $patch)   # -I: ignore PYTHON* variables and the current folder, so only the patch itself runs

& $python[0] @pyArgs
exit $LASTEXITCODE
