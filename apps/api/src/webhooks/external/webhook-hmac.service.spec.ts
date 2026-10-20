import { describe, expect, it, vi } from 'vitest';
import * as nodeCrypto from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';
import { WebhookHmacService } from './webhook-hmac.service.js';

const SECRET = 'super-secret-value-xyz';
const CONN = 'conn-1';

function sign(secret: string, body: string | Buffer): string {
  return 'sha256=' + nodeCrypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('WebhookHmacService (NOT-01)', () => {
  function makeService(secret: string | null = SECRET) {
    const creds = {
      get: vi.fn(async (ref: string) =>
        secret === null
          ? null
          : ref === `webhook:${CONN}:hmac-sha256`
            ? { credentialRef: ref, headerName: 'x-signature', decryptedValue: secret }
            : null,
      ),
      upsert: vi.fn(),
    } as any;
    return new WebhookHmacService(creds);
  }

  it('passes for a valid signature', async () => {
    const svc = makeService();
    const body = Buffer.from(JSON.stringify({ status: 'done' }));
    const sig = sign(SECRET, body);
    await expect(svc.verify(CONN, body, sig)).resolves.toBeUndefined();
  });

  it('fails when body is mutated after signing', async () => {
    const svc = makeService();
    const body = Buffer.from(JSON.stringify({ status: 'done' }));
    const sig = sign(SECRET, body);
    const mutated = Buffer.from(JSON.stringify({ status: 'tampered' }));
    await expect(svc.verify(CONN, mutated, sig)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails for wrong secret', async () => {
    const svc = makeService();
    const body = Buffer.from(JSON.stringify({ status: 'done' }));
    const sig = sign('wrong-secret', body);
    await expect(svc.verify(CONN, body, sig)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails when signature is missing', async () => {
    const svc = makeService();
    const body = Buffer.from(JSON.stringify({ status: 'done' }));
    await expect(svc.verify(CONN, body, '')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verify(CONN, body, undefined as any)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails (no throw/crash) on length mismatch and does not leak timing', async () => {
    const svc = makeService();
    const body = Buffer.from(JSON.stringify({ status: 'done' }));
    // valid regex shape but wrong length? SIGNATURE_RE requires 64 hex; use a short one
    await expect(svc.verify(CONN, body, 'sha256=abc')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails when secret is missing in store', async () => {
    const svc = makeService(null);
    const body = Buffer.from(JSON.stringify({ status: 'done' }));
    const sig = sign(SECRET, body);
    await expect(svc.verify(CONN, body, sig)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses timing-safe comparison (valid length, wrong value fails)', async () => {
    const svc = makeService();
    const body = Buffer.from(JSON.stringify({ status: 'done' }));
    const valid = sign(SECRET, body);
    // flip last hex char
    const flipped = valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0');
    await expect(svc.verify(CONN, body, flipped)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});