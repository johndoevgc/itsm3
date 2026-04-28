/**
 * @module ai-prompts
 * Versioned system prompts and Zod-validated function schemas for Azure OpenAI.
 * PDPA: Prompts instruct model to never repeat PII back to users.
 * SRE: Schemas prevent prompt injection via strict input validation.
 */

export { SYSTEM_PROMPT_V1 } from './prompts/system-v1.js';
export {
  AutoResolveActionSchema,
  type AutoResolveAction,
  OPENAI_FUNCTIONS,
} from './schemas/auto-resolve.js';
export {
  CreateTicketArgsSchema,
  type CreateTicketArgs,
  EscalateP1ArgsSchema,
  type EscalateP1Args,
  CreateWarroomArgsSchema,
  type CreateWarroomArgs,
} from './schemas/functions.js';
