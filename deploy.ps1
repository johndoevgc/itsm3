#Requires -Version 7.0
<#
.SYNOPSIS
    VGC-ITSM Azure Deployment Script — Southeast Asia Region
.DESCRIPTION
    Deploys VGC-ITSM web application with Azure SQL Serverless,
    App Service (P1v3), Entra ID app registration, and networking.
    All resources provisioned in Southeast Asia (singaporecentral).
.NOTES
    Prerequisites:
      - Azure CLI 2.50+ (az login completed)
      - PowerShell 7+
      - Node.js 20+ with npm
      - Git
    Usage:
      .\deploy.ps1 -ResourceGroup "rg-vgc-itsm-prod" -Environment "prod"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ResourceGroup = "rg-vgc-itsm-prod",

    [Parameter(Mandatory = $false)]
    [string]$Environment = "prod",

    [Parameter(Mandatory = $false)]
    [string]$Location = "southeastasia",

    [Parameter(Mandatory = $false)]
    [string]$SqlAdminUser = "vgcitsm-admin",

    [Parameter(Mandatory = $false)]
    [string]$AppName = "vgc-itsm-$Environment",

    [Parameter(Mandatory = $false)]
    [string]$SqlServerName = "sql-vgc-itsm-$Environment",

    [Parameter(Mandatory = $false)]
    [string]$SqlDbName = "sqldb-vgc-itsm-$Environment",

    # ─── Routine code-update flow (slot-aware, safe-by-default) ─────────
    # Use:  .\deploy.ps1 -Update            # build + push to staging slot
    #       .\deploy.ps1 -Update -Swap      # also swap staging -> prod
    #       .\deploy.ps1 -Update -Swap -Rollback  # revert last swap
    [Parameter(Mandatory = $false)]
    [switch]$Update,

    [Parameter(Mandatory = $false)]
    [switch]$Swap,

    [Parameter(Mandatory = $false)]
    [switch]$Rollback
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ─── Routine update path (delegates to slot-aware deploy) ──────────────
if ($Update -or $Swap -or $Rollback) {
    $slotScript = Join-Path $PSScriptRoot "scripts/deploy-slot.ps1"
    if (-not (Test-Path $slotScript)) {
        Write-Host "  ✘ scripts/deploy-slot.ps1 not found" -ForegroundColor Red
        exit 1
    }
    Write-Host "`n▸ Routine update via staging slot (safe-by-default)" -ForegroundColor Cyan
    if ($Swap -and -not $Update) {
        # Swap-only (already deployed to staging earlier)
        & $slotScript -Swap:$true -Rollback:$Rollback
    } else {
        # Build + push to staging, then optionally swap
        & $slotScript -Slot staging
        if ($LASTEXITCODE -ne 0) { Write-Host "  ✘ Staging deploy failed" -ForegroundColor Red; exit 1 }
        if ($Swap) {
            & $slotScript -Swap:$true -Rollback:$Rollback
        } else {
            Write-Host "`nStaging URL: https://vgc-itsm1-app-staging.azurewebsites.net" -ForegroundColor Yellow
            Write-Host "When ready to promote: .\deploy.ps1 -Swap" -ForegroundColor Yellow
        }
    }
    exit $LASTEXITCODE
}

# ─── Helpers ────────────────────────────────────────────────────────────
function Write-Step { param([string]$Message) Write-Host "`n▸ $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "  ✔ $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "  ⚠ $Message" -ForegroundColor Yellow }
function Write-Fail { param([string]$Message) Write-Host "  ✘ $Message" -ForegroundColor Red }

# ─── Pre-flight Checks ─────────────────────────────────────────────────
Write-Step "Pre-flight checks"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Fail "Azure CLI not found. Install from https://aka.ms/installazurecli"
    exit 1
}
Write-Ok "Azure CLI found"

$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Fail "Not logged in. Run 'az login' first."
    exit 1
}
Write-Ok "Logged in as $($account.user.name) (Subscription: $($account.name))"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js not found. Install from https://nodejs.org"
    exit 1
}
Write-Ok "Node.js $(node --version) found"

# ─── 1. Resource Group ─────────────────────────────────────────────────
Write-Step "Creating Resource Group '$ResourceGroup' in $Location"
az group create --name $ResourceGroup --location $Location --output none
Write-Ok "Resource Group ready"

# ─── 2. Azure SQL Serverless ───────────────────────────────────────────
Write-Step "Provisioning Azure SQL Serverless"

