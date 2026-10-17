import { describe, expect, it } from 'vitest';
import { classifyError } from './error-taxonomy.js';

describe('Redmine error taxonomy (CON-07)', () => {
  describe('401/403/412 → credential_rejected (no retry)', () => {
    it('classifies 401 as credential_rejected', () => {
      const result = classifyError(401);
      expect(result.code).toBe('credential_rejected');
      expect(result.outcome.status).toBe('failed_permanent');
      expect(result.outcome.code).toBe('credential_rejected');
    });

    it('classifies 403 as credential_rejected', () => {
      const result = classifyError(403);
      expect(result.code).toBe('credential_rejected');
      expect(result.outcome.status).toBe('failed_permanent');
      expect(result.outcome.code).toBe('credential_rejected');
    });

    it('classifies 412 as credential_rejected', () => {
      const result = classifyError(412);
      expect(result.code).toBe('credential_rejected');
      expect(result.outcome.status).toBe('failed_permanent');
      expect(result.outcome.code).toBe('credential_rejected');
    });
  });

  describe('422/404-on-create/406 → failed_permanent', () => {
    it('classifies 422 as failed_permanent', () => {
      const result = classifyError(422);
      expect(result.code).toBe('failed_permanent');
      expect(result.outcome.status).toBe('failed_permanent');
      expect(result.outcome.code).toBe('failed_permanent');
    });

    it('classifies 406 as failed_permanent', () => {
      const result = classifyError(406);
      expect(result.code).toBe('failed_permanent');
      expect(result.outcome.status).toBe('failed_permanent');
      expect(result.outcome.code).toBe('failed_permanent');
    });

    it('classifies 404 on create as failed_permanent', () => {
      const result = classifyError(404, { isCreate: true });
      expect(result.code).toBe('failed_permanent');
      expect(result.outcome.status).toBe('failed_permanent');
      expect(result.outcome.code).toBe('failed_permanent');
    });
  });

  describe('5xx/timeout/network → endpoint_unreachable (retryable)', () => {
    it('classifies 500 as endpoint_unreachable', () => {
      const result = classifyError(500);
      expect(result.code).toBe('endpoint_unreachable');
      expect(result.outcome.status).toBe('failed_transient');
      expect(result.outcome.code).toBe('endpoint_unreachable');
    });

    it('classifies 502 as endpoint_unreachable', () => {
      const result = classifyError(502);
      expect(result.code).toBe('endpoint_unreachable');
      expect(result.outcome.status).toBe('failed_transient');
      expect(result.outcome.code).toBe('endpoint_unreachable');
    });

    it('classifies 503 as endpoint_unreachable', () => {
      const result = classifyError(503);
      expect(result.code).toBe('endpoint_unreachable');
      expect(result.outcome.status).toBe('failed_transient');
      expect(result.outcome.code).toBe('endpoint_unreachable');
    });

    it('classifies 504 as endpoint_unreachable', () => {
      const result = classifyError(504);
      expect(result.code).toBe('endpoint_unreachable');
      expect(result.outcome.status).toBe('failed_transient');
      expect(result.outcome.code).toBe('endpoint_unreachable');
    });

    it('classifies timeout errors as endpoint_unreachable', () => {
      const result = classifyError({ message: 'timeout' });
      expect(result.code).toBe('endpoint_unreachable');
      expect(result.outcome.status).toBe('failed_transient');
      expect(result.outcome.code).toBe('endpoint_unreachable');
    });

    it('classifies network errors as endpoint_unreachable', () => {
      const result = classifyError({ message: 'network error' });
      expect(result.code).toBe('endpoint_unreachable');
      expect(result.outcome.status).toBe('failed_transient');
      expect(result.outcome.code).toBe('endpoint_unreachable');
    });

    it('classifies connection refused as endpoint_unreachable', () => {
      const result = classifyError({ code: 'ECONNREFUSED' });
      expect(result.code).toBe('endpoint_unreachable');
      expect(result.outcome.status).toBe('failed_transient');
      expect(result.outcome.code).toBe('endpoint_unreachable');
    });
  });

  it('has no 429 branch (Redmine has no core rate limiting)', () => {
    const result = classifyError(429);
    // Should be conservative - not endpoint_unreachable retryable
    expect(result.code).not.toBe('endpoint_unreachable');
    expect(result.outcome.status).not.toBe('failed_transient');
  });

  it('defaults unknown status to conservative failed_permanent', () => {
    const result = classifyError(400);
    expect(result.code).toBe('failed_permanent');
    expect(result.outcome.status).toBe('failed_permanent');
  });

  it('unknown status boundaries - 408 treated conservatively', () => {
    const result = classifyError(408);
    expect(result.code).toBe('failed_permanent');
    expect(result.outcome.status).toBe('failed_permanent');
  });
});
