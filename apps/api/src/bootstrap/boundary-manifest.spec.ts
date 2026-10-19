import { getQueueToken } from '@nestjs/bullmq';
import { describe, expect, it } from 'vitest';

import {
  INBOUND_EVENTS_QUEUE,
  INBOUND_ADAPTER_REGISTRATIONS,
  NOTIFICATION_SEND_QUEUE,
  QUEUE_PRODUCER_TOKEN,
} from '@akane/platform';

import { API_BOUNDARY_MANIFEST } from './boundary-manifest.js';

describe('api boundary manifest (D-37)', () => {
  it('declares exactly the three D-37 exceptions in `allowed`', () => {
    expect(API_BOUNDARY_MANIFEST.allowed).toBeDefined();
    const allowed = [...(API_BOUNDARY_MANIFEST.allowed ?? [])];
    expect(allowed).toHaveLength(3);
    expect(allowed).toContain(getQueueToken(INBOUND_EVENTS_QUEUE));
    expect(allowed).toContain(getQueueToken(NOTIFICATION_SEND_QUEUE));
    expect(allowed).toContain(INBOUND_ADAPTER_REGISTRATIONS);
  });

  it('keeps QUEUE_PRODUCER_TOKEN (the heartbeat producer) forbidden', () => {
    expect(API_BOUNDARY_MANIFEST.forbidden).toContain(QUEUE_PRODUCER_TOKEN);
  });

  it('has no token in both `forbidden` and `allowed`', () => {
    const forbidden = new Set(API_BOUNDARY_MANIFEST.forbidden);
    for (const token of API_BOUNDARY_MANIFEST.allowed ?? []) {
      expect(forbidden.has(token)).toBe(false);
    }
  });
});
