/*
  Azure App Configuration — feature flags and environment-specific config.
  Labels: dev, staging, production.
  SECURITY: Managed Identity access only.
*/
param environmentName string
param location string
param resourceToken string
param tags object = {}

resource appConfig 'Microsoft.AppConfiguration/configurationStores@2023-03-01' = {
  name: 'appcs-itsm3-${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Standard' // Required for geo-replication + private endpoint
  }
  properties: {
    disableLocalAuth: true // SECURITY: Managed Identity only
    enablePurgeProtection: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: environmentName == 'production' ? 'Disabled' : 'Enabled'
  }
}

// Feature flags
resource featureFlagOpenAI 'Microsoft.AppConfiguration/configurationStores/keyValues@2023-03-01' = {
  parent: appConfig
  name: '.appconfig.featureflag~2Fenable-openai-triage'
  properties: {
    value: '{"id":"enable-openai-triage","description":"Enable OpenAI triage for incoming messages","enabled":true,"conditions":{"client_filters":[]}}'
    contentType: 'application/vnd.microsoft.appconfig.ff+json;charset=utf-8'
  }
}

resource featureFlagTeamsPhone 'Microsoft.AppConfiguration/configurationStores/keyValues@2023-03-01' = {
  parent: appConfig
  name: '.appconfig.featureflag~2Fenable-teams-phone'
  properties: {
    value: '{"id":"enable-teams-phone","description":"Enable ACS Teams Phone for P1 escalation","enabled":false,"conditions":{"client_filters":[]}}'
    contentType: 'application/vnd.microsoft.appconfig.ff+json;charset=utf-8'
  }
}

output appConfigName string = appConfig.name
output appConfigEndpoint string = appConfig.properties.endpoint
