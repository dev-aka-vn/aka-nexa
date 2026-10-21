import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEK_LENGTH_BYTES } from './key-provider.js';
import { LocalKeyProvider } from './local-key-provider.js';
import { createKeyring } from './key-provider.js';
import { decryptSecret, encryptSecret, type SecretEnvelope } from './envelope.js';

describe('envelope rotation (WINDOW 7)', () => {
  let dir: string;
  let pathA: string;
  let pathB: string;
  let providerA: LocalKeyProvider;
  let providerB: LocalKeyProvider;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'akane-rot-'));
    pathA = join(dir, 'a.key');
    pathB = join(dir, 'b.key');
    writeFileSync(pathA, randomBytes(DEK_LENGTH_BYTES), { mode: 0o600 });
    writeFileSync(pathB, randomBytes(DEK_LENGTH_BYTES), { mode: 0o600 });
    providerA = new LocalKeyProvider({ keyFilePath: pathA, nodeEnv: 'test' });
    providerB = new LocalKeyProvider({ keyFilePath: pathB, nodeEnv: 'test' });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('SecretEnvelope has exactly the frozen field set', async () => {
    const env = await encryptSecret('x', providerA);
    expect(Object.keys(env).sort()).toEqual(['alg', 'ct', 'iv', 'kid', 'tag', 'v']);
  });

  it('decrypts an envelope sealed under a retired kid while retained', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const sealed = await encryptSecret('credential', keyring);
    await keyring.promoteActive(await providerB.keyId(), 1000);
    const opened = await decryptSecret(sealed, keyring);
    expect(opened.toString('utf8')).toBe('credential');
  });

  it('re-wraps onto the new active kid with differing ciphertext and iv', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const sealed = await encryptSecret('credential', keyring);
    await keyring.promoteActive(await providerB.keyId(), 1000);
    const opened = await decryptSecret(sealed, keyring);
    const rewrapped = await encryptSecret(opened, keyring);
    expect(rewrapped.kid).toBe(await providerB.keyId());
    expect(rewrapped.iv).not.toBe(sealed.iv);
    expect(rewrapped.ct).not.toBe(sealed.ct);
  });

  it('rejects with KEY_ID_MISMATCH after the retired kid is removed', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const sealed = await encryptSecret('credential', keyring);
    await keyring.promoteActive(await providerB.keyId(), 1000);
    await keyring.removeKid(await providerA.keyId());
    await expect(decryptSecret(sealed, keyring)).rejects.toThrow(/KEY_ID_MISMATCH/);
  });

  it('does not fall back for an unknown kid', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const sealed = await encryptSecret('credential', keyring);
    const tampered = { ...sealed, kid: 'local-0000000000000000' };
    await expect(decryptSecret(tampered as SecretEnvelope, keyring)).rejects.toThrow(/KEY_ID_MISMATCH/);
  });

  it('tampered ciphertext under a valid kid fails authentication', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const sealed = await encryptSecret('credential', keyring);
    const buf = Buffer.from(sealed.ct, 'base64url');
    buf[0] = (buf[0] as number) ^ 1;
    const corrupted = { ...sealed, ct: buf.toString('base64url') };
    await expect(decryptSecret(corrupted as SecretEnvelope, keyring)).rejects.toThrow(/ENVELOPE_DECRYPT_FAILED/);
  });

  it('concurrent decrypts succeed across the rotation boundary', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const sealed = await encryptSecret('credential', keyring);
    const results: Array<Promise<Buffer>> = [];
    for (let i = 0; i < 5; i++) results.push(decryptSecret(sealed, keyring));
    await keyring.promoteActive(await providerB.keyId(), 1000);
    for (let i = 0; i < 5; i++) results.push(decryptSecret(sealed, keyring));
    const opened = await Promise.all(results);
    for (const b of opened) expect(b.toString('utf8')).toBe('credential');
  });
});