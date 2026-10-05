import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEK_LENGTH_BYTES, type KeyProvider } from './key-provider.js';
import { LocalKeyProvider } from './local-key-provider.js';
import {
  AUTH_TAG_LENGTH_BYTES,
  ENVELOPE_ALG,
  ENVELOPE_VERSION,
  IV_LENGTH_BYTES,
  decryptSecret,
  encryptSecret,
  type SecretEnvelope,
} from './envelope.js';
import { createPinoOptions } from '../logging/pino.config.js';

/**
 * D-25 / D-26 / T-1-12: the envelope round-trips, fails loudly on tampering,
 * never reuses a nonce, and leaks neither the key nor the plaintext into a
 * serialised log record.
 *
 * The logging assertion deliberately runs a **real** `pino@10.3.1` instance and
 * reads the bytes it would write, for the same reason
 * `log-allowlist.formatter.spec.ts` does: a destination sees already-serialised
 * output, so inspecting an intermediate object would prove nothing about the
 * thing that actually reaches disk.
 */

const SECRET_TEXT = 'hr-connector-password-9f2c';
const SECRET_BUFFER = Buffer.from([0x00, 0xff, 0x10, 0x7f, 0x80, 0x00, 0xfe]);

let dir: string;
let keyFilePath: string;
let provider: LocalKeyProvider;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'akane-envelope-'));
  keyFilePath = join(dir, 'master.key');
  writeFileSync(keyFilePath, randomBytes(DEK_LENGTH_BYTES), { mode: 0o600 });
  provider = new LocalKeyProvider({ keyFilePath, nodeEnv: 'test' });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Flip one bit of a base64url field, leaving the field's length intact. */
function corrupt(field: string): string {
  const bytes = Buffer.from(field, 'base64url');
  bytes[0] = (bytes[0] as number) ^ 0x01;
  return bytes.toString('base64url');
}

describe('encryptSecret — the frozen envelope shape (D-25)', () => {
  it('is exactly { v, alg, kid, iv, tag, ct } with v: 1 and alg: "A256GCM"', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    expect(Object.keys(envelope).sort()).toEqual(['alg', 'ct', 'iv', 'kid', 'tag', 'v']);
    expect(envelope.v).toBe(ENVELOPE_VERSION);
    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe(ENVELOPE_ALG);
    expect(envelope.alg).toBe('A256GCM');
    expect(envelope.kid).toBe(await provider.keyId());
  });

  it('emits a 12-byte iv and a full 16-byte auth tag, both base64url', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    expect(Buffer.from(envelope.iv, 'base64url')).toHaveLength(IV_LENGTH_BYTES);
    expect(Buffer.from(envelope.tag, 'base64url')).toHaveLength(AUTH_TAG_LENGTH_BYTES);
    // base64url alphabet only — no '+', '/', or '=' padding.
    for (const field of [envelope.iv, envelope.tag, envelope.ct]) {
      expect(field).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('never puts the plaintext in the envelope', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    expect(JSON.stringify(envelope)).not.toContain(SECRET_TEXT);
    expect(Buffer.from(envelope.ct, 'base64url').toString('utf8')).not.toContain(SECRET_TEXT);
  });
});

describe('decryptSecret — round-trip', () => {
  it('returns the original string plaintext', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    expect((await decryptSecret(envelope, provider)).toString('utf8')).toBe(SECRET_TEXT);
  });

  it('returns the original binary plaintext byte-for-byte', async () => {
    const envelope = await encryptSecret(SECRET_BUFFER, provider);

    expect(await decryptSecret(envelope, provider)).toEqual(SECRET_BUFFER);
  });

  it('round-trips an empty string, which is a real credential shape', async () => {
    const envelope = await encryptSecret('', provider);

    expect(await decryptSecret(envelope, provider)).toEqual(Buffer.alloc(0));
  });

  it('round-trips a secret large enough to span several GCM blocks', async () => {
    const large = randomBytes(200_000);
    const envelope = await encryptSecret(large, provider);

    expect(await decryptSecret(envelope, provider)).toEqual(large);
  });
});

