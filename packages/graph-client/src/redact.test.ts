import { describe, it, expect } from 'vitest';
import { redactPii, redactPiiShallow } from '../src/redact.js';

describe('redactPii', () => {
  it('redacts Singapore NRIC', () => {
    expect(redactPii('My NRIC is S1234567D')).toBe('My NRIC is [NRIC_REDACTED]');
  });

  it('redacts FIN number', () => {
    expect(redactPii('FIN: G1234567X')).toBe('FIN: [NRIC_REDACTED]');
  });

  it('redacts SG mobile number', () => {
    expect(redactPii('Call me at 91234567')).toBe('Call me at [PHONE_REDACTED]');
  });

  it('redacts international phone with +65', () => {
    expect(redactPii('Phone: +65 9123 4567')).toBe('Phone: [PHONE_REDACTED]');
  });

  it('redacts email address', () => {
    expect(redactPii('Email john@example.com please')).toBe('Email [EMAIL_REDACTED] please');
  });

  it('leaves non-PII text untouched', () => {
    const safe = 'Reset password for user account in Teams';
    expect(redactPii(safe)).toBe(safe);
  });

  it('is idempotent', () => {
    const input = 'NRIC S1234567D';
    expect(redactPii(redactPii(input))).toBe(redactPii(input));
  });
});

describe('redactPiiShallow', () => {
  it('redacts string values in object', () => {
    const obj = { name: 'S1234567D', count: 42, flag: true };
    const result = redactPiiShallow(obj);
    expect(result.name).toBe('[NRIC_REDACTED]');
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
  });
});
