/*
  Azure OpenAI module.
  Model: gpt-4o. Region: southeastasia (mandatory).
  SECURITY: Managed Identity access only — no API keys.
*/
param environmentName string
param location string
param resourceToken string
param tags object = {}

var openAiName = 'oai-itsm3-${resourceToken}'

resource openAi 'Microsoft.CognitiveServices/accounts@2024-04-01-preview' = {
  name: openAiName
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: openAiName
    // SECURITY: Disable API key auth — Managed Identity only
    disableLocalAuth: true
    publicNetworkAccess: environmentName == 'production' ? 'Disabled' : 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// Deploy gpt-4o model
resource gpt4oDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-04-01-preview' = {
  parent: openAi
  name: 'gpt-4o'
  sku: {
    name: 'Standard'
    capacity: 10 // 10K TPM — adjust per tenant load
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-08-06'
    }
    versionUpgradeOption: 'NoAutoUpgrade' // SRE: Explicit version control
    raiPolicyName: 'Microsoft.Default'
  }
}

output openAiName string = openAi.name
output openAiEndpoint string = openAi.properties.endpoint
output openAiDeploymentName string = gpt4oDeployment.name
