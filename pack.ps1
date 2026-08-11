<#
  Builds mealmap-site.zip - the archive attached to a GitHub release.

  The archive is the app only: the 20-odd files a web server needs, without the
  tests, docs, licence or this script. Assembling it by hand is what it replaces,
  and the reason it exists is that two of the steps are quietly easy to get wrong:

  1. Compress-Archive (Windows PowerShell 5.1) writes BACKSLASHES into the zip's
     entry names. Windows opens such a file fine, so the mistake is invisible
     here - but unzip on macOS and Linux takes the whole name literally and drops
     a file called "css\app.css" in the top directory. Every server this archive
     is meant for is one of those. So the entries are written by hand below.
  2. The file list is derived from globs, never hardcoded. 1.1.0 added js/qr.js,
     and a hand-kept list is exactly how a new script gets left out of a release
     while every test here keeps passing.

  Deliberately ASCII-only: PowerShell 5.1 reads a .ps1 as the system codepage
  unless it carries a UTF-8 BOM, and the repo is LF-and-no-BOM (.gitattributes).
  An em dash in a string is enough to make it a parse error on someone's machine.

  Run it from anywhere:  ./pack.ps1
  Then:  gh release create vX.Y.Z mealmap-site.zip --title "MealMap X.Y.Z" --notes-file notes.md

  Dependency-free on purpose, like serve.js - no npm, no modules, works offline.
#>
[CmdletBinding()]
param(
  # Where to write the archive. Default sits in the repo root, which .gitignore already covers.
  [string]$Output,
  # Pack a dirty working tree anyway. Off by default: a release built from files
  # that are not in the commit it claims to be is the worst kind of wrong.
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $Output) { $Output = Join-Path $root 'mealmap-site.zip' }

$BACKSLASH = [string][char]92

# What ships. Globs, so a new js/ or css/ file is picked up without touching this
# list; the READMEs in lib/ and fonts/ stay out by being neither .min.js nor .woff2.
$PATTERNS = @(
  'index.html',
  '.htaccess',
  'css/*.css',
  'js/*.js',
  'lib/*.min.js',
  'fonts/*.woff2'
)

function Fail($msg) { Write-Host "pack: $msg" -ForegroundColor Red; exit 1 }
function Note($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }

# ---- what are we packing -----------------------------------------------------
Push-Location $root
try {
  $dirty = git status --porcelain
  $head  = (git rev-parse --short HEAD).Trim()
  $tag   = (git tag --points-at HEAD | Select-Object -First 1)
} finally { Pop-Location }

if ($dirty -and -not $Force) {
  Write-Host "pack: the working tree has uncommitted changes:" -ForegroundColor Yellow
  $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
  Fail "refusing to build a release from it. Commit first, or re-run with -Force."
}

if ($tag) { Write-Host "Packing $tag ($head)" } else { Write-Host "Packing $head (no tag on HEAD)" }
if ($dirty) { Write-Host "  ...with uncommitted changes, because -Force" -ForegroundColor Yellow }

# ---- collect -----------------------------------------------------------------
$files = @()
foreach ($p in $PATTERNS) {
  $matched = @(Get-ChildItem -Path (Join-Path $root ($p -replace '/', $BACKSLASH)) -File -Force -ErrorAction SilentlyContinue)
  if ($matched.Count -eq 0) { Fail "nothing matched '$p' - has the layout changed?" }
  $files += $matched
}
$files = $files | Sort-Object FullName

# Everything shipped should be committed, or the archive carries something no
# checkout of this tag can reproduce.
Push-Location $root
try { $tracked = @{}; (git ls-files) | ForEach-Object { $tracked[$_] = $true } } finally { Pop-Location }

$entries = @()
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1).Replace($BACKSLASH, '/')
  if (-not $tracked.ContainsKey($rel)) { Fail "'$rel' is not tracked by git - commit it or take it out of PATTERNS." }
  $entries += [pscustomobject]@{ Name = $rel; Path = $f.FullName }
}

