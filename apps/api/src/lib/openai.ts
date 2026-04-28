import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { env } from './env.js';
import { SYSTEM_PROMPT_V1, OPENAI_FUNCTIONS, AutoResolveActionSchema } from '@itsm3/ai-prompts';
import { redactPii } from '@itsm3/graph-client';
import type { AutoResolveAction } from '@itsm3/ai-prompts';

/**
 * Azure OpenAI client factory.
 * SECURITY: Uses Managed Identity token via DefaultAzureCredential — no API keys.
 * Uses AzureOpenAI class from the openai SDK for proper Azure AD token auth.
 * SRE: Feature-flag gated — if OpenAI unavailable, falls back to ticket creation only.
 * PDPA: Input is redacted before sending to OpenAI.
 */
export function createOpenAIClient(): AzureOpenAI {
  const credential = new DefaultAzureCredential();
  // Azure OpenAI scope for token acquisition
  const scope = 'https://cognitiveservices.azure.com/.default';
  const azureADTokenProvider = getBearerTokenProvider(credential, scope);

  return new AzureOpenAI({
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    apiVersion: env.AZURE_OPENAI_API_VERSION,
    azureADTokenProvider,
  });
}

export interface TriageResult {
  action: AutoResolveAction;
  rawResponse: string;
  tokensUsed: number;
}

/**
 * Triages a user message using Azure OpenAI gpt-4o.
 * Returns a validated AutoResolveAction.
 *
 * PDPA: Message is redacted before sending to OpenAI.
 * SECURITY: Model output is always validated via Zod before execution.
 * SRE: Throws TriageError with retryable=false on model refusal.
 */
export async function triageMessage(
  client: AzureOpenAI,
  userMessage: string,
  context: { tenantId: string; userUpn: string },
): Promise<TriageResult> {
  // PDPA: Strip PII before sending to OpenAI
  const safeMessage = redactPii(userMessage);

  let response: Awaited<ReturnType<AzureOpenAI['chat']['completions']['create']>>;
  try {
    response = await client.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_V1 },
        {
          role: 'user',
          content: `[Tenant: ${context.tenantId}] [User: ${context.userUpn}]\n\n${safeMessage}`,
        },
      ],
      tools: OPENAI_FUNCTIONS,
      tool_choice: 'auto',
      temperature: 0.1, // Low temp for deterministic ITSM actions
      max_tokens: 1024,
    });
  } catch (err: unknown) {
    throw new TriageError(`OpenAI API call failed: ${String(err)}`, { retryable: true });
  }

  const choice = response.choices[0];
  if (!choice) {
    throw new TriageError('No choices returned from OpenAI', { retryable: false });
  }

  const tokensUsed = response.usage?.total_tokens ?? 0;

  // If model called a function, parse and validate it
  if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.[0]) {
    const toolCall = choice.message.tool_calls[0];
    const functionName = toolCall.function.name;
    let args: unknown;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new TriageError(
        `OpenAI returned invalid JSON for function ${functionName}`,
        { retryable: false },
      );
    }

    // SECURITY: Validate the model's output via Zod
    const parsed = AutoResolveActionSchema.safeParse({ action: functionName, ...args });
    if (!parsed.success) {
      throw new TriageError(
        `OpenAI returned invalid action: ${parsed.error.message}`,
        { retryable: false },
      );
    }

    return {
      action: parsed.data,
      rawResponse: JSON.stringify(toolCall),
      tokensUsed,
    };
  }

  // Model responded with a text message (no action needed)
  return {
    action: {
      action: 'none',
      message: choice.message.content ?? 'I can help with that. Could you provide more details?',
    },
    rawResponse: choice.message.content ?? '',
    tokensUsed,
  };
}

export class TriageError extends Error {
  retryable: boolean;

  constructor(message: string, options: { retryable: boolean }) {
    super(message);
    this.name = 'TriageError';
    this.retryable = options.retryable;
  }
}
