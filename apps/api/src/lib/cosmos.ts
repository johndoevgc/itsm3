import { CosmosClient } from '@azure/cosmos';
import { ManagedIdentityCredential } from '@azure/identity';
import { env } from './env.js';

/**
 * Cosmos DB client factory.
 * SECURITY: Uses Managed Identity — no connection strings.
 * Data Residency: All containers must be in southeastasia.
 */
let _cosmosClient: CosmosClient | null = null;

export function getCosmosClient(): CosmosClient {
  if (!_cosmosClient) {
    const credential = new ManagedIdentityCredential(env.AZURE_CLIENT_ID);
    _cosmosClient = new CosmosClient({
      endpoint: env.COSMOS_ENDPOINT,
      aadCredentials: credential,
    });
  }
  return _cosmosClient;
}

export const DATABASE_ID = 'itsm3';

export const CONTAINERS = {
  TICKETS: 'tickets',
  TENANTS: 'tenants',
  AUDIT_LOG: 'audit-log',
  CONSENT: 'consent',
} as const;
