/**
 * Best-effort PII redaction for routing payloads and telemetry (D-57).
 *
 * This module strips obvious email addresses, phone numbers, and employee-ID
 * shapes from free-text before any outbound egress. It is intentionally
 * conservative: when redaction is uncertain, the caller must skip the hosted
 * provider and fall back to local routing.
 *
 * @module decision/redaction
 */

/**
 * Result of a redaction pass.
 */
export interface RedactionResult {
  /** The redacted text. Safe to log, trace, or send to a hosted provider. */
  readonly text: string;
  /** True when the redactor had to remove or mask content. */
  readonly wasRedacted: boolean;
  /** True when residual identifier-like patterns remain and the hosted
   *  provider must be skipped (deny-by-default, D-57). */
  readonly isUncertain: boolean;
}

/** Patterns that indicate an employee or personal identifier. */
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b|\(?\d{3}\)?[-.\s]?\d{4}\b/g;
const EMPLOYEE_ID_RE = /\b(?:emp|employee|eid|staff)[\-_]?\d{3,}\b/gi;

/**
 * Best-effort redaction of email, phone, and employee-ID patterns.
 *
 * Operates on the current message and every included previous turn.
 * Never throws; unknown input returns the original text marked uncertain.
 */
export function redact(text: string): RedactionResult {
  if (!text || text.trim().length === 0) {
    return { text, wasRedacted: false, isUncertain: false };
  }

  let redacted = text;
  let wasRedacted = false;

  // Strip emails.
  const emailMatches = redacted.match(EMAIL_RE);
  if (emailMatches && emailMatches.length > 0) {
    redacted = redacted.replace(EMAIL_RE, '[redacted-email]');
    wasRedacted = true;
  }

  // Strip phone numbers.
  const phoneMatches = redacted.match(PHONE_RE);
  if (phoneMatches && phoneMatches.length > 0) {
    redacted = redacted.replace(PHONE_RE, '[redacted-phone]');
    wasRedacted = true;
  }

  // Strip employee-ID shapes.
  const empMatches = redacted.match(EMPLOYEE_ID_RE);
  if (empMatches && empMatches.length > 0) {
    redacted = redacted.replace(EMPLOYEE_ID_RE, '[redacted-id]');
    wasRedacted = true;
  }

  const isUncertain = checkUncertainty(redacted);

  return { text: redacted, wasRedacted, isUncertain };
}

/**
 * Returns true when residual identifier-like patterns remain in the text.
 *
 * The hosted-provider path must be skipped when this returns true (D-57
 * deny-by-default). Local routing may continue.
 */
export function isUncertain(text: string): boolean {
  return checkUncertainty(text);
}

/** Heuristic residual-identifier scan. */
function checkUncertainty(text: string): boolean {
  // Residual @ signs that might be part of an uncaught handle or email variant.
  if (/@/.test(text)) return true;

  // Long digit runs that look like phone numbers or IDs.
  if (/\b\d{7,}\b/.test(text)) return true;

  // ID-like prefixes followed by digits.
  if (/\b(?:id|uid|user|emp)[\-_]?\d{3,}\b/i.test(text)) return true;

  return false;
}
