#!/usr/bin/env bash
set -euo pipefail

# ── Route Optimizer — bootstrap script ────────────────────────────────────────
# Sets up the project on a fresh machine and starts the dev server.
# Usage: bash bootstrap.sh

REQUIRED_NODE_MAJOR=18

# ─── Colour helpers ───────────────────────────────────────────────────────────
bold="\033[1m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
reset="\033[0m"

info()    { echo -e "${bold}${green}[✔]${reset} $*"; }
warn()    { echo -e "${bold}${yellow}[!]${reset} $*"; }
fatal()   { echo -e "${bold}${red}[✘]${reset} $*"; exit 1; }
section() { echo -e "\n${bold}$*${reset}"; }

# ─── Check Node.js ────────────────────────────────────────────────────────────
section "Checking Node.js…"

if ! command -v node &>/dev/null; then
  fatal "Node.js not found. Install it from https://nodejs.org (v${REQUIRED_NODE_MAJOR}+) and re-run this script."
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  fatal "Node.js v${NODE_MAJOR} detected — v${REQUIRED_NODE_MAJOR}+ required. Please upgrade."
fi

info "Node.js $(node --version)"
info "npm $(npm --version)"

# ─── Install dependencies ─────────────────────────────────────────────────────
section "Installing dependencies…"

if [ -d node_modules ] && [ -f package-lock.json ]; then
  warn "node_modules already exists — running 'npm ci' to ensure clean install."
  npm ci
else
  npm install
fi

info "Dependencies installed."

# ─── Done ─────────────────────────────────────────────────────────────────────
section "Starting dev server…"
echo ""
echo -e "  ${bold}App:${reset}  http://localhost:5173"
echo -e "  ${bold}Stop:${reset} Ctrl+C"
echo ""

npm run dev
