/*
  API Container App — Fastify backend.
  Auto-scales 0-10 replicas. Health probe on /health.
  SECURITY: UAMI (User-Assigned Managed Identity) for all Azure service access.
*/
param environmentName string
param location string
param resourceToken string
param containerAppsEnvironmentId string
param cosmosEndpoint string
param cosmosAccountName string
param openAiEndpoint string
param keyVaultUri string
param appConfigEndpoint string
param tags object = {}

// User-Assigned Managed Identity for the API
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-api-itsm3-${resourceToken}'
  location: location
  tags: tags
}

// Container App
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-api-itsm3-${resourceToken}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'http'
        // SLO: Health probe must pass within 200ms
        customDomains: []
      }
      // No secrets — all config via env vars referencing Key Vault
    }
    template: {
      containers: [
        {
          name: 'api'
          // Image is set by AZD during deploy
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: environmentName }
            { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
            { name: 'AZURE_TENANT_ID', value: subscription().tenantId }
            { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
            { name: 'AZURE_OPENAI_ENDPOINT', value: openAiEndpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: 'gpt-4o' }
            { name: 'KEY_VAULT_URI', value: keyVaultUri }
            { name: 'APP_CONFIG_ENDPOINT', value: appConfigEndpoint }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health/ready'
                port: 3001
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: environmentName == 'production' ? 2 : 0 // Zero-scale in dev for cost
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}

// Grant UAMI Cosmos DB Built-in Data Contributor via Cosmos RBAC
// Uses Cosmos DB's own RBAC (sqlRoleAssignments), not Azure RBAC
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(uami.id, cosmosAccountName, 'cosmos-data-contributor')
  parent: cosmosAccount
  properties: {
    // 00000000-0000-0000-0000-000000000002 = Cosmos DB Built-in Data Contributor
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: uami.properties.principalId
    scope: cosmosAccount.id
  }
}

output apiUrl string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
output apiAppName string = apiApp.name
output uamiClientId string = uami.properties.clientId
output uamiPrincipalId string = uami.properties.principalId
