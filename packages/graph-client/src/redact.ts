/**
 * PII redaction utilities.
 * PDPA: Must be applied before logging or sending data to OpenAI.
 * Patterns: Singapore NRIC/FIN, phone numbers (SG + international), email, credit card.
 */

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // Singapore NRIC / FIN: S/T/F/G + 7 digits + checksum letter
  {
    name: 'NRIC_FIN',
    pattern: /\b[STFG]\d{7}[A-Z]\b/gi,
    replacement: '[NRIC_REDACTED]',
  },
  // Singapore phone numbers: +65 XXXX XXXX or 8/9 XXXXXXX
  {
    name: 'SG_PHONE',
    pattern: /(\+65[\s-]?)?[89]\d{3}[\s-]?\d{4}\b/g,
    replacement: '[PHONE_REDACTED]',
  },
  // International E.164 phone numbers
  {
    name: 'INTL_PHONE',
    pattern: /\+\d{1,3}[\s-]?\d{4,14}\b/g,
    replacement: '[PHONE_REDACTED]',
  },
  // Email addresses
  {
    name: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[EMAIL_REDACTED]',
  },
  // Credit card numbers (basic Luhn-matching pattern)
  {
    name: 'CREDIT_CARD',
    pattern: /\b(?:\d[ -]?){13,16}\b/g,
    replacement: '[CC_REDACTED]',
  },
];

/**
 * Redacts known PII patterns from a string.
 * Safe to call multiple times (idempotent).
 *
 * @param input - Raw text potentially containing PII
 * @returns Text with PII replaced by redaction markers
 */
export function redactPii(input: string): string {
  let result = input;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Redacts PII from an object (shallow — top-level string values only).
 * For deep redaction use redactPiiDeep.
 */
export function redactPiiShallow(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? redactPii(v) : v]),
  );
}
