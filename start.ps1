<#
.SYNOPSIS
  FarmSmart one-command start (Windows PowerShell).
.DESCRIPTION
  .\start.ps1              starts the API (port 8000) and the web dev server (port 5173), then opens the browser.
  .\start.ps1 -Precompute  builds the pilot caches first (data/precomputed), then starts.
  .\start.ps1 -Setup       creates the Python env (conda-forge core + pip) and installs web packages.
#>
param([switch]$Precompute, [switch]$Setup, [switch]$NoBrowser)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root
$Conda = Join-Path $env:USERPROFILE "miniforge3\Scripts\conda.exe"
$Py = Join-Path $env:USERPROFILE "miniforge3\envs\fieldshift\python.exe"
if (Test-Path "C:\Program Files\nodejs") { $env:Path = "C:\Program Files\nodejs;$env:Path" }

if ($Setup) {
  if (-not (Test-Path $Py)) {
    # GDAL-dependent core from conda-forge, everything else from pip wheels (see CLAUDE.md: Windows App Control)
    & $Conda create -n fieldshift -y -c conda-forge --override-channels python=3.11 gdal shapely geopandas
  }
  & $Py -m pip install -r (Join-Path $Root "requirements.txt")
  Push-Location web; npm install; Pop-Location
}
if (-not (Test-Path $Py)) { Write-Error "Python env not found. Run .\start.ps1 -Setup first."; exit 1 }
$env:PYTHONPATH = $Root

if ($Precompute) {
  & $Py -m fieldshift.cli precompute
}

Write-Host "Starting FarmSmart API on http://127.0.0.1:8000 ..." -ForegroundColor Green
$api = Start-Process -FilePath $Py -ArgumentList "-m","uvicorn","fieldshift.api.main:app","--port","8000","--host","127.0.0.1" -PassThru -WindowStyle Minimized
Write-Host "Starting web app on http://localhost:5173 ..." -ForegroundColor Green
Push-Location web
$web = Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -PassThru -WindowStyle Minimized
Pop-Location
Start-Sleep -Seconds 4
if (-not $NoBrowser) { Start-Process "http://localhost:5173" }
Write-Host "Running. API PID $($api.Id), web PID $($web.Id). Press Ctrl+C to stop both." -ForegroundColor Cyan
try { Wait-Process -Id $api.Id } finally {
  Stop-Process -Id $api.Id -ErrorAction SilentlyContinue
  Stop-Process -Id $web.Id -ErrorAction SilentlyContinue
}
