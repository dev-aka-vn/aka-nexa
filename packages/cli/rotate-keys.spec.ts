import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEK_LENGTH_BYTES } from '@akane/platform';
import { LocalKeyProvider, createKeyring } from '@akane/platform';
import { encryptSecret, decryptSecret } from '@akane/platform';
import { rotateKeys, runRotateKeys } from './rotate-keys.js';

describe('rotate-keys CLI', () => {
  let dir: string;
  let pathA: string;
  let pathB: string;
  let providerA: LocalKeyProvider;
  let providerB: LocalKeyProvider;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'akane-clirot-'));
    pathA = join(dir, 'a.key');
    pathB = join(dir, 'b.key');
    writeFileSync(pathA, randomBytes(DEK_LENGTH_BYTES), { mode: 0o600 });
    writeFileSync(pathB, randomBytes(DEK_LENGTH_BYTES), { mode: 0o600 });
    providerA = new LocalKeyProvider({ keyFilePath: pathA, nodeEnv: 'test' });
    providerB = new LocalKeyProvider({ keyFilePath: pathB, nodeEnv: 'test' });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('promotes a new kid and reports fields', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const newKid = await providerB.keyId();
    const result = await rotateKeys(newKid, keyring, 1000);
    expect(result.alreadyActive).toBe(false);
    expect(result.previousActiveKid).toBe(await providerA.keyId());
    expect(result.newActiveKid).toBe(newKid);
    expect(result.retained).toContain(await providerA.keyId());
    expect(result.overlapExpiry).toBeInstanceOf(Date);
  });

  it('a secret sealed before rotation still decrypts after', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const sealed = await encryptSecret('credential', keyring);
    const newKid = await providerB.keyId();
    await rotateKeys(newKid, keyring, 1000);
    const opened = await decryptSecret(sealed, keyring);
    expect(opened.toString('utf8')).toBe('credential');
  });

  it('repeat invocation reports already-active without changing keyring', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const newKid = await providerB.keyId();
    await rotateKeys(newKid, keyring, 1000);
    const retainedBefore = await keyring.retainedKids();
    const result2 = await rotateKeys(newKid, keyring, 1000);
    expect(result2.alreadyActive).toBe(true);
    const retainedAfter = await keyring.retainedKids();
    expect(retainedAfter).toEqual(retainedBefore);
  });

  it('unknown kid exits non-zero via runRotateKeys', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    process.exitCode = 0;
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runRotateKeys(['does-not-exist'], { keyring, overlapMs: 1000 });
    expect(process.exitCode).toBe(1);
    logSpy.mockRestore();
    process.exitCode = 0;
  });

  it('runRotateKeys prints reported fields', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const newKid = await providerB.keyId();
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
    await runRotateKeys([newKid], { keyring, overlapMs: 1000 });
    spy.mockRestore();
    const out = logs.join('\n');
    expect(out).toContain('previous_active_kid');
    expect(out).toContain('new_active_kid');
    expect(out).toContain('retained');
    expect(out).toContain('overlap_expiry');
  });

  it('rotated kid is the one a subsequent seal records', async () => {
    const keyring = await createKeyring(providerA, [providerB]);
    const newKid = await providerB.keyId();
    await rotateKeys(newKid, keyring, 1000);
    const env = await encryptSecret('x', keyring);
    expect(env.kid).toBe(newKid);
  });
});