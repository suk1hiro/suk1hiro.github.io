# ============================================================
#  Mini Sudoku - local launcher  /  迷你数独一键启动
#
#  Do NOT open index.html in the DSH preview panel: the preview
#  blocks page scripts, and the board / keypad / difficulty
#  buttons are all built by scripts, so you would see a blank page.
#  This script serves the folder over HTTP and opens a real browser.
#
#  Run it:  right-click -> "Run with PowerShell"
#       or:  powershell -ExecutionPolicy Bypass -File .\start.ps1
# ============================================================

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ''
Write-Host '  Mini Sudoku launcher' -ForegroundColor Cyan
Write-Host '  --------------------'

# --- locate a python interpreter ---
$python = $null
$bundled = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
if (Test-Path $bundled) {
    $python = $bundled
} else {
    foreach ($name in @('python.exe', 'py.exe', 'python3.exe')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { $python = $cmd.Source; break }
    }
}

if (-not $python) {
    Write-Host '  [X] python not found; cannot start the local server.' -ForegroundColor Red
    Write-Host '      You can still open index.html directly in Chrome or Edge.' -ForegroundColor Yellow
    Read-Host '  Press Enter to exit'
    exit 1
}
Write-Host "  python : $python"

# --- pick a free port ---
$port = $null
foreach ($candidate in 8080..8099) {
    $busy = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) { $port = $candidate; break }
}
if (-not $port) {
    Write-Host '  [X] Ports 8080-8099 are all in use.' -ForegroundColor Red
    Read-Host '  Press Enter to exit'
    exit 1
}

$url = "http://127.0.0.1:$port/"
Write-Host "  url    : $url" -ForegroundColor Green
Write-Host ''

# --- start the static server as a background job ---
$job = Start-Job -ScriptBlock {
    param($py, $dir, $p)
    & $py -m http.server $p --bind 127.0.0.1 --directory $dir
} -ArgumentList $python, $root, $port

# --- wait until it actually answers, then open the browser ---
$ready = $false
foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 250
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}

if ($ready) {
    Write-Host '  [OK] Server ready, opening your browser...' -ForegroundColor Green
    Start-Process $url
    Write-Host ''
    Write-Host '  If the browser did not open, copy this address manually:'
    Write-Host "    $url" -ForegroundColor Green
} else {
    Write-Host '  [!] Server start timed out.' -ForegroundColor Yellow
    Write-Host '      You can still open index.html directly in Chrome or Edge.'
}

Write-Host ''
Write-Host '  Keep this window open while playing.' -ForegroundColor DarkGray
Read-Host '  Press Enter to stop the server and exit'

Stop-Job $job -ErrorAction SilentlyContinue
Remove-Job $job -Force -ErrorAction SilentlyContinue
Write-Host '  Server stopped.'
