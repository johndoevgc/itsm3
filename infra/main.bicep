// ITSM-in-a-Box — Per-Customer Azure Infrastructure
// Deploy: az deployment group create -g <rg> -f main.bicep -p customerName=acme entraClientId=xxx entraTenantId=yyy

@description('Customer short name (lowercase, no spaces). Used in resource naming.')
@minLength(2)
@maxLength(12)
param customerName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('App Service Plan SKU.')
@allowed(['B1', 'B2', 'S1', 'P1v3'])
param appServiceSku string = 'B1'

@description('MySQL Flexible Server SKU.')
@allowed(['Standard_B1ms', 'Standard_B2s', 'Standard_B4ms'])
param mysqlSku string = 'Standard_B1ms'

@description('MySQL administrator login.')
param mysqlAdminLogin string = 'itsmadmin'

@description('MySQL administrator password.')
@secure()
param mysqlAdminPassword string

@description('Entra ID Client (Application) ID for SSO.')
param entraClientId string

@description('Entra ID Tenant ID.')
param entraTenantId string

@description('Organization display name.')
param orgName string

@description('Organization short name.')
param orgShortName string = orgName

@description('Helpdesk mailbox email.')
param helpdeskMailbox string

@description('Mail-from address for notifications.')
param mailFrom string

@description('Azure OpenAI endpoint (optional — leave empty to disable AI).')
param azureOpenAiEndpoint string = ''

@description('Azure OpenAI API key.')
@secure()
param azureOpenAiKey string = ''

@description('Portal URL override (defaults to generated app URL).')
param portalUrl string = ''

@description('Use shared MySQL server instead of creating a new one.')
param useSharedMysql bool = false

@description('Provision a staging deployment slot (requires Standard or higher SKU).')
param enableStagingSlot bool = true

@description('Email redirect target for non-prod (staging slot will redirect all outbound mail here).')
param stagingEmailRedirectTarget string = 'hlaing@vgctechnology.com'

@description('Shared MySQL server name (required if useSharedMysql=true).')
param sharedMysqlServer string = ''

@description('Shared MySQL server resource group (required if useSharedMysql=true).')
param sharedMysqlResourceGroup string = ''

// ─── Naming ───
var prefix = 'itsm-${customerName}'
var appName = '${prefix}-app'
var planName = '${prefix}-plan'
var mysqlServerName = '${prefix}-mysql'
var kvName = 'kv-itsm-${customerName}'
var dbName = 'itsm_data'

// ─── App Service Plan ───
resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: appServiceSku
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

