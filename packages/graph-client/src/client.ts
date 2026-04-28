import { Client, type AuthenticationProvider } from '@microsoft/microsoft-graph-client';
import { ManagedIdentityCredential, ChainedTokenCredential, WorkloadIdentityCredential } from '@azure/identity';
import { z } from 'zod';

export const GraphClientConfigSchema = z.object({
  tenantId: z.string().min(1, 'tenantId is required'),
  clientId: z.string().min(1, 'clientId (Managed Identity) is required'),
  // Optional: override credential for testing
  credential: z.any().optional(),
});

export type GraphClientConfig = z.infer<typeof GraphClientConfigSchema>;

/**
 * Creates an authenticated Microsoft Graph client using Managed Identity.
 * SECURITY: No secrets. Uses UAMI (User-Assigned Managed Identity) only.
 * SRE: Credential chaining: WorkloadIdentity (ACA) → ManagedIdentity (VM/App Service) → error.
 */
export function createGraphClient(config: GraphClientConfig): Client {
  const parsed = GraphClientConfigSchema.parse(config);

  // Use injected credential for testing, otherwise chain managed identity types
  const credential =
    parsed.credential ??
    new ChainedTokenCredential(
      // Workload Identity for Azure Container Apps (OIDC federation)
      new WorkloadIdentityCredential({ clientId: parsed.clientId, tenantId: parsed.tenantId }),
      // Fallback: VM/App Service Managed Identity
      new ManagedIdentityCredential(parsed.clientId),
    );

  const authProvider: AuthenticationProvider = {
    getAccessToken: async () => {
      const token = await credential.getToken('https://graph.microsoft.com/.default');
      if (!token?.token) {
        throw new Error('GraphClient: Failed to acquire token. Check Managed Identity assignment.');
      }
      return token.token;
    },
  };

  return Client.initWithMiddleware({
    authProvider,
  });
}