# ---- index.html must not out-reference the archive ---------------------------
# Only subresources the browser fetches: <script src>, <link href>, <img src>.
# An <a href> to github.com is a link someone clicks, not a request the page makes.
$html = Get-Content (Join-Path $root 'index.html') -Raw
$refs = @()
foreach ($rx in @('<script\b[^>]*?\ssrc="([^"]+)"', '<link\b[^>]*?\shref="([^"]+)"', '<img\b[^>]*?\ssrc="([^"]+)"')) {
  $refs += ([regex]::Matches($html, $rx, 'IgnoreCase') | ForEach-Object { $_.Groups[1].Value })
}

$names = @{}; $entries | ForEach-Object { $names[$_.Name] = $true }
$problems = @()
foreach ($r in ($refs | Sort-Object -Unique)) {
  if ($r -match '^data:') { continue }
  # The rule the whole app is built on, checked once more where it would ship.
  if ($r -match '^(https?:)?//') { $problems += "index.html fetches a third-party subresource: $r"; continue }
  $clean = ($r -split '[?#]')[0].TrimStart('/')
  if (-not $names.ContainsKey($clean)) { $problems += "index.html loads '$r', which is not in the archive" }
}
if ($problems.Count) { $problems | ForEach-Object { Write-Host "pack: $_" -ForegroundColor Red }; Fail "aborting." }

# ---- write -------------------------------------------------------------------
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $Output) { [System.IO.File]::Delete($Output) }
$fs = [System.IO.File]::Open($Output, 'Create')
$ar = New-Object System.IO.Compression.ZipArchive($fs, 'Create')
try {
  foreach ($e in $entries) {
    # CreateEntry takes the name verbatim, which is the point: forward slashes,
    # no directory entries, exactly the shape the earlier releases shipped.
    $entry  = $ar.CreateEntry($e.Name, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try {
      $bytes = [System.IO.File]::ReadAllBytes($e.Path)
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Close() }
  }
} finally { $ar.Dispose(); $fs.Close() }

# ---- read it back ------------------------------------------------------------
# Verifying what landed on disk, not what we believe we wrote.
$sha = [System.Security.Cryptography.SHA256]::Create()
$check = [System.IO.Compression.ZipFile]::OpenRead($Output)
$bad = @()
try {
  if ($check.Entries.Count -ne $entries.Count) { $bad += "entry count is $($check.Entries.Count), expected $($entries.Count)" }
  foreach ($z in $check.Entries) {
    if ($z.FullName.Contains($BACKSLASH)) { $bad += "backslash in entry name: $($z.FullName)" }
    $src = $entries | Where-Object { $_.Name -eq $z.FullName }
    if (-not $src) { $bad += "unexpected entry: $($z.FullName)"; continue }
    $zs = $z.Open()
    try {
      $ms = New-Object System.IO.MemoryStream
      $zs.CopyTo($ms)
      $packed = [System.Convert]::ToBase64String($sha.ComputeHash($ms.ToArray()))
      $ms.Dispose()
    } finally { $zs.Close() }
    $onDisk = [System.Convert]::ToBase64String($sha.ComputeHash([System.IO.File]::ReadAllBytes($src.Path)))
    if ($packed -ne $onDisk) { $bad += "content differs from disk: $($z.FullName)" }
  }
} finally { $check.Dispose(); $sha.Dispose() }

if ($bad.Count) { $bad | ForEach-Object { Write-Host "pack: $_" -ForegroundColor Red }; Fail "the archive is wrong; not shipping it." }

$size = (Get-Item $Output).Length
$entries | ForEach-Object { Note $_.Name }
Write-Host ""
Write-Host ("OK  {0}  -  {1} files, {2} KB" -f (Split-Path $Output -Leaf), $entries.Count, [math]::Round($size / 1KB)) -ForegroundColor Green
Write-Host "    (the release notes quote both numbers - copy them from here)"
