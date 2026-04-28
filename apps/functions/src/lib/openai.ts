import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { SYSTEM_PROMPT_V1, OPENAI_FUNCTIONS, AutoResolveActionSchema } from '@itsm3/ai-prompts';
import { redactPii } from '@itsm3/graph-client';
import type { AutoResolveAction } from '@itsm3/ai-prompts';

export function createOpenAIClient(): AzureOpenAI {
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-08-01-preview';

  if (!endpoint) {
    throw new Error('AZURE_OPENAI_ENDPOINT not set. Run: azd env set AZURE_OPENAI_ENDPOINT required');
  }

  const credential = new DefaultAzureCredential();
  const scope = 'https://cognitiveservices.azure.com/.default';
  const azureADTokenProvider = getBearerTokenProvider(credential, scope);

  return new AzureOpenAI({
    endpoint,
    apiVersion,
    azureADTokenProvider,
  });
}

export interface TriageResult {
  action: AutoResolveAction;
  rawResponse: string;
  tokensUsed: number;
}

export async function triageMessage(
  client: AzureOpenAI,
  userMessage: string,
  context: { tenantId: string; userUpn: string },
): Promise<TriageResult> {
  const safeMessage = redactPii(userMessage);

  const response = await client.chat.completions.create({
    model: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_V1 },
      {
        role: 'user',
        content: `[Tenant: ${context.tenantId}] [User: ${context.userUpn}]\n\n${safeMessage}`,
      },
    ],
    tools: OPENAI_FUNCTIONS,
    tool_choice: 'auto',
    temperature: 0.1,
    max_tokens: 1024,
  });

  const choice = response.choices[0];
  const tokensUsed = response.usage?.total_tokens ?? 0;

  if (choice?.finish_reason === 'tool_calls' && choice.message.tool_calls?.[0]) {
    const toolCall = choice.message.tool_calls[0];
    const args = JSON.parse(toolCall.function.arguments);
    const parsed = AutoResolveActionSchema.parse({ action: toolCall.function.name, ...args });
    return { action: parsed, rawResponse: JSON.stringify(toolCall), tokensUsed };
  }

  return {
    action: { action: 'none', message: choice?.message.content ?? 'How can I help you?' },
    rawResponse: choice?.message.content ?? '',
    tokensUsed,
  };
}