// ─── MySQL Flexible Server (per-customer) ───
resource mysqlServer 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = if (!useSharedMysql) {
  name: mysqlServerName
  location: location
  sku: {
    name: mysqlSku
    tier: 'Burstable'
  }
  properties: {
    version: '8.0.21'
    administratorLogin: mysqlAdminLogin
    administratorLoginPassword: mysqlAdminPassword
    storage: {
      storageSizeGB: 20
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

// ─── MySQL Database ───
resource mysqlDatabase 'Microsoft.DBforMySQL/flexibleServers/databases@2023-12-30' = if (!useSharedMysql) {
  parent: mysqlServer
  name: dbName
  properties: {
    charset: 'utf8mb4'
    collation: 'utf8mb4_unicode_ci'
  }
}

// ─── MySQL Firewall: Allow Azure Services ───
resource mysqlFirewall 'Microsoft.DBforMySQL/flexibleServers/firewallRules@2023-12-30' = if (!useSharedMysql) {
  parent: mysqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ─── Key Vault ───
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

// ─── Key Vault Secrets ───
resource secretMysqlPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'mysql-password'
  properties: {
    value: mysqlAdminPassword
  }
}

resource secretOpenAiKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(azureOpenAiKey)) {
  parent: keyVault
  name: 'openai-api-key'
  properties: {
    value: azureOpenAiKey
  }
}

// ─── Determine MySQL hostname ───
var mysqlHost = useSharedMysql ? '${sharedMysqlServer}.mysql.database.azure.com' : '${mysqlServerName}.mysql.database.azure.com'
var computedPortalUrl = empty(portalUrl) ? 'https://${appName}.azurewebsites.net' : portalUrl

// ─── Web App ───
resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      alwaysOn: appServiceSku != 'B1'
      healthCheckPath: '/healthz'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '8080' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '0' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        // ─── ITSM Config ───
        { name: 'ORG_NAME', value: orgName }
        { name: 'ORG_SHORT_NAME', value: orgShortName }
        { name: 'APP_DISPLAY_NAME', value: '${orgShortName} ITSM' }
        { name: 'PORTAL_URL', value: computedPortalUrl }
        { name: 'HELPDESK_MAILBOX', value: helpdeskMailbox }
        { name: 'MAIL_FROM', value: mailFrom }
        // ─── Entra ID ───
        { name: 'ENTRA_CLIENT_ID', value: entraClientId }
        { name: 'ENTRA_TENANT_ID', value: entraTenantId }
        { name: 'ALLOWED_TENANT_IDS', value: entraTenantId }
        // ─── MySQL ───
        { name: 'MYSQL_HOST', value: mysqlHost }
        { name: 'MYSQL_USER', value: useSharedMysql ? '${customerName}_admin' : mysqlAdminLogin }
        { name: 'MYSQL_PASSWORD', value: '@Microsoft.KeyVault(SecretUri=${secretMysqlPassword.properties.secretUri})' }
        { name: 'MYSQL_DATABASE', value: dbName }
        { name: 'MYSQL_SSL', value: 'true' }
        // ─── AI (optional) ───
        { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
        { name: 'AZURE_OPENAI_API_KEY', value: empty(azureOpenAiKey) ? '' : '@Microsoft.KeyVault(SecretUri=${secretOpenAiKey!.properties.secretUri})' }
        // ─── Safety defaults (PRODUCTION slot) ───
        { name: 'NODE_ENV', value: 'production' }
        { name: 'APP_DISPLAY_NAME', value: '${orgShortName} ITSM' }
        { name: 'PROD_TEST_MODE', value: 'false' }
        { name: 'EMAIL_REDIRECT_MODE', value: 'false' }
        { name: 'NOTIFICATIONS_MODE', value: 'live' }
        { name: 'AI_AUTONOMY_LEVEL', value: 'suggest' }
        // ─── Slot warmup (used when swapping) ───
        { name: 'WEBSITE_SWAP_WARMUP_PING_PATH', value: '/api/health' }
        { name: 'WEBSITE_SWAP_WARMUP_PING_STATUSES', value: '200' }
      ]
    }
  }
}

// ─── Slot-sticky settings on PROD (so a swap does NOT carry these over) ──
resource webAppSlotConfig 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: webApp
  name: 'slotConfigNames'
  properties: {
    appSettingNames: [
      'NODE_ENV'
      'APP_DISPLAY_NAME'
      'MYSQL_HOST'
      'MYSQL_USER'
      'MYSQL_PASSWORD'
      'MYSQL_DATABASE'
      'EMAIL_REDIRECT_MODE'
      'EMAIL_REDIRECT_TARGET'
      'NOTIFICATIONS_MODE'
      'PROD_TEST_MODE'
      'AI_AUTONOMY_LEVEL'
      'AZURE_OPENAI_API_KEY'
      'AZURE_OPENAI_ENDPOINT'
      'ENTRA_CLIENT_ID'
      'ENTRA_CLIENT_SECRET'
    ]
  }
}

// ─── Grant prod web app identity Key Vault Secrets User role ─────────────
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
resource webAppKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, webApp.id, kvSecretsUserRoleId)
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
  }
}

