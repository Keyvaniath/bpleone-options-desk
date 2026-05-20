# =============================================================
# bpleone Brain Worker — Auto-Deploy Script (PowerShell)
# =============================================================
# Run this ONCE. It handles:
#   - Install Node.js if missing (via winget)
#   - Install wrangler CLI
#   - Login to Cloudflare (opens your browser to click "Allow")
#   - Create the KV namespace (auto, no copy/paste)
#   - Set your Finnhub key + admin token as secrets (you paste once)
#   - Deploy the worker
#   - Trigger the 250-day historical bootstrap
#   - Print the worker URL for you to paste into worker-setup.html
#
# USAGE:
#   1. Open PowerShell (Windows key → type "powershell" → Enter)
#   2. cd to wherever you cloned the repo, then to worker/
#      e.g. cd $HOME\bpleone-options-desk\worker
#      (if you don't have it cloned, the script offers to do it)
#   3. Run: .\deploy.ps1
#   4. Follow prompts. ~5 minutes total.
# =============================================================

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "bpleone Brain Worker Deploy"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "===== $msg =====" -ForegroundColor Cyan
}
function Write-Ok($msg)   { Write-Host "  [OK] $msg"  -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!!] $msg"  -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  [XX] $msg"  -ForegroundColor Red }

# ============================================================
# 0. Pre-flight checks
# ============================================================
Write-Step "0. Pre-flight"

# Make sure we're in the worker/ directory
if (-not (Test-Path "wrangler.toml")) {
  Write-Err "No wrangler.toml found in current directory."
  Write-Host "    Are you in the worker/ folder of the repo?" -ForegroundColor Yellow
  Write-Host "    cd to bpleone-options-desk\worker then re-run this script." -ForegroundColor Yellow
  $clone = Read-Host "    Want me to clone the repo into your home directory now? (y/N)"
  if ($clone -eq "y") {
    Set-Location $HOME
    if (Test-Path "bpleone-options-desk") {
      Set-Location bpleone-options-desk
    } else {
      git clone https://github.com/Keyvaniath/bpleone-options-desk
      Set-Location bpleone-options-desk
    }
    Set-Location worker
  } else {
    exit 1
  }
}
Write-Ok "In worker/ directory"

# Check Node
$nodeVersion = $null
try {
  $nodeVersion = (node --version) 2>&1
  Write-Ok "Node installed: $nodeVersion"
} catch {
  Write-Warn "Node not installed."
  Write-Host "    Installing Node LTS via winget (you may get a UAC prompt)..." -ForegroundColor Yellow
  winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
  Write-Warn "Node installed. CLOSE this PowerShell and open a NEW one, then re-run the script."
  Write-Warn "(PowerShell needs to restart to see node on PATH.)"
  exit 0
}

# ============================================================
# 1. Install wrangler
# ============================================================
Write-Step "1. Install wrangler CLI"
$wranglerVersion = $null
try {
  $wranglerVersion = (wrangler --version 2>&1)
  Write-Ok "wrangler already installed: $wranglerVersion"
} catch {
  Write-Host "  Installing wrangler globally..." -ForegroundColor Yellow
  npm install -g wrangler@latest
  Write-Ok "wrangler installed"
}

# ============================================================
# 2. Cloudflare login
# ============================================================
Write-Step "2. Cloudflare login (browser opens)"
Write-Host "  Your browser will open to Cloudflare. Click ALLOW to authorize." -ForegroundColor Yellow
Write-Host "  If you don't have a Cloudflare account, sign up (free) first." -ForegroundColor Yellow
Read-Host "  Press Enter to continue"
wrangler login
Write-Ok "Logged in to Cloudflare"

# ============================================================
# 3. Create KV namespace (idempotent)
# ============================================================
Write-Step "3. Create KV namespace"
$tomlContent = Get-Content wrangler.toml -Raw
if ($tomlContent -match "REPLACE_WITH_KV_ID_FROM_WRANGLER_OUTPUT") {
  Write-Host "  Creating new KV namespace..." -ForegroundColor Yellow
  $kvOutput = wrangler kv namespace create BRAIN_KV 2>&1 | Out-String
  Write-Host $kvOutput
  if ($kvOutput -match 'id\s*=\s*"([a-f0-9]+)"') {
    $kvId = $matches[1]
    Write-Ok "KV namespace id: $kvId"
    $newToml = $tomlContent -replace "REPLACE_WITH_KV_ID_FROM_WRANGLER_OUTPUT", $kvId
    Set-Content -Path wrangler.toml -Value $newToml -NoNewline
    Write-Ok "wrangler.toml patched"
  } else {
    Write-Err "Could not parse KV id from wrangler output. Look at the output above and edit wrangler.toml manually."
    exit 1
  }
} else {
  Write-Ok "KV namespace id already set in wrangler.toml"
}

# ============================================================
# 4. Set secrets
# ============================================================
Write-Step "4. Set secrets (paste each when prompted)"