# Generate a strong random password
$chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = [byte[]]::new(32)
$rng.GetBytes($bytes)
$SqlAdminPass = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

az sql server create `
    --name $SqlServerName `
    --resource-group $ResourceGroup `
    --location $Location `
    --admin-user $SqlAdminUser `
    --admin-password $SqlAdminPass `
    --output none
Write-Ok "SQL Server '$SqlServerName' created"

az sql db create `
    --name $SqlDbName `
    --server $SqlServerName `
    --resource-group $ResourceGroup `
    --edition GeneralPurpose `
    --family Gen5 `
    --capacity 2 `
    --compute-model Serverless `
    --auto-pause-delay 60 `
    --min-capacity 0.5 `
    --max-size 32GB `
    --backup-storage-redundancy Local `
    --output none
Write-Ok "SQL Database '$SqlDbName' created (Serverless, Gen5, 2 vCores, auto-pause 60 min)"

# Allow Azure services
az sql server firewall-rule create `
    --server $SqlServerName `
    --resource-group $ResourceGroup `
    --name AllowAzureServices `
    --start-ip-address 0.0.0.0 `
    --end-ip-address 0.0.0.0 `
    --output none
Write-Ok "Firewall rule for Azure services added"

# ─── 3. App Service Plan & Web App ─────────────────────────────────────
Write-Step "Creating App Service Plan (P1v3) and Web App"

$planName = "asp-vgc-itsm-$Environment"
az appservice plan create `
    --name $planName `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku P1V3 `
    --is-linux `
    --output none
Write-Ok "App Service Plan '$planName' (P1v3 Linux) created"

az webapp create `
    --name $AppName `
    --resource-group $ResourceGroup `
    --plan $planName `
    --runtime "NODE:20-lts" `
    --output none
Write-Ok "Web App '$AppName' created"

# Configure app settings
$connString = "Server=tcp:${SqlServerName}.database.windows.net,1433;Database=${SqlDbName};Authentication=Active Directory Default;Encrypt=True;TrustServerCertificate=False;"

az webapp config appsettings set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --settings `
        WEBSITE_NODE_DEFAULT_VERSION="~20" `
        SCM_DO_BUILD_DURING_DEPLOYMENT="true" `
        AZURE_SQL_CONNECTION_STRING=$connString `
        PDPA_DATA_RETENTION_DAYS="2555" `
        APP_ENVIRONMENT=$Environment `
        APP_REGION=$Location `
    --output none
Write-Ok "App settings configured"

# Enable HTTPS-only
az webapp update `
    --name $AppName `
    --resource-group $ResourceGroup `
    --https-only true `
    --output none
Write-Ok "HTTPS-only enforced"

# Set startup command
az webapp config set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --startup-file "node server.js" `
    --output none
Write-Ok "Startup command set to 'node server.js'"

# ─── 4. Networking (VNet + Private Endpoint) ───────────────────────────
Write-Step "Setting up networking"

$vnetName = "vnet-vgc-itsm-$Environment"
$subnetApp = "snet-app"
$subnetDb = "snet-db"

az network vnet create `
    --name $vnetName `
    --resource-group $ResourceGroup `
    --location $Location `
    --address-prefix 10.0.0.0/16 `
    --output none

az network vnet subnet create `
    --vnet-name $vnetName `
    --resource-group $ResourceGroup `
    --name $subnetApp `
    --address-prefixes 10.0.1.0/24 `
    --delegations Microsoft.Web/serverFarms `
    --output none

az network vnet subnet create `
    --vnet-name $vnetName `
    --resource-group $ResourceGroup `
    --name $subnetDb `
    --address-prefixes 10.0.2.0/24 `
    --output none

Write-Ok "VNet '$vnetName' with subnets created"

# VNet integration for web app
az webapp vnet-integration add `
    --name $AppName `
    --resource-group $ResourceGroup `
    --vnet $vnetName `
    --subnet $subnetApp `
    --output none
Write-Ok "Web App VNet integration enabled"

# Private endpoint for SQL
$sqlServerId = az sql server show --name $SqlServerName --resource-group $ResourceGroup --query id -o tsv

az network private-endpoint create `
    --name "pe-sql-vgc-itsm" `
    --resource-group $ResourceGroup `
    --vnet-name $vnetName `
    --subnet $subnetDb `
    --private-connection-resource-id $sqlServerId `
    --group-ids sqlServer `
    --connection-name "sql-private-connection" `
    --output none
Write-Ok "SQL Private Endpoint created"

