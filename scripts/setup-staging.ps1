#requires -Version 7.0
<#
  VGC ITSM — Staging Slot + DB Isolation Setup
  Idempotent. Safe to re-run. Read-only against prod data unless -SeedFromProd.

  Usage:
    .\scripts\setup-staging.ps1                       # dry-run (prints what would happen)
    .\scripts\setup-staging.ps1 -Apply                # actually apply
    .\scripts\setup-staging.ps1 -Apply -SeedFromProd  # also seed staging DB from scrubbed prod snapshot
#>

[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$SeedFromProd,
  [string]$ResourceGroup    = "vgc-itsm-1-RG",
  [string]$AppName          = "vgc-itsm1-app",
  [string]$SlotName         = "staging",
  [string]$Location         = "southeastasia",
  [string]$PlanSku          = "S1",
  [string]$ProdMysqlServer  = "",
  [string]$StgMysqlServer   = "itsm-vgc-mysql-stg",
  [string]$StgMysqlSku      = "Standard_B1ms",
  [string]$StgDbName        = "itsm_data",
  [string]$KeyVaultName     = "",
  [string]$EmailRedirectTo  = "hlaing@vgctechnology.com",
  [string]$EntraTenantId    = "",
  [string]$EntraClientIdStg = ""
)

$ErrorActionPreference = "Stop"
function Info ($m) { Write-Host "[INFO ] $m" -ForegroundColor Cyan }
function Ok   ($m) { Write-Host "[ OK  ] $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "[WARN ] $m" -ForegroundColor Yellow }
function Fail ($m) { Write-Host "[FAIL ] $m" -ForegroundColor Red; throw $m }
function Run  ($desc, [scriptblock]$action) {
  if ($Apply) { Info "APPLY  : $desc"; & $action }
  else        { Warn "DRYRUN : $desc" }
}

# ─── 0. Pre-flight ────────────────────────────────────────────────────────
Info "Checking az login..."
$ctx = az account show 2>$null | ConvertFrom-Json
if (-not $ctx) { Fail "Not logged in. Run: az login" }
Ok "Subscription: $($ctx.name) ($($ctx.id))"

Info "Checking resource group $ResourceGroup..."
$rg = az group show -n $ResourceGroup 2>$null | ConvertFrom-Json
if (-not $rg) { Fail "Resource group $ResourceGroup not found." }
Ok "RG exists in $($rg.location)"

# ─── 1. Detect prod app + plan ────────────────────────────────────────────
Info "Inspecting App Service $AppName..."
$app = az webapp show -g $ResourceGroup -n $AppName 2>$null | ConvertFrom-Json
if (-not $app) { Fail "App $AppName not found." }
# Azure CLI returns the plan id under appServicePlanId (serverFarmId is null)
$planId   = if ($app.appServicePlanId) { $app.appServicePlanId } else { $app.serverFarmId }
if (-not $planId) { Fail "Could not determine App Service Plan id for $AppName." }
$planName = ($planId -split '/')[-1]
$plan     = az appservice plan show --ids $planId | ConvertFrom-Json
$currentSku = $plan.sku.name
Info "App Service Plan: $planName  SKU: $currentSku"

if ($currentSku -in @("F1","D1","B1","B2","B3")) {
  Warn "Plan SKU '$currentSku' does NOT support deployment slots. Need S1 or higher."
  Run "Scale plan $planName -> $PlanSku" {
    az appservice plan update -g $ResourceGroup --name $planName --sku $PlanSku | Out-Null
  }
} else { Ok "Plan SKU supports slots." }

# ─── 2. Detect prod MySQL server (from app settings, not RG listing) ─────
if (-not $ProdMysqlServer) {
  $hostFromApp = az webapp config appsettings list -g $ResourceGroup -n $AppName --query "[?name=='MYSQL_HOST'].value | [0]" -o tsv
  if ($hostFromApp -and $hostFromApp -like "*.mysql.database.azure.com") {
    $ProdMysqlServer = $hostFromApp.Split(".")[0]
    Info "Auto-detected prod MySQL from $AppName settings: $ProdMysqlServer"
  } else {
    $servers = az mysql flexible-server list -g $ResourceGroup --query "[?name!='$StgMysqlServer'].name" -o tsv
    if (-not $servers) { Fail "No prod MySQL Flexible Server in $ResourceGroup. Pass -ProdMysqlServer." }
    $ProdMysqlServer = ($servers -split "`n")[0].Trim()
    Info "Auto-detected prod MySQL: $ProdMysqlServer"
  }
}
$prodMysql = az mysql flexible-server show -g $ResourceGroup --name $ProdMysqlServer | ConvertFrom-Json
$prodMysqlHost = "$ProdMysqlServer.mysql.database.azure.com"

# ─── 3. Detect / set Key Vault ────────────────────────────────────────────
if (-not $KeyVaultName) {
  $kvs = az keyvault list -g $ResourceGroup --query "[].name" -o tsv
  if ($kvs) { $KeyVaultName = ($kvs -split "`n")[0].Trim(); Info "Auto-detected KV: $KeyVaultName" }
  else     { Warn "No Key Vault found in RG. Skipping KV wiring (recommend creating one)." }
}

# ─── 4. Raise prod MySQL backup retention to 35 days ──────────────────────
if ($prodMysql.backup.backupRetentionDays -lt 35) {
  Run "Raise prod MySQL backup retention to 35 days" {
    az mysql flexible-server update -g $ResourceGroup --name $ProdMysqlServer `
      --backup-retention 35 | Out-Null
  }
} else { Ok "Prod MySQL backup retention already $($prodMysql.backup.backupRetentionDays) days." }

# ─── 5. Create staging MySQL Flexible Server (separate isolation) ────────
function New-SafePassword {
  # alphanumeric + a couple of safe symbols only — avoids cmd.exe paren/redirect parsing
  $alpha = [char[]]([char]'A'..[char]'Z' + [char]'a'..[char]'z' + [char]'0'..[char]'9')
  $body  = -join (1..28 | ForEach-Object { Get-Random -InputObject $alpha })
  return "Stg${body}!9Aa"
}

$stg = az mysql flexible-server show -g $ResourceGroup --name $StgMysqlServer 2>$null | ConvertFrom-Json
if (-not $stg) {
  $stgPwd = New-SafePassword
  Run "Create staging MySQL server $StgMysqlServer" {
    az mysql flexible-server create `
      -g $ResourceGroup --name $StgMysqlServer `
      --location $Location `
      --sku-name $StgMysqlSku --tier Burstable `
      --version 8.0.21 --storage-size 20 `
      --admin-user itsmadmin --admin-password $stgPwd `
      --public-access 0.0.0.0 --yes -o none
    if ($LASTEXITCODE -ne 0) { Fail "MySQL create failed" }
    if ($KeyVaultName) {
      az keyvault secret set --vault-name $KeyVaultName --name "stg-mysql-password" --value $stgPwd -o none
      Ok "Staging password saved to KV secret 'stg-mysql-password'"
    } else {
      Warn "STAGING MYSQL PASSWORD (save this NOW): $stgPwd"
    }
  }
} else { Ok "Staging MySQL server $StgMysqlServer already exists." }

# ─── 6. Create staging DB (matches prod DB NAME so app code paths are identical) ───
Info "Detecting prod MYSQL_DATABASE / MYSQL_USER from $AppName..."
$prodMysqlDb   = az webapp config appsettings list -g $ResourceGroup -n $AppName --query "[?name=='MYSQL_DATABASE'].value | [0]" -o tsv
$prodMysqlUser = az webapp config appsettings list -g $ResourceGroup -n $AppName --query "[?name=='MYSQL_USER'].value | [0]" -o tsv
if (-not $prodMysqlDb)   { $prodMysqlDb = $StgDbName;  Warn "Prod MYSQL_DATABASE not set; defaulting to $prodMysqlDb" }
if (-not $prodMysqlUser) { $prodMysqlUser = "itsmadmin"; Warn "Prod MYSQL_USER not set; defaulting to $prodMysqlUser" }
Info "Will create staging DB '$prodMysqlDb' (matches prod) with admin user 'itsmadmin'."
Run "Create staging database '$prodMysqlDb' on $StgMysqlServer" {
  az mysql flexible-server db create -g $ResourceGroup `
    --server-name $StgMysqlServer --database-name $prodMysqlDb 2>$null | Out-Null
}

# ─── 7. Create staging slot ──────────────────────────────────────────────
$slots = az webapp deployment slot list -g $ResourceGroup -n $AppName --query "[].name" -o tsv
if ($slots -notcontains $SlotName) {
  Run "Create staging slot '$SlotName'" {
    az webapp deployment slot create `
      -g $ResourceGroup -n $AppName --slot $SlotName `
      --configuration-source $AppName | Out-Null
  }
} else { Ok "Slot '$SlotName' already exists." }

# ─── 8. Configure slot-sticky settings via JSON file ─────────────────────
# Why JSON file: az.cmd is a batch wrapper and re-parses args; KV refs contain '(' ')' which break it.
$stgHost = "$StgMysqlServer.mysql.database.azure.com"
$stgPwdRef = if ($KeyVaultName) {
  $sid = az keyvault secret show --vault-name $KeyVaultName --name "stg-mysql-password" --query id -o tsv 2>$null
  if ($sid) { "@Microsoft.KeyVault(SecretUri=$sid)" } else { "REPLACE_ME" }
} else { "REPLACE_ME" }

$stagingSettings = @(
  @{ name="NODE_ENV";                          value="staging";                                           slotSetting=$true  },
  @{ name="APP_DISPLAY_NAME";                  value="VGC ITSM (STAGING)";                                slotSetting=$true  },
  @{ name="MYSQL_HOST";                        value=$stgHost;                                            slotSetting=$true  },
  @{ name="MYSQL_USER";                        value="itsmadmin";                                         slotSetting=$true  },
  @{ name="MYSQL_PASSWORD";                    value=$stgPwdRef;                                          slotSetting=$true  },
  @{ name="MYSQL_DATABASE";                    value=$prodMysqlDb;                                        slotSetting=$true  },
  @{ name="MYSQL_SSL";                         value="true";                                              slotSetting=$false },
  @{ name="EMAIL_REDIRECT_MODE";               value="true";                                              slotSetting=$true  },
  @{ name="EMAIL_REDIRECT_TARGET";             value=$EmailRedirectTo;                                    slotSetting=$true  },
  @{ name="NOTIFICATIONS_MODE";                value="sandbox";                                           slotSetting=$true  },
  @{ name="PROD_TEST_MODE";                    value="true";                                              slotSetting=$true  },
  @{ name="AI_AUTONOMY_LEVEL";                 value="suggest";                                           slotSetting=$true  },
  @{ name="WEBSITE_SWAP_WARMUP_PING_PATH";     value="/api/health";                                       slotSetting=$false },
  @{ name="WEBSITE_SWAP_WARMUP_PING_STATUSES"; value="200";                                               slotSetting=$false }
)
if ($EntraClientIdStg) {
  $stagingSettings += @{ name="ENTRA_CLIENT_ID"; value=$EntraClientIdStg; slotSetting=$true }
}

Run "Apply slot-sticky settings to staging slot (via JSON file)" {
  $jsonPath = Join-Path $PSScriptRoot ".staging-settings.json"
  ($stagingSettings | ConvertTo-Json -Depth 4) | Set-Content -Path $jsonPath -Encoding UTF8
  az webapp config appsettings set -g $ResourceGroup -n $AppName --slot $SlotName --settings "@$jsonPath" -o none
  if ($LASTEXITCODE -ne 0) { Fail "Failed to apply staging slot settings." }
}

# ─── Mark prod-side keys sticky WITHOUT changing values ───────────────────────
Run "Mark prod sticky keys (preserves existing values)" {
  # Use slotConfigNames to declare sticky-by-name; this avoids overwriting any prod value.
  $stickyNames = @(
    "NODE_ENV","APP_DISPLAY_NAME","MYSQL_HOST","MYSQL_USER","MYSQL_PASSWORD",
    "MYSQL_DATABASE","EMAIL_REDIRECT_MODE","EMAIL_REDIRECT_TARGET",
    "NOTIFICATIONS_MODE","PROD_TEST_MODE","AI_AUTONOMY_LEVEL",
    "AZURE_OPENAI_API_KEY","ENTRA_CLIENT_ID","ENTRA_CLIENT_SECRET"
  )
  $body = @{ properties = @{ appSettingNames = $stickyNames } } | ConvertTo-Json -Depth 5
  $tmp = New-TemporaryFile
  $body | Set-Content -Path $tmp -Encoding UTF8
  $sub = az account show --query id -o tsv
  az rest --method PUT `
    --uri "https://management.azure.com/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$AppName/config/slotConfigNames?api-version=2023-12-01" `
    --body "@$tmp" -o none
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0) { Fail "Failed to update slotConfigNames" }
}

# ─── 9. Enable system-assigned managed identity on slot + grant KV read ──
if ($KeyVaultName) {
  Run "Enable managed identity on staging slot" {
    az webapp identity assign -g $ResourceGroup -n $AppName --slot $SlotName -o none
  }
  Run "Grant slot identity 'Key Vault Secrets User' on $KeyVaultName" {
    $stgId = az webapp identity show -g $ResourceGroup -n $AppName --slot $SlotName --query principalId -o tsv
    if (-not $stgId) { Fail "Could not retrieve staging slot principalId" }
    $kvId  = az keyvault show -n $KeyVaultName --query id -o tsv
    $existing = az role assignment list --assignee $stgId --scope $kvId --query "[?roleDefinitionName=='Key Vault Secrets User'] | [0].id" -o tsv 2>$null
    if ($existing) { Ok "KV role already assigned to slot identity." }
    else {
      az role assignment create --assignee $stgId --role "Key Vault Secrets User" --scope $kvId -o none
      if ($LASTEXITCODE -ne 0) { Fail "Failed to grant KV role to slot identity" }
      Ok "Granted KV role; waiting 30s for AAD propagation..."
      Start-Sleep -Seconds 30
    }
  }
}

# ─── 10. Optional: Seed staging DB from scrubbed prod snapshot ───────────
if ($SeedFromProd) {
  if (-not $Apply) { Warn "SeedFromProd skipped in dry-run." }
  else {
    Info "Seeding staging from scrubbed prod snapshot..."
    $restoreName = "itsm-mysql-restore-$(Get-Date -Format yyyyMMddHHmm)"
    $restoreTime = (Get-Date).ToUniversalTime().AddHours(-1).ToString("yyyy-MM-ddTHH:mm:ssZ")
    Info "Restoring prod to temp server $restoreName at $restoreTime"
    az mysql flexible-server restore -g $ResourceGroup --name $restoreName `
      --source-server $ProdMysqlServer --restore-time $restoreTime | Out-Null

    $dump  = "itsm_prod_snapshot.sql"
    $scrub = "itsm_stg_seed.sql"
    Info "Dumping from restore server (requires mysqldump in PATH)"
    & mysqldump -h "$restoreName.mysql.database.azure.com" -u itsmadmin -p `
      --single-transaction --routines --triggers itsm_data > $dump
    if (-not (Test-Path "scripts/scrub-pii.mjs")) {
      Warn "scripts/scrub-pii.mjs not found — would load UNSCRUBBED dump. ABORTING for safety."
      az mysql flexible-server delete -g $ResourceGroup --name $restoreName --yes | Out-Null
      Fail "Add scripts/scrub-pii.mjs before using -SeedFromProd."
    }
    & node scripts/scrub-pii.mjs $dump $scrub
    Info "Loading scrubbed dump into staging DB"
    Get-Content $scrub -Raw | & mysql -h $stgHost -u itsmadmin -p $StgDbName
    Info "Cleaning up temp restore server"
    az mysql flexible-server delete -g $ResourceGroup --name $restoreName --yes | Out-Null
    Remove-Item $dump, $scrub -Force -ErrorAction SilentlyContinue
    Ok "Staging seeded."
  }
}

# ─── 11. Restart staging + health check ──────────────────────────────────
Run "Restart staging slot" {
  az webapp restart -g $ResourceGroup -n $AppName --slot $SlotName | Out-Null
}
if ($Apply) {
  $stagingUrl = "https://$AppName-$SlotName.azurewebsites.net"
  Info "Health check: $stagingUrl/api/health"
  Start-Sleep -Seconds 15
  try {
    $r = Invoke-RestMethod "$stagingUrl/api/health" -TimeoutSec 30
    Ok "Staging health: $($r | ConvertTo-Json -Depth 3 -Compress)"
  } catch { Warn "Health check failed (may need code deploy first): $_" }
}

# ─── 12. Summary ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host " SUMMARY" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host " Prod URL    : https://$AppName.azurewebsites.net"
Write-Host " Staging URL : https://$AppName-$SlotName.azurewebsites.net"
Write-Host " Prod DB     : $prodMysqlHost / itsm_data"
Write-Host " Staging DB  : $stgHost / $StgDbName"
Write-Host " Key Vault   : $(if ($KeyVaultName) { $KeyVaultName } else { '(none — recommended to add)' })"
Write-Host ""
Write-Host " NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  1. Add https://$AppName-$SlotName.azurewebsites.net as redirect URI in Entra app reg"
Write-Host "  2. Deploy build to staging slot:  .\scripts\deploy-slot.ps1 -Slot staging"
Write-Host "  3. Run e2e tests against staging URL"
Write-Host "  4. Swap when ready:"
Write-Host "     az webapp deployment slot swap -g $ResourceGroup -n $AppName --slot $SlotName --target-slot production"
Write-Host "  5. Rollback (if needed): swap again."