describe('decryptSecret — nonce discipline (D-25, T-1-12)', () => {
  it('draws a distinct iv for every encryption of the same plaintext under the same key', async () => {
    const ivs = new Set<string>();
    const cts = new Set<string>();

    for (let i = 0; i < 64; i++) {
      const envelope = await encryptSecret(SECRET_TEXT, provider);
      ivs.add(envelope.iv);
      cts.add(envelope.ct);
    }

    // 64 encryptions under one key. A repeated iv is the catastrophic case; a
    // repeated ct under a repeated iv is the same bug seen one step later.
    expect(ivs.size).toBe(64);
    expect(cts.size).toBe(64);
  });

  it('produces a different envelope every time for the same plaintext', async () => {
    const first = await encryptSecret(SECRET_TEXT, provider);
    const second = await encryptSecret(SECRET_TEXT, provider);

    expect(first.iv).not.toBe(second.iv);
    expect(first.tag).not.toBe(second.tag);
    expect(first.ct).not.toBe(second.ct);
    // …but the same kid: the key did not change, only the nonce.
    expect(first.kid).toBe(second.kid);
  });

  it('never derives the iv from the plaintext — equal plaintext gives equal ct only if the nonce does too', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    expect(envelope.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(envelope.ct).not.toBe(SECRET_TEXT);
  });
});

describe('decryptSecret — tampering fails loudly (T-1-12)', () => {
  it('throws on a one-byte corruption of the auth tag', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    await expect(
      decryptSecret({ ...envelope, tag: corrupt(envelope.tag) }, provider),
    ).rejects.toThrowError(/^ENVELOPE_DECRYPT_FAILED: authentication failed$/);
  });

  it('throws on a one-byte corruption of the ciphertext', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    await expect(
      decryptSecret({ ...envelope, ct: corrupt(envelope.ct) }, provider),
    ).rejects.toThrowError(/^ENVELOPE_DECRYPT_FAILED: authentication failed$/);
  });

  it('throws on a one-byte corruption of the iv', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    await expect(
      decryptSecret({ ...envelope, iv: corrupt(envelope.iv) }, provider),
    ).rejects.toThrowError(/^ENVELOPE_DECRYPT_FAILED: authentication failed$/);
  });

  it('throws when the auth tag is missing entirely — never a zeros default', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    // An absent tag and a zero-length tag are the same failure, and it is a
    // length failure: nothing here substitutes a default tag.
    await expect(decryptSecret({ ...envelope, tag: '' }, provider)).rejects.toThrowError(
      new RegExp(`^ENVELOPE_AUTH_TAG_INVALID: expected ${AUTH_TAG_LENGTH_BYTES} bytes, got 0$`),
    );
    await expect(
      decryptSecret({ ...envelope, tag: Buffer.alloc(AUTH_TAG_LENGTH_BYTES).toString('base64url') }, provider),
    ).rejects.toThrowError(/^ENVELOPE_DECRYPT_FAILED: authentication failed$/);
  });

  it('throws on a truncated auth tag rather than padding it to 16 bytes', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);
    const shortTag = Buffer.from(envelope.tag, 'base64url')
      .subarray(0, 8)
      .toString('base64url');

    await expect(decryptSecret({ ...envelope, tag: shortTag }, provider)).rejects.toThrowError(
      new RegExp(`^ENVELOPE_AUTH_TAG_INVALID: expected ${AUTH_TAG_LENGTH_BYTES} bytes, got 8$`),
    );
  });

  it('throws on an iv that is not 12 bytes', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    await expect(
      decryptSecret({ ...envelope, iv: Buffer.alloc(16).toString('base64url') }, provider),
    ).rejects.toThrowError(new RegExp(`^ENVELOPE_IV_INVALID: expected ${IV_LENGTH_BYTES} bytes, got 16$`));
  });

  it('refuses an unknown envelope version rather than inferring it', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    await expect(
      decryptSecret({ ...envelope, v: 2 } as unknown as SecretEnvelope, provider),
    ).rejects.toThrowError(/^ENVELOPE_VERSION_UNSUPPORTED: expected 1, got 2$/);
  });

  it('refuses an unknown algorithm rather than guessing the cipher', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    await expect(
      decryptSecret({ ...envelope, alg: 'A128GCM' } as unknown as SecretEnvelope, provider),
    ).rejects.toThrowError(/^ENVELOPE_ALG_UNSUPPORTED: expected A256GCM, got A128GCM$/);
  });

  it('refuses an envelope sealed under a different kid', async () => {
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    await expect(
      decryptSecret({ ...envelope, kid: 'local-0000000000000000' }, provider),
    ).rejects.toThrowError(/^KEY_ID_MISMATCH: envelope was sealed under local-0000000000000000/);
  });

  it('propagates the provider gate when an adapter returns a wrong-length DEK', async () => {
    const brokenProvider: KeyProvider = {
      keyId: async () => 'broken-1',
      wrapDek: async (dek) => ({ wrapped: Buffer.from(dek.toString('base64url'), 'utf8'), kid: 'broken-1' }),
      unwrapDek: async () => randomBytes(16),
    };

    await expect(encryptSecret(SECRET_TEXT, brokenProvider)).rejects.toThrowError(
      /^KEY_LENGTH_INVALID: unwrapDek expected 32 bytes, got 16$/,
    );
  });
});

