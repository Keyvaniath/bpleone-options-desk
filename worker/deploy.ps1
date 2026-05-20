# =============================================================
# bpleone Brain Worker - Auto-Deploy Script
# Pure ASCII, single-quote strings to avoid PowerShell parser issues.
# =============================================================

$ErrorActionPreference = 'Stop'

function Write-Step($msg) {
  Write-Host ''
  Write-Host ('===== ' + $msg + ' =====') -ForegroundColor Cyan
}
function Write-Ok($msg)   { Write-Host ('  [OK] ' + $msg)  -ForegroundColor Green }
function Write-Warn($msg) { Write-Host ('  [!!] ' + $msg)  -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host ('  [XX] ' + $msg)  -ForegroundColor Red }

# 0. Pre-flight
Write-Step '0. Pre-flight'
if (-not (Test-Path 'wrangler.toml')) {
  Write-Err 'wrangler.toml missing. cd into the worker folder first.'
  exit 1
}
Write-Ok 'In worker directory'

try {
  $nv = (node --version) 2>&1
  Write-Ok ('Node installed: ' + $nv)
} catch {
  Write-Warn 'Node not installed. Installing via winget...'
  winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
  Write-Warn 'Node installed. Close this PowerShell, open a new one, then re-run.'
  exit 0
}

# 1. Install wrangler
Write-Step '1. Install wrangler CLI'
try {
  $wv = (wrangler --version 2>&1)
  Write-Ok ('wrangler already installed: ' + $wv)
} catch {
  Write-Host '  Installing wrangler globally...' -ForegroundColor Yellow
  npm install -g wrangler@latest
  Write-Ok 'wrangler installed'
}

# 2. Cloudflare login
Write-Step '2. Cloudflare login'
Write-Host '  Browser will open. Click Allow.' -ForegroundColor Yellow
Read-Host '  Press Enter to continue'
wrangler login
Write-Ok 'Logged in to Cloudflare'

# 3. KV namespace (idempotent)
Write-Step '3. Create KV namespace'
$tomlContent = Get-Content wrangler.toml -Raw
if ($tomlContent -match 'REPLACE_WITH_KV_ID_FROM_WRANGLER_OUTPUT') {
  Write-Host '  Creating new KV namespace...' -ForegroundColor Yellow
  $kvOutput = wrangler kv namespace create BRAIN_KV 2>&1 | Out-String
  Write-Host $kvOutput
  if ($kvOutput -match 'id\s*=\s*"([a-f0-9]+)"') {
    $kvId = $matches[1]
    Write-Ok ('KV namespace id: ' + $kvId)
    $newToml = $tomlContent -replace 'REPLACE_WITH_KV_ID_FROM_WRANGLER_OUTPUT', $kvId
    Set-Content -Path wrangler.toml -Value $newToml -NoNewline
    Write-Ok 'wrangler.toml patched'
  } else {
    Write-Err 'Could not parse KV id. Edit wrangler.toml manually.'
    exit 1
  }
} else {
  Write-Ok 'KV namespace already set in wrangler.toml'
}

# 4. Set secrets
Write-Step '4. Set secrets'

Write-Host '  FINNHUB_API_KEY needed.' -ForegroundColor Yellow
$finnhubKey = Read-Host '  Paste FINNHUB_API_KEY [hidden]' -AsSecureString
$finnhubKeyPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($finnhubKey))
$finnhubKeyPlain | wrangler secret put FINNHUB_API_KEY
Write-Ok 'FINNHUB_API_KEY set'

Write-Host '  ADMIN_TOKEN - press Enter to auto-generate.' -ForegroundColor Yellow
$adminToken = Read-Host '  Paste ADMIN_TOKEN or Enter for auto' -AsSecureString
$adminTokenPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminToken))
if ([string]::IsNullOrWhiteSpace($adminTokenPlain)) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $adminTokenPlain = [Convert]::ToBase64String($bytes) -replace '[/+=]','x'
  Write-Host ('    Auto-generated ADMIN_TOKEN: ' + $adminTokenPlain) -ForegroundColor Green
  Write-Host '    SAVE THIS - you need it to re-trigger bootstrap.' -ForegroundColor Yellow
}
$adminTokenPlain | wrangler secret put ADMIN_TOKEN
Write-Ok 'ADMIN_TOKEN set'