// ─── Staging Slot ───────────────────────────────────────────────────────
resource stagingSlot 'Microsoft.Web/sites/slots@2023-12-01' = if (enableStagingSlot) {
  parent: webApp
  name: 'staging'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      alwaysOn: appServiceSku != 'B1'
      healthCheckPath: '/api/health'
      appSettings: [
        { name: 'NODE_ENV', value: 'staging' }
        { name: 'PORT', value: '8080' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '0' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'APP_DISPLAY_NAME', value: '${orgShortName} ITSM (STAGING)' }
        { name: 'PORTAL_URL', value: 'https://${appName}-staging.azurewebsites.net' }
        { name: 'HELPDESK_MAILBOX', value: helpdeskMailbox }
        { name: 'MAIL_FROM', value: mailFrom }
        // ─── Entra (same app reg by default; swap in a separate one if desired) ───
        { name: 'ENTRA_CLIENT_ID', value: entraClientId }
        { name: 'ENTRA_TENANT_ID', value: entraTenantId }
        { name: 'ALLOWED_TENANT_IDS', value: entraTenantId }
        // ─── MySQL — points at STAGING DB; user must update host/password ───
        // Set MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD via az CLI after deploy,
        // or pass them in via additional secret references.
        { name: 'MYSQL_HOST', value: 'CHANGE_ME_STAGING_HOST' }
        { name: 'MYSQL_USER', value: 'CHANGE_ME' }
        { name: 'MYSQL_PASSWORD', value: 'CHANGE_ME' }
        { name: 'MYSQL_DATABASE', value: dbName }
        { name: 'MYSQL_SSL', value: 'true' }
        // ─── Safety: staging MUST NOT email customers or take live AI actions ───
        { name: 'PROD_TEST_MODE', value: 'true' }
        { name: 'EMAIL_REDIRECT_MODE', value: 'true' }
        { name: 'EMAIL_REDIRECT_TARGET', value: stagingEmailRedirectTarget }
        { name: 'NOTIFICATIONS_MODE', value: 'sandbox' }
        { name: 'AI_AUTONOMY_LEVEL', value: 'suggest' }
        { name: 'WEBSITE_SWAP_WARMUP_PING_PATH', value: '/api/health' }
        { name: 'WEBSITE_SWAP_WARMUP_PING_STATUSES', value: '200' }
      ]
    }
  }
}

// ─── Grant staging slot identity Key Vault Secrets User role ─────────────
resource stagingSlotKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enableStagingSlot) {
  scope: keyVault
  name: guid(keyVault.id, '${webApp.id}/slots/staging', kvSecretsUserRoleId)
  properties: {
    principalId: stagingSlot!.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
  }
}

// ─── Autoscale Settings (Standard / Premium SKUs only) ──────────────────
var enableAutoscale = appServiceSku != 'B1' && appServiceSku != 'B2'
resource autoscaleSettings 'Microsoft.Insights/autoscalesettings@2022-10-01' = if (enableAutoscale) {
  name: '${prefix}-autoscale'
  location: location
  properties: {
    enabled: true
    targetResourceUri: appServicePlan.id
    profiles: [
      {
        name: 'Auto Scale Profile'
        capacity: {
          minimum: '1'
          maximum: '3'
          default: '1'
        }
        rules: [
          {
            scaleAction: {
              direction: 'Increase'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT5M'
            }
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: appServicePlan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 70
            }
          }
          {
            scaleAction: {
              direction: 'Decrease'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT10M'
            }
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: appServicePlan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT10M'
              timeAggregation: 'Average'
              operator: 'LessThan'
              threshold: 30
            }
          }
          {
            scaleAction: {
              direction: 'Increase'
              type: 'ChangeCount'
              value: '1'
              cooldown: 'PT5M'
            }
            metricTrigger: {
              metricName: 'MemoryPercentage'
              metricResourceUri: appServicePlan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 85
            }
          }
        ]
      }
    ]
  }
}

// ─── Outputs ───
output appUrl string = 'https://${webApp.properties.defaultHostName}'
output appName string = webApp.name
output stagingUrl string = enableStagingSlot ? 'https://${stagingSlot!.properties.defaultHostName}' : ''
output mysqlHost string = mysqlHost
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