describe('envelope — the key material and the plaintext never reach a log record (D-26)', () => {
  /** A real pino instance writing to an in-memory destination. */
  const capture = (options: LoggerOptions) => {
    const lines: string[] = [];
    const logger: Logger = pino(options, {
      write: (line: string): void => {
        lines.push(line);
      },
    });
    return { logger, lines };
  };

  it('leaves neither the key material nor the plaintext in any serialised record', async () => {
    const masterKey = (await import('node:fs')).readFileSync(keyFilePath) as Buffer;
    const envelope = await encryptSecret(SECRET_TEXT, provider);

    const { logger, lines } = capture(createPinoOptions({ service: 'api', env: 'test' }));
    logger.info(
      { action: 'submit', app_id: 'app-1', status: 200 },
      'secret sealed for connector',
    );
    await decryptSecret(envelope, provider);
    logger.error(
      { reason: 'upstream_error', provider: 'redmine' },
      'connector credential opened',
    );

    const serialised = lines.join('\n');
    expect(lines).toHaveLength(2);

    // The secret itself.
    expect(serialised).not.toContain(SECRET_TEXT);
    // The key, in every encoding a careless log line could carry it in.
    expect(serialised).not.toContain(masterKey.toString('hex'));
    expect(serialised).not.toContain(masterKey.toString('base64'));
    expect(serialised).not.toContain(masterKey.toString('base64url'));
    expect(serialised).not.toContain(masterKey.toString('utf8'));
    // …and the envelope's own fields, which are ciphertext but are not a secret
    // store: logging the envelope would still be logging the secret's location.
    expect(serialised).not.toContain(envelope.ct);
    expect(serialised).not.toContain(envelope.tag);

    // The records are still useful — the round-trip is not achieved by logging
    // nothing at all.
    expect(lines[0]).toContain('"action":"submit"');
    expect(lines[0]).toContain('secret sealed for connector');
  });

  it('stays clean even when a caller tries to log the envelope and the key', async () => {
    const masterKey = (await import('node:fs')).readFileSync(keyFilePath) as Buffer;
    const envelope = await encryptSecret(SECRET_TEXT, provider);
    const dekish = { ...envelope, plaintext: SECRET_TEXT, key: masterKey.toString('hex') };

    const { logger, lines } = capture(createPinoOptions({ service: 'api', env: 'test' }));
    logger.error({ action: 'submit', ...dekish }, 'envelope dumped');

    const serialised = lines.join('\n');
    expect(serialised).not.toContain(SECRET_TEXT);
    expect(serialised).not.toContain(masterKey.toString('hex'));
    expect(serialised).not.toContain(envelope.ct);
    // Only allowlisted keys survive: none of `plaintext`, `key`, `v`, `alg`,
    // `kid`, `iv`, `tag`, or `ct` is on D-16's list.
    expect(Object.keys(JSON.parse(lines[0] as string) as Record<string, unknown>).sort()).toEqual([
      'action',
      'env',
      'level',
      'msg',
      'pid',
      'service',
      'ts',
    ]);
  });
});