# 5. Deploy
Write-Step '5. Deploy worker'
# Pass 186: temporarily relax error mode for wrangler — it writes warnings
# to stderr which PowerShell's Stop mode treats as fatal even when wrangler
# returns success exit code.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$deployOutput = wrangler deploy 2>&1 | Out-String
$ErrorActionPreference = $prevEAP
Write-Host $deployOutput
if ($deployOutput -match '(https://[a-z0-9.\-]+\.workers\.dev)') {
  $workerUrl = $matches[1]
  Write-Ok ('Deployed to: ' + $workerUrl)
} else {
  Write-Err 'Could not parse worker URL from deploy output.'
  exit 1
}

# 6. Wait for first cron tick
Write-Step '6. Wait for first cron tick'
Write-Host '  Cron fires every minute. Waiting 75 seconds...' -ForegroundColor Yellow
Start-Sleep -Seconds 75

try {
  $health = Invoke-RestMethod -Uri ($workerUrl + '/brain/health') -ErrorAction Stop
  if ($health.lastTickAgo -ne $null -and $health.lastTickAgo -lt 180) {
    Write-Ok ('Worker healthy. Last tick: ' + $health.lastTickAgo + 's ago')
  } else {
    Write-Warn 'Worker deployed but cron has not fired. Try again in a minute.'
  }
} catch {
  Write-Warn ('Could not reach ' + $workerUrl + '/brain/health')
}

# 7. Historical bootstrap
Write-Step '7. Trigger 250-day historical bootstrap'
Write-Host '  Pulls 250 days of Finnhub candles. Takes 30 to 60 seconds.' -ForegroundColor Yellow
try {
  $headers = @{ 'Authorization' = ('Bearer ' + $adminTokenPlain) }
  $bootstrap = Invoke-RestMethod -Uri ($workerUrl + '/brain/bootstrap') -Method POST -Headers $headers -ErrorAction Stop
  Write-Host ''
  Write-Host '  Bootstrap result:' -ForegroundColor Cyan
  Write-Host ('    symbolsFetched: ' + $bootstrap.symbolsFetched) -ForegroundColor Green
  Write-Host ('    trainingExamples: ' + $bootstrap.trainingExamples) -ForegroundColor Green
  Write-Host ('    errors: ' + $bootstrap.errors) -ForegroundColor Green
  Write-Host ('    final n_trained: ' + $bootstrap.final_n_trained) -ForegroundColor Green
  Write-Ok 'Brain pre-trained on real historical data'
} catch {
  Write-Warn ('Bootstrap call failed: ' + $_.Exception.Message)
}

# DONE
Write-Step 'DONE'
Write-Host ''
Write-Host ('  Worker URL: ' + $workerUrl) -ForegroundColor Green
Write-Host ('  ADMIN_TOKEN: ' + $adminTokenPlain) -ForegroundColor Yellow
Write-Host '  SAVE THE ADMIN_TOKEN somewhere.' -ForegroundColor Yellow
Write-Host ''
Write-Host '  Next steps:' -ForegroundColor Cyan
Write-Host '    1. Open https://options.bpleone.com/worker-setup.html' -ForegroundColor White
Write-Host '    2. Paste the worker URL into the input' -ForegroundColor White
Write-Host '    3. Click Connect' -ForegroundColor White
Write-Host ''

$openSetup = Read-Host '  Open worker-setup.html in browser now? [Y/n]'
if ($openSetup -ne 'n') {
  Start-Process 'https://options.bpleone.com/worker-setup.html'
}
