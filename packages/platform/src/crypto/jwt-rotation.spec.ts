import * as jose from 'jose';
import { describe, expect, it } from 'vitest';

import { verifyReadLinkJwt } from './jwt-verifier.js';

async function makeKey() {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
  const privatePem = await jose.exportPKCS8(privateKey);
  const publicPem = await jose.exportSPKI(publicKey);
  return { privateKey, publicPem, privatePem };
}

async function sign(kid: string, privateKey: any, issuer: string, audience: string) {
  return new jose.SignJWT({ foo: 'bar' })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('JWT rotation (WINDOW 7)', () => {
  const issuer = 'iss';
  const audience = 'aud';

  it('verifies a token signed under a retained kid while another is active', async () => {
    const a = await makeKey();
    const b = await makeKey();
    const token = await sign('A', a.privateKey, issuer, audience);
    const payload = await verifyReadLinkJwt(token, a.publicPem, {
      issuer,
      audience,
      algorithms: ['ES256'],
      publicKeys: [
        { kid: 'A', key: a.publicPem },
        { kid: 'B', key: b.publicPem },
      ],
    });
    expect(payload['foo']).toBe('bar');
  });

  it('rejects a token signed under a removed kid without fallback', async () => {
    const a = await makeKey();
    const b = await makeKey();
    const token = await sign('A', a.privateKey, issuer, audience);
    await expect(
      verifyReadLinkJwt(token, b.publicPem, {
        issuer,
        audience,
        algorithms: ['ES256'],
        publicKeys: [{ kid: 'B', key: b.publicPem }],
      }),
    ).rejects.toBeTruthy();
  });

  it('distinguishes removed-kid rejection from malformed token', async () => {
    const a = await makeKey();
    const b = await makeKey();
    const token = await sign('A', a.privateKey, issuer, audience);
    let removedErr: unknown;
    try {
      await verifyReadLinkJwt(token, b.publicPem, {
        issuer,
        audience,
        algorithms: ['ES256'],
        publicKeys: [{ kid: 'B', key: b.publicPem }],
      });
    } catch (e) {
      removedErr = e;
    }
    let malformedErr: unknown;
    try {
      await verifyReadLinkJwt('not.a.jwt', b.publicPem, {
        issuer,
        audience,
        algorithms: ['ES256'],
        publicKeys: [{ kid: 'B', key: b.publicPem }],
      });
    } catch (e) {
      malformedErr = e;
    }
    expect(removedErr).toBeTruthy();
    expect(malformedErr).toBeTruthy();
    expect(String(removedErr)).not.toBe(String(malformedErr));
  });

  it('never falls back for an unknown kid', async () => {
    const a = await makeKey();
    const token = await sign('Z', a.privateKey, issuer, audience);
    await expect(
      verifyReadLinkJwt(token, a.publicPem, {
        issuer,
        audience,
        algorithms: ['ES256'],
        publicKeys: [{ kid: 'A', key: a.publicPem }],
      }),
    ).rejects.toBeTruthy();
  });
});