# ─── 5. Entra ID App Registration ──────────────────────────────────────
Write-Step "Registering Entra ID application for SSO"

$appUrl = "https://${AppName}.azurewebsites.net"
$replyUrl = "$appUrl/.auth/login/aad/callback"

$entraApp = az ad app create `
    --display-name "VGC-ITSM ($Environment)" `
    --web-redirect-uris $replyUrl `
    --sign-in-audience AzureADMyOrg `
    --output json | ConvertFrom-Json

$entraAppId = $entraApp.appId
Write-Ok "Entra ID App registered (Client ID: $entraAppId)"

# Create service principal
az ad sp create --id $entraAppId --output none 2>$null
Write-Ok "Service Principal created"

# Enable App Service Authentication (Easy Auth)
az webapp auth microsoft update `
    --name $AppName `
    --resource-group $ResourceGroup `
    --client-id $entraAppId `
    --issuer "https://login.microsoftonline.com/$($account.tenantId)/v2.0" `
    --output none 2>$null
Write-Ok "App Service Entra ID authentication configured"

# ─── 6. NSG for database subnet ────────────────────────────────────────
Write-Step "Applying Network Security Group"

$nsgName = "nsg-db-vgc-itsm"
az network nsg create `
    --name $nsgName `
    --resource-group $ResourceGroup `
    --location $Location `
    --output none

az network nsg rule create `
    --nsg-name $nsgName `
    --resource-group $ResourceGroup `
    --name AllowAppSubnet `
    --priority 100 `
    --direction Inbound `
    --access Allow `
    --protocol Tcp `
    --source-address-prefixes 10.0.1.0/24 `
    --destination-port-ranges 1433 `
    --output none

az network nsg rule create `
    --nsg-name $nsgName `
    --resource-group $ResourceGroup `
    --name DenyAllInbound `
    --priority 4096 `
    --direction Inbound `
    --access Deny `
    --protocol "*" `
    --source-address-prefixes "*" `
    --destination-port-ranges "*" `
    --output none

az network vnet subnet update `
    --vnet-name $vnetName `
    --resource-group $ResourceGroup `
    --name $subnetDb `
    --network-security-group $nsgName `
    --output none
Write-Ok "NSG applied to database subnet"

# ─── 7. Build & Deploy Application ─────────────────────────────────────
Write-Step "Building application"

Push-Location $PSScriptRoot
npm ci --production=false
npx vite build
Write-Ok "Vite build completed"

Write-Step "Deploying to Azure Web App"
$zipPath = Join-Path $env:TEMP "vgc-itsm-deploy.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path @("./server.js", "./package.json", "./dist") -DestinationPath $zipPath -Force

az webapp deploy `
    --name $AppName `
    --resource-group $ResourceGroup `
    --src-path $zipPath `
    --type zip `
    --output none
Write-Ok "Application deployed to $appUrl"
Pop-Location

# ─── 8. Summary ────────────────────────────────────────────────────────
Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host "  VGC-ITSM Deployment Complete" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Region:          $Location (Southeast Asia)" -ForegroundColor White
Write-Host "  Resource Group:  $ResourceGroup" -ForegroundColor White
Write-Host "  Web App URL:     $appUrl" -ForegroundColor Green
Write-Host "  SQL Server:      ${SqlServerName}.database.windows.net" -ForegroundColor White
Write-Host "  SQL Database:    $SqlDbName (Serverless, Gen5)" -ForegroundColor White
Write-Host "  Entra ID App:    $entraAppId" -ForegroundColor White
Write-Host "  VNet:            $vnetName (10.0.0.0/16)" -ForegroundColor White
Write-Host "  Private Endpoint: pe-sql-vgc-itsm" -ForegroundColor White
Write-Host ""
Write-Host "  ⚠ Store the SQL admin password securely:" -ForegroundColor Yellow
Write-Host "    User: $SqlAdminUser" -ForegroundColor Yellow
Write-Host "    (Password was auto-generated — store in Azure Key Vault)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Next Steps:" -ForegroundColor DarkCyan
Write-Host "    1. Configure custom domain & SSL certificate" -ForegroundColor White
Write-Host "    2. Set up Azure Key Vault for secrets" -ForegroundColor White
Write-Host "    3. Configure Entra ID group-to-role mappings" -ForegroundColor White
Write-Host "    4. Enable Azure Monitor & Application Insights" -ForegroundColor White
Write-Host "    5. Set up CI/CD pipeline (GitHub Actions)" -ForegroundColor White
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor DarkCyan
