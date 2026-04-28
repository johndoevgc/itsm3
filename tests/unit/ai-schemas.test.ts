import { describe, it, expect } from 'vitest';
import { AutoResolveActionSchema, OPENAI_FUNCTIONS } from '@itsm3/ai-prompts';
import { EscalateP1ArgsSchema } from '@itsm3/ai-prompts';

describe('AutoResolveActionSchema', () => {
  it('validates reset_password action', () => {
    const result = AutoResolveActionSchema.safeParse({
      action: 'reset_password',
      userId: 'user@contoso.com',
      forceChangeAtNextSignIn: true,
    });
    expect(result.success).toBe(true);
  });

  it('validates create_ticket action', () => {
    const result = AutoResolveActionSchema.safeParse({
      action: 'create_ticket',
      title: 'Cannot login to Teams',
      description: 'User cannot authenticate',
      severity: 'B',
      reporterUpn: 'user@contoso.com',
    });
    expect(result.success).toBe(true);
  });

  it('validates escalate_p1 action', () => {
    const result = AutoResolveActionSchema.safeParse({
      action: 'escalate_p1',
      ticketId: 'TICK-001',
      summary: 'Production database down',
      tenantId: 'tenant-123',
    });
    expect(result.success).toBe(true);
  });

  it('validates none action', () => {
    const result = AutoResolveActionSchema.safeParse({
      action: 'none',
      message: 'I can help with that',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown action', () => {
    const result = AutoResolveActionSchema.safeParse({
      action: 'delete_everything',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity', () => {
    const result = AutoResolveActionSchema.safeParse({
      action: 'create_ticket',
      title: 'Test',
      description: 'Test',
      severity: 'Z', // Invalid
      reporterUpn: 'user@contoso.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('EscalateP1ArgsSchema', () => {
  it('validates valid E.164 phone', () => {
    const result = EscalateP1ArgsSchema.safeParse({
      tenantId: 'tenant-1',
      ticketId: 'TICK-001',
      summary: 'Production down',
      helpDeskPhone: '+6569781299',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-E.164 phone', () => {
    const result = EscalateP1ArgsSchema.safeParse({
      tenantId: 'tenant-1',
      ticketId: 'TICK-001',
      summary: 'Production down',
      helpDeskPhone: '6569781299', // Missing +
    });
    expect(result.success).toBe(false);
  });

  it('rejects hardcoded phone number formats', () => {
    const nonE164Phones = ['65-6978-1299', '(65) 6978 1299', '6978 1299'];
    for (const phone of nonE164Phones) {
      const result = EscalateP1ArgsSchema.safeParse({
        tenantId: 'tenant-1',
        ticketId: 'TICK-001',
        summary: 'Test',
        helpDeskPhone: phone,
      });
      expect(result.success).toBe(false);
    }
  });
});

describe('OPENAI_FUNCTIONS', () => {
  it('has required function definitions', () => {
    const names = OPENAI_FUNCTIONS.map((f) => f.function.name);
    expect(names).toContain('reset_password');
    expect(names).toContain('create_ticket');
    expect(names).toContain('escalate_p1');
  });

  it('all functions are type function', () => {
    for (const fn of OPENAI_FUNCTIONS) {
      expect(fn.type).toBe('function');
    }
  });
});
