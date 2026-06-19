#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Fully automated Scribble release script.
  Builds the app, commits, tags, creates a GitHub Release,
  and optionally updates Firebase with the new version.
.DESCRIPTION
  Usage: .\release.ps1

  Requirements:
    - gh CLI (install: winget install GitHub.cli, then gh auth login)
    - Git remote "origin" pointing to GitHub

  Optional:
    - $env:FIREBASE_SECRET (Firebase Database Secret) for auto-updating
      the in-app version banner. Get it from:
      Firebase Console -> Project Settings -> Service Accounts -> Database Secrets
#>

$ErrorActionPreference = "Continue"
$scriptRoot = $PSScriptRoot

# 1. Read version
Write-Host "Reading version from tauri.conf.json..." -ForegroundColor Cyan
$configPath = Join-Path (Join-Path $scriptRoot "src-tauri") "tauri.conf.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$version = $config.version
Write-Host "Scribble v$version" -ForegroundColor Green
Write-Host ""

# 2. Check requirements
$hasGh = $null -ne (Get-Command "gh" -ErrorAction SilentlyContinue)
if (-not $hasGh) {
    Write-Warning "gh CLI not found. Install it: winget install GitHub.cli"
    Write-Warning "Then authenticate: gh auth login"
    Write-Warning ""
}

# 3. Generate release notes
Write-Host "Generating release notes..." -ForegroundColor Cyan
$prevTag = git -C $scriptRoot describe --tags --abbrev=0 2>$null
if ($LASTEXITCODE -eq 0 -and $prevTag) {
    $log = & git -C $scriptRoot log "$prevTag..HEAD" --oneline --no-decorate
    $notes = @("## What's changed", "") + $log
} else {
    $notes = @("Initial release v$version", "", "- First public release")
}
$notesPath = Join-Path $env:TEMP "scribble_release_notes_$version.txt"
$notes | Out-File -FilePath $notesPath -Encoding utf8
Write-Host "Release notes written to $notesPath" -ForegroundColor Gray
Write-Host ""

# 4. Locate artifacts (build if missing)
$nsisDir = [System.IO.Path]::Combine($scriptRoot, "src-tauri", "target", "release", "bundle", "nsis")
$msiDir = [System.IO.Path]::Combine($scriptRoot, "src-tauri", "target", "release", "bundle", "msi")
$exe = Get-ChildItem (Join-Path $nsisDir "*.exe") | Where-Object { $_.Name -like "*$version*" } | Select-Object -First 1

if (-not $exe) {
    Write-Host "=== Building Scribble v$version ===" -ForegroundColor Magenta
    Write-Host "This will take a while..." -ForegroundColor Gray
    Set-Location $scriptRoot
    npx tauri build
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed! Check the output above for errors."
    }
    Write-Host "Build successful!" -ForegroundColor Green
    $exe = Get-ChildItem (Join-Path $nsisDir "*.exe") | Where-Object { $_.Name -like "*$version*" } | Select-Object -First 1
} else {
    Write-Host "Build artifacts found, skipping build..." -ForegroundColor Yellow
}
Write-Host ""

# 5. Collect remaining artifacts
$msi = Get-ChildItem (Join-Path $msiDir "*.msi") | Select-Object -First 1

if (-not $exe) {
    throw "No .exe found in $nsisDir"
}

$exeName = $exe.Name
$downloadUrl = "https://github.com/lincolnhay69-ops/Skribble/releases/download/v$version/$exeName"

Write-Host "Build artifacts:" -ForegroundColor Cyan
Write-Host "  EXE: $($exe.FullName)" -ForegroundColor Gray
if ($msi) {
    Write-Host "  MSI: $($msi.FullName)" -ForegroundColor Gray
}
Write-Host ""

# 6. Commit and push
Write-Host "=== Committing and pushing to GitHub ===" -ForegroundColor Magenta
git -C $scriptRoot add .
git -C $scriptRoot commit -m "Release v$version"
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Nothing to commit (or commit failed). Continuing..."
}
git -C $scriptRoot tag "v$version"
git -C $scriptRoot push
git -C $scriptRoot push --tags
Write-Host "Push complete!" -ForegroundColor Green
Write-Host ""

# 7. Create GitHub Release
Write-Host "=== Creating GitHub Release ===" -ForegroundColor Magenta
if ($hasGh) {
    $ghArgs = "-R", "lincolnhay69-ops/Skribble", "release", "create", "v$version", "--title", "Scribble v$version", "--notes-file", $notesPath, $exe.FullName
    if ($msi) {
        $ghArgs += $msi.FullName
    }

    & gh @ghArgs
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub Release creation failed"
    }

    Write-Host "GitHub Release created!" -ForegroundColor Green
    Write-Host "  https://github.com/lincolnhay69-ops/Skribble/releases/tag/v$version" -ForegroundColor Gray
} else {
    Write-Warning "Skipping GitHub Release - install gh CLI and run gh auth login"
}
Write-Host ""

# 7b. Deploy web version to gh-pages
Write-Host "=== Deploying web version to gh-pages ===" -ForegroundColor Magenta
$webDir = Join-Path $env:TEMP "scribble_web_deploy_$version"
Remove-Item $webDir -Recurse -Force -ErrorAction SilentlyContinue

git -C $scriptRoot fetch origin gh-pages 2>$null
git -C $scriptRoot branch gh-pages origin/gh-pages 2>$null
git -C $scriptRoot worktree add $webDir gh-pages 2>$null
if ($LASTEXITCODE -eq 0) {
    Get-ChildItem $webDir -Exclude ".git" | Remove-Item -Recurse -Force
    Copy-Item (Join-Path $scriptRoot "web\*") $webDir -Recurse -Force
    git -C $webDir add -A
    git -C $webDir commit -m "Deploy web v$version"
    git -C $webDir push origin gh-pages
    git -C $scriptRoot worktree remove $webDir
    Write-Host "Web version deployed!" -ForegroundColor Green
} else {
    Write-Warning "Could not deploy web version (gh-pages worktree failed)"
}
Write-Host ""

# 8. Update Firebase
Write-Host "=== Updating Firebase ===" -ForegroundColor Magenta
$secret = $env:FIREBASE_SECRET
if ($secret) {
    $body = @{
        latest = $version
        downloadUrl = $downloadUrl
    }
    $json = $body | ConvertTo-Json

    $firebaseUrl = "https://telegram-a007d-default-rtdb.firebaseio.com/appVersion.json?auth=$secret"

    Write-Host "Writing to Firebase: latest=$version, downloadUrl=$downloadUrl" -ForegroundColor Gray
    Invoke-RestMethod -Uri $firebaseUrl -Method Put -Body $json -ContentType "application/json"
    Write-Host "Firebase updated successfully!" -ForegroundColor Green
} else {
    Write-Warning "Skipping Firebase update."
    Write-Warning "  To enable, set the FIREBASE_SECRET environment variable:"
    Write-Warning "    `$env:FIREBASE_SECRET = 'your-database-secret'"
    Write-Warning "  Get it from: Firebase Console -> Project Settings -> Service Accounts -> Database Secrets"
}
Write-Host ""

# Done
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Release v$version complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Download page: https://lincolnhay69-ops.github.io/scribble-download/" -ForegroundColor Cyan
Write-Host "  Web version: https://lincolnhay69-ops.github.io/Skribble/" -ForegroundColor Cyan
Write-Host "  GitHub Release: https://github.com/lincolnhay69-ops/Skribble/releases/tag/v$version" -ForegroundColor Cyan
Write-Host ""
