/**
 * Redaction module tests (D-57).
 */

import { describe, expect, it } from 'vitest';
import { redact, isUncertain, type RedactionResult } from './redaction.js';

describe('redact()', () => {
  it('strips email addresses', () => {
    const result = redact('Contact me at john.doe@example.com for details');
    expect(result.text).toBe('Contact me at [redacted-email] for details');
    expect(result.wasRedacted).toBe(true);
    expect(result.isUncertain).toBe(false);
  });

  it('strips phone numbers', () => {
    const result = redact('Call me at (555) 123-4567 or +1-555-987-6543');
    expect(result.text).toBe('Call me at [redacted-phone] or [redacted-phone]');
    expect(result.wasRedacted).toBe(true);
    expect(result.isUncertain).toBe(false);
  });

  it('strips employee-ID shapes', () => {
    const result = redact('My emp-12345 needs access and staff_999 too');
    expect(result.text).toBe('My [redacted-id] needs access and [redacted-id] too');
    expect(result.wasRedacted).toBe(true);
    expect(result.isUncertain).toBe(false);
  });

  it('strips mixed PII in one pass', () => {
    const result = redact('Email john@acme.com, phone 555-123-4567, emp-007');
    expect(result.text).toBe('Email [redacted-email], phone [redacted-phone], [redacted-id]');
    expect(result.wasRedacted).toBe(true);
    expect(result.isUncertain).toBe(false);
  });

  it('returns clean text unchanged when no PII present', () => {
    const result = redact('I want to request leave');
    expect(result.text).toBe('I want to request leave');
    expect(result.wasRedacted).toBe(false);
    expect(result.isUncertain).toBe(false);
  });

  it('returns empty string unchanged', () => {
    const result = redact('');
    expect(result.text).toBe('');
    expect(result.wasRedacted).toBe(false);
    expect(result.isUncertain).toBe(false);
  });

  it('marks residual @ as uncertain', () => {
    const result = redact('Hey @channel, need help');
    expect(result.isUncertain).toBe(true);
  });

  it('marks long digit runs as uncertain', () => {
    // After redaction the digit run is gone, so redact() returns isUncertain=false.
    // Use isUncertain() directly to assert the heuristic on the original text.
    const result = redact('The ticket number is 1234567890');
    expect(result.text).toBe('The ticket number is [redacted-phone]');
    expect(result.isUncertain).toBe(false);
    expect(isUncertain('The ticket number is 1234567890')).toBe(true);
  });

  it('marks ID-like prefixes with digits as uncertain', () => {
    const result = redact('user_12345 reported an issue');
    expect(result.isUncertain).toBe(true);
  });

  it('handles previous turns as part of combined context', () => {
    const turn1 = 'My email is alice@acme.com';
    const turn2 = 'And my phone is 555-0101';
    const r1 = redact(turn1);
    const r2 = redact(turn2);
    expect(r1.text).toBe('My email is [redacted-email]');
    expect(r2.text).toBe('And my phone is [redacted-phone]');
    expect(r1.isUncertain).toBe(false);
    expect(r2.isUncertain).toBe(false);
  });
});

describe('isUncertain()', () => {
  it('returns false for clean text', () => {
    expect(isUncertain('request leave')).toBe(false);
  });

  it('returns true for residual @', () => {
    expect(isUncertain('see @mention')).toBe(true);
  });

  it('returns true for long digit runs', () => {
    expect(isUncertain('code 987654321')).toBe(true);
  });

  it('returns true for ID-like prefixed digits', () => {
    expect(isUncertain('id_999')).toBe(true);
  });
});
