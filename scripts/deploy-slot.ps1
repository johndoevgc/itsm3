#requires -Version 7.0
<#
  Slot-aware deploy for vgc-itsm1-app.
  Replaces direct-to-prod VFS upload with deploy -> staging -> verify -> swap.

  Usage:
    .\scripts\deploy-slot.ps1 -Slot staging               # build + push to staging
    .\scripts\deploy-slot.ps1 -Slot staging -Build:$false # push prebuilt deploy/ files
    .\scripts\deploy-slot.ps1 -Swap                       # swap staging <-> production
    .\scripts\deploy-slot.ps1 -Swap -Rollback             # rollback (swap back)
#>

[CmdletBinding()]
param(
  [ValidateSet("staging","production")]
  [string]$Slot         = "staging",
  [string]$AppName      = "vgc-itsm1-app",
  [string]$ResourceGroup = "vgc-itsm-1-RG",
  [string]$Subscription  = "2bec625d-6acc-4a9d-b4c2-349ca8d955f0",
  [bool]$Build          = $true,
  [switch]$Swap,
  [switch]$Rollback,
  [int]$HealthRetries   = 12,
  [int]$HealthDelaySec  = 5
)

$ErrorActionPreference = "Stop"
function Info ($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok   ($m) { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Fail ($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; throw $m }

$slotArgs   = if ($Slot -eq "production") { @() } else { @("--slot", $Slot) }
$scmHost    = if ($Slot -eq "production") { "$AppName.scm.azurewebsites.net" }
              else                         { "$AppName-$Slot.scm.azurewebsites.net" }
$publicHost = if ($Slot -eq "production") { "$AppName.azurewebsites.net" }
              else                         { "$AppName-$Slot.azurewebsites.net" }
$baseUrl    = "https://$publicHost"
$vfsBase    = "https://$scmHost/api/vfs/site/wwwroot"
$cmdUrl     = "https://$scmHost/api/command"

function Get-AuthHeaders {
  $creds = az webapp deployment list-publishing-credentials `
    -g $ResourceGroup -n $AppName --subscription $Subscription @slotArgs | ConvertFrom-Json
  $pair = "$($creds.publishingUserName):$($creds.publishingPassword)"
  $auth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
  return @{ Authorization = $auth; "If-Match" = "*" }
}

function Test-Health {
  for ($i = 1; $i -le $HealthRetries; $i++) {
    try {
      $r = Invoke-RestMethod "$baseUrl/api/health" -TimeoutSec 15
      if ($r.status -eq "ok" -or $r.ok -eq $true) { return $r }
      Info "Health try ${i}/${HealthRetries}: $($r | ConvertTo-Json -Compress)"
    } catch {
      Info "Health try ${i}/${HealthRetries}: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $HealthDelaySec
  }
  return $null
}

# ─── SWAP MODE ────────────────────────────────────────────────────────────
if ($Swap) {
  if ($Rollback) {
    Info "Rollback: swapping production -> staging (reverts the last swap)"
    az webapp deployment slot swap -g $ResourceGroup -n $AppName `
      --subscription $Subscription --slot production --target-slot staging | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Azure slot rollback swap command failed." }
    Ok "Rolled back. Verifying prod health..."
  } else {
    Info "Swapping staging -> production"
    az webapp deployment slot swap -g $ResourceGroup -n $AppName `
      --subscription $Subscription --slot staging --target-slot production | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Azure slot swap command failed." }
    Ok "Swap complete. Verifying prod health..."
  }
  $Slot = "production"; $publicHost = "$AppName.azurewebsites.net"; $baseUrl = "https://$publicHost"
  $h = Test-Health
  if (-not $h) {
    Write-Host "[FAIL] Prod unhealthy after swap. Auto-reverting..." -ForegroundColor Red
    az webapp deployment slot swap -g $ResourceGroup -n $AppName `
      --subscription $Subscription --slot production --target-slot staging | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Prod failed health check and automatic rollback swap command failed." }
    Fail "Prod failed health check; auto-rolled back."
  }
  Ok "Prod health: $($h | ConvertTo-Json -Depth 3 -Compress)"
  return
}

# ─── BUILD ────────────────────────────────────────────────────────────────
if ($Build) {
  Info "Running vite build..."
  npx vite build
  if ($LASTEXITCODE -ne 0) { Fail "vite build failed" }
  Info "Copying dist/* -> deploy/"
  if (Test-Path "deploy") { Remove-Item "deploy" -Recurse -Force }
  New-Item -ItemType Directory deploy | Out-Null
  Copy-Item "dist/*" "deploy/" -Recurse -Force
  Ok "Build complete."
}

if (-not (Test-Path "deploy/index.html")) { Fail "deploy/index.html missing" }
if (-not (Test-Path "server.js"))         { Fail "server.js missing" }

# ─── DEPLOY TO SLOT ───────────────────────────────────────────────────────
Info "Target slot: $Slot ($baseUrl)"
$h = Get-AuthHeaders

# Clean stale dist + old asset bundles (memory-noted gotcha)
Info "Cleaning stale /home/site/wwwroot/dist and old assets..."
$cleanCmd = @{
  command = 'bash -c "rm -rf /home/site/wwwroot/dist && if [ -d /home/site/wwwroot/assets ]; then find /home/site/wwwroot/assets -maxdepth 1 -type f \( -name ''*.js'' -o -name ''*.css'' -o -name ''*.map'' \) -delete; fi"'
  dir     = "/home/site/wwwroot"
} | ConvertTo-Json
try {
  Invoke-RestMethod $cmdUrl -Method POST -Headers $h -ContentType "application/json" -Body $cleanCmd | Out-Null
  Ok "Cleaned remote stale files."
} catch { Write-Warning "Clean step failed (non-fatal): $($_.Exception.Message)" }

# Upload index.html
Info "Uploading index.html"
Invoke-WebRequest -Method PUT -Uri "$vfsBase/index.html" -Headers $h -InFile "deploy/index.html" | Out-Null

# Upload assets (JS + CSS)
$assets = Get-ChildItem "deploy/assets/*" -Include "*.js","*.css" -ErrorAction SilentlyContinue
foreach ($f in $assets) {
  Info "Uploading assets/$($f.Name)"
  Invoke-WebRequest -Method PUT -Uri "$vfsBase/assets/$($f.Name)" -Headers $h -InFile $f.FullName | Out-Null
}
Info "Uploaded $($assets.Count) asset files"

# Upload server.js
Info "Uploading server.js"
Invoke-WebRequest -Method PUT -Uri "$vfsBase/server.js" -Headers $h -InFile "server.js" | Out-Null

# Upload supporting backend modules (only if changed locally — push always for safety)
$backendFiles = @(
  "workflowEngine.js","slaEngine.js","notificationEngine.js","analyticsEngine.js",
  "authMiddleware.js","cacheLayer.js","graphService.js","wsServer.js","msalConfig.js",
  "featureFlags.js","shadowMode.js","shadowWorkflow.js","piiRedact.js",
  "incidentIndex.js","cluster.js"
) | Where-Object { Test-Path $_ }
foreach ($bf in $backendFiles) {
  Info "Uploading $bf"
  Invoke-WebRequest -Method PUT -Uri "$vfsBase/$bf" -Headers $h -InFile $bf | Out-Null
}

# Upload routes/ directory (ai.js, core.js, zendesk.js, etc.)
$routesDir = "routes"
if (Test-Path $routesDir) {
  # Ensure routes/ folder exists on remote via VFS
  try { Invoke-WebRequest -Method PUT -Uri "$vfsBase/routes/" -Headers $h | Out-Null } catch {}
  $routeFiles = Get-ChildItem $routesDir -Filter "*.js" -ErrorAction SilentlyContinue
  foreach ($rf in $routeFiles) {
    Info "Uploading routes/$($rf.Name)"
    Invoke-WebRequest -Method PUT -Uri "$vfsBase/routes/$($rf.Name)" -Headers $h -InFile $rf.FullName | Out-Null
  }
  Info "Uploaded $($routeFiles.Count) route files"
}

# Upload src/server/ directory (validation.js, etc.)
$srcServerDir = "src/server"
if (Test-Path $srcServerDir) {
  try { Invoke-WebRequest -Method PUT -Uri "$vfsBase/src/" -Headers $h | Out-Null } catch {}
  try { Invoke-WebRequest -Method PUT -Uri "$vfsBase/src/server/" -Headers $h | Out-Null } catch {}
  $srcServerFiles = Get-ChildItem $srcServerDir -Filter "*.js" -ErrorAction SilentlyContinue
  foreach ($sf in $srcServerFiles) {
    Info "Uploading src/server/$($sf.Name)"
    Invoke-WebRequest -Method PUT -Uri "$vfsBase/src/server/$($sf.Name)" -Headers $h -InFile $sf.FullName | Out-Null
  }
  Info "Uploaded $($srcServerFiles.Count) src/server files"
}

# Upload src/utils/ shared CJS helpers used by the backend (priorityNormalize.cjs etc.)
$srcUtilsDir = "src/utils"
if (Test-Path $srcUtilsDir) {
  try { Invoke-WebRequest -Method PUT -Uri "$vfsBase/src/" -Headers $h | Out-Null } catch {}
  try { Invoke-WebRequest -Method PUT -Uri "$vfsBase/src/utils/" -Headers $h | Out-Null } catch {}
  $srcUtilsFiles = Get-ChildItem $srcUtilsDir -Filter "*.cjs" -File -ErrorAction SilentlyContinue
  foreach ($uf in $srcUtilsFiles) {
    Info "Uploading src/utils/$($uf.Name)"
    Invoke-WebRequest -Method PUT -Uri "$vfsBase/src/utils/$($uf.Name)" -Headers $h -InFile $uf.FullName | Out-Null
  }
  if ($srcUtilsFiles) { Info "Uploaded $($srcUtilsFiles.Count) src/utils CJS files" }
}

# Upload config/data files
@("profiles.json","VERSION.json","kb-enterprise-articles.json") | Where-Object { Test-Path $_ } | ForEach-Object {
  Info "Uploading $_"
  Invoke-WebRequest -Method PUT -Uri "$vfsBase/$_" -Headers $h -InFile $_ | Out-Null
}

# ─── RESTART + HEALTH ─────────────────────────────────────────────────────
Info "Restarting slot..."
az webapp restart -g $ResourceGroup -n $AppName --subscription $Subscription @slotArgs | Out-Null

Info "Waiting for /api/health on $baseUrl ..."
$h2 = Test-Health
if (-not $h2) { Fail "Slot $Slot did not become healthy in $($HealthRetries * $HealthDelaySec)s." }
Ok "Slot healthy: $($h2 | ConvertTo-Json -Depth 3 -Compress)"

Write-Host ""
Write-Host "Deployed to $Slot OK." -ForegroundColor Green
if ($Slot -eq "staging") {
  Write-Host "Next: run smoke tests, then swap to prod:"
  Write-Host "   .\scripts\deploy-slot.ps1 -Swap"
}
