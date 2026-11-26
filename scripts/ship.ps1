<#
.SYNOPSIS
  Interactive release helper: bump the version, build the installer, commit, push and release.

.DESCRIPTION
  Run it with no arguments. It asks up front whether to do each of the five actions (bump, build,
  commit, push, release), shows the plan, and then performs the chosen ones in bulk, always in this
  order: bump, build, commit, push, release. Each one is a standalone choice (for example "release"
  alone publishes an installer that is already built).

  Give any action switch to skip the questions (for scripts):
    scripts\ship.ps1 -Bump minor -Build -Commit -Push -Release -Yes

.PARAMETER Bump     patch, minor, major or an explicit X.Y.Z (selects the bump action)
.PARAMETER Build    build and sign the installer (npm run installer)
.PARAMETER Commit   git add -A and commit
.PARAMETER Push     push the current branch to its upstream
.PARAMETER Release  tag v<version>, push the tag, publish the GitHub release
.PARAMETER Message  commit message (default "Tinkerdeck <version>")
.PARAMETER LegacyUrl     keep the old lite-commander download address in the update manifest (while 1.x installs exist)
.PARAMETER NoLegacyUrl   use the current repository address
.PARAMETER Yes      do not ask for the final confirmation
.PARAMETER DryRun   show what would happen and change nothing
.PARAMETER Root     the project folder (default: the folder above this script)
#>
param(
  [string]$Root,
  [string]$Bump,
  [switch]$Build,
  [switch]$Commit,
  [switch]$Push,
  [switch]$Release,
  [string]$Message,
  [switch]$LegacyUrl,
  [switch]$NoLegacyUrl,
  [switch]$Yes,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$LEGACY_REPO_URL = "https://github.com/nyingimaina/lite-commander/releases/download"

# ------------------------------------------------------------------ pure helpers (tested in ship.tests.ps1)

function Get-CurrentVersion([string]$root) {
  $text = [IO.File]::ReadAllText((Join-Path $root "package.json"))
  $m = [regex]::Match($text, '"version"\s*:\s*"(\d+\.\d+\.\d+)"')
  if (-not $m.Success) { throw "Could not read the version from package.json." }
  return $m.Groups[1].Value
}

function Get-NextVersion([string]$current, [string]$spec) {
  if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw "The current version '$current' is not X.Y.Z." }
  $maj = [int]$Matches[1]; $min = [int]$Matches[2]; $pat = [int]$Matches[3]
  switch ($spec.Trim().ToLower()) {
    "patch" { return "$maj.$min.$($pat + 1)" }
    "minor" { return "$maj.$($min + 1).0" }
    "major" { return "$($maj + 1).0.0" }
    default {
      if ($spec.Trim() -notmatch '^\d+\.\d+\.\d+$') { throw "'$spec' is not patch, minor, major or a version like 1.2.3." }
      return $spec.Trim()
    }
  }
}

function Set-FirstMatches([string]$path, [string]$pattern, [string]$replacement, [int]$count) {
  if (-not (Test-Path $path)) { return $false }
  $text = [IO.File]::ReadAllText($path)
  $re = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  $new = $re.Replace($text, $replacement, $count)
  if ($new -eq $text) { return $false }
  [IO.File]::WriteAllText($path, $new, (New-Object System.Text.UTF8Encoding($false)))
  return $true
}

