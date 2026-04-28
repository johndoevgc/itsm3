/*
  Web Container App — Next.js admin portal.
  Serves the React Server Components frontend.
*/
param environmentName string
param location string
param resourceToken string
param containerAppsEnvironmentId string
param apiUrl string
param tags object = {}

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-web-itsm3-${resourceToken}'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
      }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'NODE_ENV', value: environmentName }
            { name: 'NEXT_PUBLIC_API_URL', value: apiUrl }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: environmentName == 'production' ? 2 : 0
        maxReplicas: 10
      }
    }
  }
}

output webUrl string = 'https://${webApp.properties.configuration.ingress.fqdn}'
output webAppName string = webApp.name
