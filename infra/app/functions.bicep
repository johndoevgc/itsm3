/*
  Functions Container App — AI agent + P1 escalation service.
  Separate from API for bulkhead isolation (SRE requirement).
*/
param environmentName string
param location string
param resourceToken string
param containerAppsEnvironmentId string
param cosmosEndpoint string
param openAiEndpoint string
param acsEndpoint string
param apiUrl string
param tags object = {}

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-fn-itsm3-${resourceToken}'
  location: location
  tags: tags
}

resource functionsApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-fn-itsm3-${resourceToken}'
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
        external: false // Internal only — called by API, not public
        targetPort: 3002
        transport: 'http'
      }
    }
    template: {
      containers: [
        {
          name: 'functions'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('1.0')
            memory: '2Gi' // More resources for AI processing
          }
          env: [
            { name: 'NODE_ENV', value: environmentName }
            { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
            { name: 'AZURE_TENANT_ID', value: subscription().tenantId }
            { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
            { name: 'AZURE_OPENAI_ENDPOINT', value: openAiEndpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: 'gpt-4o' }
            { name: 'ACS_ENDPOINT', value: acsEndpoint }
            { name: 'API_URL', value: apiUrl }
            { name: 'FUNCTIONS_PORT', value: '3002' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 3002 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: environmentName == 'production' ? 1 : 0
        maxReplicas: 5
      }
    }
  }
}

output functionsUrl string = 'https://${functionsApp.properties.configuration.ingress.fqdn}'
output functionsAppName string = functionsApp.name
