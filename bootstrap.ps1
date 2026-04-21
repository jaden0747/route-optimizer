# Route Optimizer — Windows bootstrap script
# Usage (PowerShell): .\bootstrap.ps1
# If execution policy blocks it, run first:
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$REQUIRED_NODE_MAJOR = 18

function Info($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host " [!] $msg" -ForegroundColor Yellow }
function Fatal($msg)   { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }
function Section($msg) { Write-Host "`n$msg" -ForegroundColor White }

# ─── Check Node.js ────────────────────────────────────────────────────────────
Section "Checking Node.js..."

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fatal "Node.js not found. Install it from https://nodejs.org (v$REQUIRED_NODE_MAJOR+) then re-run this script."
}

$nodeVersion = node -e "process.stdout.write(process.version)"
$nodeMajor   = [int]($nodeVersion.TrimStart('v').Split('.')[0])

if ($nodeMajor -lt $REQUIRED_NODE_MAJOR) {
    Fatal "Node.js $nodeVersion detected — v$REQUIRED_NODE_MAJOR+ required. Please upgrade: https://nodejs.org"
}

Info "Node.js $nodeVersion"
Info "npm $(npm --version)"

# ─── Install dependencies ─────────────────────────────────────────────────────
Section "Installing dependencies..."

if ((Test-Path "node_modules") -and (Test-Path "package-lock.json")) {
    Warn "node_modules already exists — running 'npm ci' for a clean install."
    npm ci
} else {
    npm install
}

if ($LASTEXITCODE -ne 0) { Fatal "npm install failed." }
Info "Dependencies installed."

# ─── Start dev server ─────────────────────────────────────────────────────────
Section "Starting dev server..."
Write-Host ""
Write-Host "  App:  http://localhost:5173" -ForegroundColor Cyan
Write-Host "  Stop: Ctrl+C"
Write-Host ""

npm run dev
