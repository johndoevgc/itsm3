import { z } from 'zod';

/**
 * Environment variable validation.
 * SECURITY: Fail fast at startup if required env vars are missing.
 * Never use default values for secrets — throw with actionable message.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Azure
  AZURE_CLIENT_ID: z.string().min(1, 'azd env set AZURE_CLIENT_ID required'),
  AZURE_TENANT_ID: z.string().min(1, 'azd env set AZURE_TENANT_ID required'),
  COSMOS_ENDPOINT: z.string().url('azd env set COSMOS_ENDPOINT required'),

  // Azure OpenAI
  AZURE_OPENAI_ENDPOINT: z.string().url('azd env set AZURE_OPENAI_ENDPOINT required'),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1).default('gpt-4o'),
  AZURE_OPENAI_API_VERSION: z.string().min(1).default('2024-08-01-preview'),

  // WhatsApp
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, 'azd env set WHATSAPP_VERIFY_TOKEN required'),
  WHATSAPP_TOKEN: z.string().min(1, 'azd env set WHATSAPP_TOKEN required'),

  // Helpdesk phone (E.164 format) — optional; P1 escalation disabled if not set
  // To enable: azd env set HELP_DESK_PHONE=+6569781299
  // SECURITY: Never hardcode this value. Always read from environment.
  HELP_DESK_PHONE: z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, 'HELP_DESK_PHONE must be E.164 format (e.g. +6569781299)')
    .optional(),

  // App Config
  APP_CONFIG_ENDPOINT: z.string().url().optional(),
});

type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Missing/invalid environment variables:\n${missing}\n\nRun: azd env set <VAR> <VALUE>`);
  }
  return result.data;
}

export const env = loadEnv();
