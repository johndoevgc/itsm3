import { describe, it, expect } from 'vitest';
import { redactPii } from '@itsm3/graph-client';

describe('Integration: PII Redaction in message flow', () => {
  it('redacts NRIC before sending to OpenAI', () => {
    const userMessage = 'My NRIC is S1234567D and I cannot login';
    const redacted = redactPii(userMessage);
    expect(redacted).not.toContain('S1234567D');
    expect(redacted).toContain('[NRIC_REDACTED]');
    expect(redacted).toContain('cannot login');
  });

  it('redacts phone before processing', () => {
    const msg = 'Call me back on 91234567 or +65 9123 4567';
    const redacted = redactPii(msg);
    expect(redacted).not.toContain('91234567');
    expect(redacted).not.toContain('+65 9123 4567');
  });

  it('preserves ticket content without PII', () => {
    const msg = 'Teams is down, cannot join meetings';
    expect(redactPii(msg)).toBe(msg);
  });
});