Write-Host "  Your Finnhub API key — same one in your site's settings.html." -ForegroundColor Yellow
Write-Host "  (Looks like a 40-char alphanumeric string.)" -ForegroundColor Yellow
$finnhubKey = Read-Host "  Paste FINNHUB_API_KEY (hidden)" -AsSecureString
$finnhubKeyPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($finnhubKey))
$finnhubKeyPlain | wrangler secret put FINNHUB_API_KEY
Write-Ok "FINNHUB_API_KEY set"

Write-Host "  Admin token — just make up any 30+ character random string." -ForegroundColor Yellow
Write-Host "  Used to authorize the /brain/bootstrap endpoint. Only YOU use it." -ForegroundColor Yellow
$adminToken = Read-Host "  Paste ADMIN_TOKEN (hidden) — or press Enter for an auto-generated one" -AsSecureString
$adminTokenPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminToken))
if ([string]::IsNullOrWhiteSpace($adminTokenPlain)) {
  # Auto-generate 32 random chars
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $adminTokenPlain = [Convert]::ToBase64String($bytes) -replace '[/+=]','x'
  Write-Host "    Auto-generated ADMIN_TOKEN: $adminTokenPlain" -ForegroundColor Green
  Write-Host "    SAVE THIS — you'll need it to re-trigger bootstrap later." -ForegroundColor Yellow
}
$adminTokenPlain | wrangler secret put ADMIN_TOKEN
Write-Ok "ADMIN_TOKEN set"

# ============================================================
# 5. Deploy
# ============================================================
Write-Step "5. Deploy worker"
$deployOutput = wrangler deploy 2>&1 | Out-String
Write-Host $deployOutput
if ($deployOutput -match '(https://[a-z0-9-]+\.workers\.dev)') {
  $workerUrl = $matches[1]
  Write-Ok "Deployed to: $workerUrl"
} else {
  Write-Err "Could not parse worker URL from deploy output."
  exit 1
}

# ============================================================
# 6. Wait + verify health
# ============================================================
Write-Step "6. Wait for first cron tick (~75 seconds)"
Write-Host "  Cron fires every minute. Waiting for the first tick to populate state..." -ForegroundColor Yellow
Start-Sleep -Seconds 75

try {
  $health = Invoke-RestMethod -Uri "$workerUrl/brain/health" -ErrorAction Stop
  if ($health.lastTickAgo -ne $null -and $health.lastTickAgo -lt 180) {
    Write-Ok "Worker is healthy. Last tick: $($health.lastTickAgo)s ago"
  } else {
    Write-Warn "Worker deployed but cron hasn't fired yet. Try /brain/health in a minute."
  }
} catch {
  Write-Warn "Could not reach $workerUrl/brain/health — check Cloudflare dashboard for errors."
}

# ============================================================
# 7. Trigger 250-day historical bootstrap
# ============================================================
Write-Step "7. Trigger 250-day historical bootstrap"
Write-Host "  This pulls 250 days of Finnhub candles for 47 symbols and pre-trains the brain." -ForegroundColor Yellow
Write-Host "  Takes ~30-60 seconds." -ForegroundColor Yellow
try {
  $bootstrap = Invoke-RestMethod -Uri "$workerUrl/brain/bootstrap" `
    -Method POST `
    -Headers @{"Authorization" = "Bearer $adminTokenPlain"} `
    -ErrorAction Stop
  Write-Host ""
  Write-Host "  Bootstrap result:" -ForegroundColor Cyan
  Write-Host "    symbolsFetched: $($bootstrap.symbolsFetched)" -ForegroundColor Green
  Write-Host "    trainingExamples: $($bootstrap.trainingExamples)" -ForegroundColor Green
  Write-Host "    errors: $($bootstrap.errors)" -ForegroundColor Green
  Write-Host "    final n_trained: $($bootstrap.final_n_trained)" -ForegroundColor Green
  Write-Ok "Brain pre-trained on real historical data"
} catch {
  Write-Warn "Bootstrap call failed: $($_.Exception.Message)"
  Write-Warn "You can re-trigger manually: curl -X POST -H `"Authorization: Bearer $adminTokenPlain`" $workerUrl/brain/bootstrap"
}

# ============================================================
# DONE
# ============================================================
Write-Step "DONE"
Write-Host ""
Write-Host "  Worker URL: $workerUrl" -ForegroundColor Green
Write-Host "  ADMIN_TOKEN: $adminTokenPlain (save this somewhere)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "    1. Open https://options.bpleone.com/worker-setup.html" -ForegroundColor White
Write-Host "    2. Paste the worker URL into the input" -ForegroundColor White
Write-Host "    3. Click 'Connect'" -ForegroundColor White
Write-Host ""
Write-Host "  Brain now runs 24/7 in Cloudflare's edge. Close Chrome anytime —" -ForegroundColor Green
Write-Host "  worker keeps capturing/resolving/training every minute." -ForegroundColor Green
Write-Host ""

# Try to open the setup page automatically
$openSetup = Read-Host "  Open worker-setup.html in your browser now? (Y/n)"
if ($openSetup -ne "n") {
  Start-Process "https://options.bpleone.com/worker-setup.html"
}
