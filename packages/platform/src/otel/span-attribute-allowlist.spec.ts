import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_SPAN_ATTRIBUTES,
  SPAN_ATTRIBUTE_ALLOWLIST,
  SPAN_ATTRIBUTE_ALLOWLIST_SET,
  filterSpanAttributes,
} from './span-attribute-allowlist.js';

/**
 * The span-attribute allowlist (FND-07, D-18).
 *
 * ## What this list is protecting
 *
 * D-18 is one of four irreversible Phase 1 contracts. The trace backend is the
 * one store in the architecture with **no per-app RBAC and no erasure path**:
 * whatever attributes leave the process are retained. So the surface is closed by
 * default rather than by review, and every name below is a name someone argued
 * for.
 */
describe('SPAN_ATTRIBUTE_ALLOWLIST (FND-07, D-18)', () => {
  it('is a frozen list, so a runtime mutation cannot widen it', () => {
    expect(Object.isFrozen(SPAN_ATTRIBUTE_ALLOWLIST)).toBe(true);
    expect(() => {
      (SPAN_ATTRIBUTE_ALLOWLIST as unknown as string[]).push('submission_id');
    }).toThrow(TypeError);
  });

  it('contains no duplicate names', () => {
    expect(new Set(SPAN_ATTRIBUTE_ALLOWLIST).size).toBe(SPAN_ATTRIBUTE_ALLOWLIST.length);
  });

  it('does not contain submission_id, nor any submission-derived name', () => {
    // The whole point of the list. Asserted against the explicit forbidden set as
    // well, so adding a *second* identifier (submission, submissionId, submission_ref)
    // to the allowlist while forgetting the list below fails here too.
    for (const forbidden of FORBIDDEN_SPAN_ATTRIBUTES) {
      expect(SPAN_ATTRIBUTE_ALLOWLIST).not.toContain(forbidden);
      expect(SPAN_ATTRIBUTE_ALLOWLIST_SET.has(forbidden)).toBe(false);
    }
    expect(SPAN_ATTRIBUTE_ALLOWLIST).not.toContain('submission_id');
  });

  it('is exactly the frozen literal named in the plan — every addition fails here', () => {
    // The frozen-key-set convention 01-04 and 01-06 use for the log field
    // allowlist and the contract shapes. A test that only asserted
    // "submission_id is absent" would let `user.email` in through the next
    // door; asserting the whole list means widening the attribute surface is a
    // deliberate, reviewable edit to this literal, on the same friction D-16
    // imposed on log fields.
    expect([...SPAN_ATTRIBUTE_ALLOWLIST].sort()).toEqual(
      [
        // service and resource identity
        'service.name',
        'service.version',
        'deployment.environment',
        // HTTP and Nest semantics — both the legacy and the stable
        // (semconv 1.27+) spellings, because the installed
        // instrumentation emits the stable ones and a widening is one-way.
        'http.method',
        'http.request.method',
        'http.route',
        'http.status_code',
        'http.response.status_code',
        'duration_ms',
        // queue semantics
        'messaging.system',
        'messaging.destination.name',
        'messaging.operation',
        'attempt',
        // safe domain identifiers — opaque ids and closed enums only
        'app_id',
        'form_id',
        'action',
        'jti',
        'trace_id',
      ].sort(),
    );
  });

  it('carries no address, URL or free-text attribute the HTTP instrumentation emits', () => {
    // The auto-instrumentation stamps `url.full`, `url.path`, `user_agent.*`,
    // `client.address`, `network.*` and `server.address` on every HTTP span.
    // A URL path is submission-derived in this product (the read-link path), so
    // none of those may be admitted — which is the whole reason the allowlist is
    // enforced at export rather than trusted from callers.
    const emittedByHttpInstrumentation = [
      'url.full',
      'url.path',
      'url.query',
      'url.scheme',
      'user_agent.original',
      'client.address',
      'server.address',
      'server.port',
      'network.peer.address',
      'network.peer.port',
      'network.local.address',
      'network.local.port',
      'network.transport',
      'network.protocol.version',
      'http.target',
      'http.host',
      'http.client_ip',
      'http.user_agent',
      'http.url',
    ];

    for (const attribute of emittedByHttpInstrumentation) {
      expect(SPAN_ATTRIBUTE_ALLOWLIST).not.toContain(attribute);
    }
  });

  it('exposes the membership set the exporter gates on, built from the list itself', () => {
    // If the set were a second hand-maintained literal, the gate and the exported
    // list could disagree — and the exported list is what review reads.
    expect([...SPAN_ATTRIBUTE_ALLOWLIST_SET].sort()).toEqual([...SPAN_ATTRIBUTE_ALLOWLIST].sort());
  });
});

describe('filterSpanAttributes', () => {
  it('keeps allowlisted keys and drops everything else', () => {
    const filtered = filterSpanAttributes({
      'http.route': '/metrics',
      'http.request.method': 'GET',
      submission_id: '9f1c…',
      email: 'someone@example.com',
    });

    expect(Object.keys(filtered).sort()).toEqual(['http.request.method', 'http.route']);
  });

  it('drops every attribute when none is allowlisted', () => {
    expect(filterSpanAttributes({ submission_id: 'x', email: 'y' })).toEqual({});
  });

  it('passes an empty attribute set through unchanged', () => {
    expect(filterSpanAttributes({})).toEqual({});
  });

  it('does not mutate the input object', () => {
    const original = { submission_id: 'x', 'http.route': '/health/live' };
    const snapshot = { ...original };

    filterSpanAttributes(original);

    expect(original).toEqual(snapshot);
  });

  it('preserves an allowlisted value of every JSON type the API permits', () => {
    // A narrowing filter that stringified or dropped non-strings would silently
    // corrupt `duration_ms` (a number) and any array attribute, so the values
    // pass through by reference rather than being rebuilt.
    const attributes = {
      'duration_ms': 12.5,
      'attempt': 2,
      'http.status_code': 200,
      'messaging.operation': 'process',
      'action': 'draft',
      'jti': '0d9f0f9a-6d0e-4b3f-9d1a-2f5f8a3c1b2d',
      'app_id': '4c1f…',
      'form_id': '9ab2…',
      trace_id: '72d32c259894052a4fd5a94ba8fa48ff',
      'service.name': 'api',
      'service.version': '0.0.0',
      'deployment.environment': 'production',
      'messaging.system': 'bullmq',
      'messaging.destination.name': 'platform-heartbeat',
    } as const;

    expect(filterSpanAttributes(attributes)).toEqual(attributes);
  });
});