# Writes the new version into every file that carries it, whatever each one currently says.
# Returns the names of the files that changed.
function Set-ProjectVersion([string]$root, [string]$new) {
  $semver = '\d+\.\d+\.\d+'
  $changed = @()
  $jobs = @(
    @{ f = "package.json";              p = "(`"version`"\s*:\s*`")$semver(`")";   r = "`${1}$new`${2}"; n = 1 },
    @{ f = "package-lock.json";         p = "(`"version`"\s*:\s*`")$semver(`")";   r = "`${1}$new`${2}"; n = 2 },
    @{ f = "src-tauri\tauri.conf.json"; p = "(`"version`"\s*:\s*`")$semver(`")";   r = "`${1}$new`${2}"; n = 1 },
    @{ f = "src-tauri\Cargo.toml";      p = "^(version\s*=\s*`")$semver(`")";      r = "`${1}$new`${2}"; n = 1 },
    @{ f = "mcp\server.json";           p = "(`"version`"\s*:\s*`")$semver(`")";   r = "`${1}$new`${2}"; n = 1 },
    @{ f = "mcp\server.json";           p = "v$semver/Tinkerdeck-Setup-$semver";    r = "v$new/Tinkerdeck-Setup-$new"; n = 1 },
    @{ f = "installer\tinkerdeck.iss";  p = "(#define AppVersion `")$semver(`")";    r = "`${1}$new`${2}"; n = 1 },
    @{ f = "README.md";                 p = "Tinkerdeck-Setup-$semver\.exe";        r = "Tinkerdeck-Setup-$new.exe"; n = 5 }
  )
  foreach ($j in $jobs) {
    if ((Set-FirstMatches (Join-Path $root $j.f) $j.p $j.r $j.n) -and ($changed -notcontains $j.f)) { $changed += $j.f }
  }
  return $changed
}

function Test-Changelog([string]$root, [string]$version) {
  $p = Join-Path $root "CHANGELOG.md"
  if (-not (Test-Path $p)) { return $false }
  return [bool]([regex]::IsMatch([IO.File]::ReadAllText($p), "(?m)^## $([regex]::Escape($version))\s*$"))
}

# "origin/main" + "master" -> push the current branch to main; no upstream -> create it.
function Get-PushTarget([string]$upstream, [string]$branch) {
  if ($upstream -and $upstream -match '^([^/]+)/(.+)$') { return "$($Matches[1]) HEAD:$($Matches[2])" }
  return "-u origin $branch"
}

# ------------------------------------------------------------------ interaction

function Ask-YesNo([string]$question, [bool]$default) {
  $hint = if ($default) { "[Y/n]" } else { "[y/N]" }
  while ($true) {
    $a = (Read-Host "$question $hint").Trim().ToLower()
    if ($a -eq "") { return $default }
    if ($a -in @("y", "yes")) { return $true }
    if ($a -in @("n", "no")) { return $false }
    Write-Host "  Please answer y or n."
  }
}

function Say([string]$text, [string]$colour = "Gray") { Write-Host $text -ForegroundColor $colour }

function Invoke-Native([string]$what, [scriptblock]$block) {
  & $block
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}

# ------------------------------------------------------------------ the run

function Invoke-Ship {
  if (-not $Root) { $script:Root = Split-Path -Parent $PSScriptRoot }
  Set-Location $Root
  $current = Get-CurrentVersion $Root
  $interactive = -not ($Bump -or $Build -or $Commit -or $Push -or $Release)

  Say "Tinkerdeck ship  (version $current, folder $Root)" "Cyan"
  if ($DryRun) { Say "DRY RUN: nothing will be changed." "Yellow" }
  Say ""

  # ---- 1. ask everything up front
  $doBump = [bool]$Bump; $doBuild = [bool]$Build; $doCommit = [bool]$Commit; $doPush = [bool]$Push; $doRelease = [bool]$Release
  $target = $current
  $legacy = [bool]$LegacyUrl
  $msg = $Message

  if ($interactive) {
    Say "Choose what to do. Each is separate; the chosen ones then run together in this order:" "Cyan"
    Say "  bump version, build installer, commit, push, release" "DarkGray"
    Say ""
    $doBump = Ask-YesNo "1. Bump the version?" $false
    if ($doBump) {
      $p = Get-NextVersion $current "patch"; $mi = Get-NextVersion $current "minor"; $ma = Get-NextVersion $current "major"
      while ($true) {
        $pick = (Read-Host "     Which? [1] patch -> $p   [2] minor -> $mi   [3] major -> $ma   or type a version (Enter = 1)").Trim()
        $spec = switch ($pick) { "" { "patch" } "1" { "patch" } "2" { "minor" } "3" { "major" } default { $pick } }
        try { $target = Get-NextVersion $current $spec; break } catch { Say "     $($_.Exception.Message)" "Red" }
      }
    }
    $doBuild = Ask-YesNo "2. Build the signed installer?" $false
    if ($doBuild) {
      $legacy = Ask-YesNo "     Keep the old lite-commander download address in the update manifest (needed while 1.x installs exist)?" $true
    }
    $doCommit = Ask-YesNo "3. Commit all changes?" $false
    if ($doCommit -and -not $msg) {
      $default = "Tinkerdeck $target"
      $entered = Read-Host "     Commit message (Enter = '$default')"
      $msg = if ($entered.Trim()) { $entered.Trim() } else { $default }
    }
    $doPush = Ask-YesNo "4. Push the branch?" $false
    $doRelease = Ask-YesNo "5. Release (tag, push the tag, publish the GitHub release)?" $false
  } else {
    if ($Bump) { $target = Get-NextVersion $current $Bump }
    if ($NoLegacyUrl) { $legacy = $false }
  }

  if ($doBump -and $target -eq $current) { throw "The new version is the same as the current one ($current)." }
  $version = if ($doBump) { $target } else { $current }
  if ($doCommit -and -not $msg) { $msg = "Tinkerdeck $version" }

  if (-not ($doBump -or $doBuild -or $doCommit -or $doPush -or $doRelease)) { Say "Nothing chosen. Nothing to do." "Yellow"; return }

  # ---- 2. the plan and the checks that should stop us before anything changes
  Say ""
  Say "Plan:" "Cyan"
  $n = 0
  if ($doBump)    { $n++; Say "  $n. Bump the version $current -> $version" }
  if ($doBuild)   { $n++; Say "  $n. Build and sign the installer for $version$(if ($legacy) { ' (old lite-commander download address kept in the manifest)' })" }
  if ($doCommit)  { $n++; Say "  $n. Commit all changes: `"$msg`"" }
  if ($doPush)    { $n++; Say "  $n. Push the current branch" }
  if ($doRelease) { $n++; Say "  $n. Release v${version}: tag, push the tag, publish on GitHub" }
  Say ""

  $problems = @(); $warnings = @()
  if (($doBuild -or $doRelease) -and -not (Test-Changelog $Root $version)) {
    $warnings += "CHANGELOG.md has no '## $version' section, so the update notes will be empty. Add it first if you can."
  }
  $installer = Join-Path $Root "installer\output\Tinkerdeck-Setup-$version.exe"
  if ($doRelease -and -not $doBuild -and -not (Test-Path $installer)) {
    $problems += "Release needs the installer for $version, but $installer does not exist. Choose 'Build' too."
  }
  if ($doRelease) {
    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) { $problems += "Release needs the GitHub CLI signed in. Run: gh auth login" }
  }
  if ($doRelease -and -not $doCommit) {
    $dirty = @(& git status --porcelain).Count
    if ($dirty -gt 0) { $warnings += "There are $dirty uncommitted change(s) and 'Commit' is not chosen: the tag will point at the last commit, without them." }
  }
  if ($doRelease -and -not $doPush) {
    $warnings += "'Push' is not chosen: pushing the tag also uploads the commits it points to."
  }
  foreach ($w in $warnings) { Say "  warning: $w" "Yellow" }
  foreach ($p in $problems) { Say "  problem: $p" "Red" }
  if ($problems.Count -gt 0) { throw "Fix the problem(s) above and run again. Nothing was changed." }
  if ($warnings.Count -gt 0 -or $problems.Count -gt 0) { Say "" }

  if ($DryRun) { Say "Dry run finished. Nothing was changed." "Yellow"; return }
  if (-not $Yes) {
    if (-not (Ask-YesNo "Go ahead with the plan?" $true)) { Say "Cancelled. Nothing was changed." "Yellow"; return }
  }

  # ---- 3. do it, in order
  $done = @()
  if ($doBump) {
    Say "`n[bump] $current -> $version" "Cyan"
    $files = Set-ProjectVersion $Root $version
    if (@($files).Count -eq 0) { throw "No version file needed changing; are you in the right folder?" }
    Say "  updated: $($files -join ', ')"
    try { & cargo metadata --format-version 1 --manifest-path (Join-Path $Root "src-tauri\Cargo.toml") *> $null } catch { }
    $done += "bumped to $version"
  }

  if ($doBuild) {
    Say "`n[build] npm run installer" "Cyan"
    if ($legacy) { $env:TD_RELEASE_URL_BASE = "$LEGACY_REPO_URL/v$version" } else { Remove-Item Env:\TD_RELEASE_URL_BASE -ErrorAction SilentlyContinue }
    try { Invoke-Native "The build" { & npm run installer } } finally { Remove-Item Env:\TD_RELEASE_URL_BASE -ErrorAction SilentlyContinue }
    $m = Get-Content (Join-Path $Root "installer\output\latest.json") -Raw | ConvertFrom-Json
    if ($m.version -ne $version) { throw "The build produced version $($m.version), expected $version." }
    Say "  built and signed: $installer"
    $done += "built $version"
  }

  if ($doCommit) {
    Say "`n[commit]" "Cyan"
    Invoke-Native "git add" { & git add -A }
    $staged = @(& git diff --cached --name-only)
    if ($staged.Count -eq 0) { Say "  nothing to commit" "Yellow" }
    else {
      $bad = @($staged | Where-Object { $_ -match 'installer/output|\.key$|\.exe$|\.buf$|update-signing' })
      if ($bad.Count -gt 0) { & git reset -q; throw "Refusing to commit: $($bad -join ', ') looks like a build output or key. Nothing was committed." }
      if ((& git diff --cached) -match 'BEGIN (EC |RSA |OPENSSH )?PRIVATE KEY') { & git reset -q; throw "Refusing to commit: the changes contain private key material." }
      $f = Join-Path ([IO.Path]::GetTempPath()) ("ship-msg-" + [guid]::NewGuid().ToString("N") + ".txt")
      [IO.File]::WriteAllText($f, $msg + "`n", (New-Object System.Text.UTF8Encoding($false)))
      try { Invoke-Native "git commit" { & git commit -q -F $f } } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
      Say "  committed $($staged.Count) file(s): $(& git log --oneline -1)"
      $done += "committed"
    }
  }

  if ($doPush) {
    Say "`n[push]" "Cyan"
    $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
    $upstream = (& git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null)
    if ($LASTEXITCODE -ne 0) { $upstream = "" }
    $args = (Get-PushTarget "$upstream".Trim() $branch) -split ' '
    Invoke-Native "git push" { & git push @args }
    $done += "pushed"
  }

  if ($doRelease) {
    Say "`n[release] v$version" "Cyan"
    $tag = "v$version"
    & git rev-parse -q --verify "refs/tags/$tag" *> $null
    if ($LASTEXITCODE -ne 0) { Invoke-Native "git tag" { & git tag -a $tag -m "Tinkerdeck $version" }; Say "  created tag $tag" }
    else { Say "  tag $tag already exists" }
    Invoke-Native "pushing the tag" { & git push origin $tag }
    Invoke-Native "publishing the release" { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\publish-release.ps1") }
    $done += "released $tag"
  }

  Say ""
  Say "Done: $($done -join '; ')." "Green"
}

if ($MyInvocation.InvocationName -ne ".") { Invoke-Ship }
