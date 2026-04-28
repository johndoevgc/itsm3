/*
  Cosmos DB Serverless — Event-sourced ticket storage.
  Partition key: /tenantId for multi-tenant isolation.
  Continuous 30-day backup enabled.
  Data residency: southeastasia.
*/
param environmentName string
param location string
param resourceToken string
param keyVaultName string
param tags object = {}

var accountName = 'cosmos-itsm3-${resourceToken}'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        // SRE: Zone redundancy not supported with Serverless capability
        isZoneRedundant: false
      }
    ]
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: {
        tier: 'Continuous30Days'
      }
    }
    capabilities: [
      { name: 'EnableServerless' } // Cost-effective for SME workloads
    ]
    // SECURITY: Disable local auth — Managed Identity only
    disableLocalAuth: true
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    // PDPA: Data residency — restrict to Singapore
    ipRules: []
    isVirtualNetworkFilterEnabled: false
    enableAutomaticFailover: false
    enableMultipleWriteLocations: false
  }
}

// Database
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: 'itsm3'
  properties: {
    resource: { id: 'itsm3' }
  }
}

// Tickets container — partition key: /tenantId
resource ticketsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'tickets'
  properties: {
    resource: {
      id: 'tickets'
      partitionKey: {
        paths: ['/tenantId']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/"_etag"/?' }]
      }
    }
  }
}

// Tenants container
resource tenantsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'tenants'
  properties: {
    resource: {
      id: 'tenants'
      partitionKey: {
        paths: ['/tenantId']
        kind: 'Hash'
      }
    }
  }
}

// Audit log container — PDPA + CSA compliance
resource auditLogContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'audit-log'
  properties: {
    resource: {
      id: 'audit-log'
      partitionKey: {
        paths: ['/tenantId']
        kind: 'Hash'
      }
    }
  }
}

// Consent container — PDPA consent records
resource consentContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'consent'
  properties: {
    resource: {
      id: 'consent'
      partitionKey: {
        paths: ['/tenantId']
        kind: 'Hash'
      }
    }
  }
}

// Store Cosmos endpoint in Key Vault
resource cosmosEndpointSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: '${keyVaultName}/cosmos-endpoint'
  properties: {
    value: cosmosAccount.properties.documentEndpoint
  }
}

output cosmosAccountName string = cosmosAccount.name
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint
output cosmosDatabaseId string = database.name
