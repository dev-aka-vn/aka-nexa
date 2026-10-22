import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import {
  SLACK_REPLAY_WINDOW_SECONDS,
  SlackWebhookVerifier,
  verifySlackSignature,
} from './slack-webhook-verifier.js';

/**
 * OUT-04 / T-10-07. These tests are the security contract, not coverage
 * theatre: each one pins a way a naive verifier is wrong.
 */

const SECRET = 'test-signing-secret';
const NOW_SECONDS = 1_700_000_000;
const NOW_MS = NOW_SECONDS * 1000;

/** Slack's signing scheme, re-implemented so the fixture is independent of the code under test. */
function sign(
  body: Buffer | string,
  timestamp: string | number,
  secret = SECRET,
): string {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const payload = Buffer.concat([
    Buffer.from(`v0:${timestamp}:`, 'utf8'),
    bytes,
  ]);
  return `v0=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

const BODY = JSON.stringify({
  type: 'event_callback',
  event_id: 'Ev123',
  event: { type: 'message', text: 'xin chào' },
});

const verify = (
  overrides: Partial<{
    body: Buffer | string | undefined;
    signature: string | undefined;
    timestamp: string | undefined;
    secret: string | undefined;
    nowMs: number;
    replayWindowSeconds: number;
  }> = {},
) =>
  verifySlackSignature(
    'body' in overrides ? overrides.body : BODY,
    'signature' in overrides
      ? overrides.signature
      : sign(BODY, String(NOW_SECONDS)),
    'timestamp' in overrides
      ? overrides.timestamp
      : String(NOW_SECONDS),
    'secret' in overrides ? overrides.secret : SECRET,
    {
      nowMs: overrides.nowMs ?? NOW_MS,
      ...(overrides.replayWindowSeconds === undefined
        ? {}
        : { replayWindowSeconds: overrides.replayWindowSeconds }),
    },
  );

describe('verifySlackSignature — the Slack v0 scheme (OUT-04)', () => {
  it('accepts a correctly signed request and returns the signed timestamp', () => {
    expect(verify()).toEqual({ ok: true, timestamp: NOW_SECONDS });
  });

  it('verifies the raw bytes, not a re-serialised body', () => {
    // Byte-for-byte unusual but valid JSON: pretty-printed, unicode, non-ASCII
    // whitespace. Re-serialising this through JSON.parse/stringify changes the
    // bytes, which is precisely the failure this asserts against.
    const raw = Buffer.from(
      '{\n  "text" : "xin chào — 日本語",\n  "ts": "1700000000.000100"\n}\n',
      'utf8',
    );
    expect(
      verifySlackSignature(raw, sign(raw, String(NOW_SECONDS)), String(NOW_SECONDS), SECRET, {
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: true, timestamp: NOW_SECONDS });

    // The same logical body, re-serialised, does not verify.
    const reserialised = JSON.stringify(JSON.parse(raw.toString('utf8')));
    expect(
      verifySlackSignature(
        reserialised,
        sign(raw, String(NOW_SECONDS)),
        String(NOW_SECONDS),
        SECRET,
        { nowMs: NOW_MS },
      ),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature computed over the body alone (timestamp must be in the signed material)', () => {
    const bodyOnly = `v0=${createHmac('sha256', SECRET).update(BODY).digest('hex')}`;
    expect(verify({ signature: bodyOnly })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });

  it('rejects a tampered body', () => {
    const signature = sign(BODY, String(NOW_SECONDS));
    expect(
      verify({
        body: BODY.replace('xin chào', 'xin chào!'),
        signature,
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects a signature made with a different secret', () => {
    expect(verify({ signature: sign(BODY, String(NOW_SECONDS), 'other-secret') })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });

  it('rejects a timestamp outside the replay window, in both directions', () => {
    const stale = String(NOW_SECONDS - SLACK_REPLAY_WINDOW_SECONDS - 1);
    expect(
      verifySlackSignature(BODY, sign(BODY, stale), stale, SECRET, { nowMs: NOW_MS }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });

    // A far-future timestamp is as much a replay vector as an old one: a
    // signature that never expires is a signature that can be used forever.
    const future = String(NOW_SECONDS + SLACK_REPLAY_WINDOW_SECONDS + 1);
    expect(
      verifySlackSignature(BODY, sign(BODY, future), future, SECRET, { nowMs: NOW_MS }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('honours the window boundary and an override', () => {
    const edge = String(NOW_SECONDS - SLACK_REPLAY_WINDOW_SECONDS);
    expect(verifySlackSignature(BODY, sign(BODY, edge), edge, SECRET, { nowMs: NOW_MS }).ok).toBe(
      true,
    );

    const tooOldForNarrowWindow = String(NOW_SECONDS - 60);
    expect(
      verifySlackSignature(
        BODY,
        sign(BODY, tooOldForNarrowWindow),
        tooOldForNarrowWindow,
        SECRET,
        { nowMs: NOW_MS, replayWindowSeconds: 30 },
      ),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects malformed shapes without computing a digest', () => {
    expect(verify({ signature: undefined })).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    expect(verify({ timestamp: undefined })).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    expect(verify({ timestamp: '17e8' })).toEqual({
      ok: false,
      reason: 'malformed_timestamp',
    });
    expect(verify({ timestamp: '-1700000000' })).toEqual({
      ok: false,
      reason: 'malformed_timestamp',
    });
    expect(verify({ signature: 'sha256=abc' })).toEqual({
      ok: false,
      reason: 'malformed_signature',
    });
    expect(verify({ signature: `v0=${'a'.repeat(63)}` })).toEqual({
      ok: false,
      reason: 'malformed_signature',
    });
  });

  it('fails closed — never accepts — when no signing secret is configured', () => {
    expect(verify({ secret: undefined })).toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(verify({ secret: '' })).toEqual({ ok: false, reason: 'not_configured' });
    // Even a signature that would otherwise be valid.
    expect(
      verifySlackSignature(BODY, sign(BODY, String(NOW_SECONDS)), String(NOW_SECONDS), '', {
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('accepts an empty body only when it is what was signed', () => {
    const empty = Buffer.alloc(0);
    expect(
      verifySlackSignature(
        empty,
        sign(empty, String(NOW_SECONDS)),
        String(NOW_SECONDS),
        SECRET,
        { nowMs: NOW_MS },
      ).ok,
    ).toBe(true);
    expect(
      verifySlackSignature(Buffer.from('{}'), sign(empty, String(NOW_SECONDS)), String(NOW_SECONDS), SECRET, {
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
  });
});

describe('SlackWebhookVerifier — the injectable form', () => {
  it('reads the boot-validated secret from ConfigService', () => {
    const verifier = new SlackWebhookVerifier(
      new ConfigService({ SLACK_SIGNING_SECRET: SECRET }),
    );
    expect(verifier.isConfigured).toBe(true);
    expect(
      verifier.verify(BODY, sign(BODY, String(NOW_SECONDS)), String(NOW_SECONDS), {
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: true, timestamp: NOW_SECONDS });
  });

  it('reports itself unconfigured when the key is absent', () => {
    const verifier = new SlackWebhookVerifier(new ConfigService({}));
    expect(verifier.isConfigured).toBe(false);
    expect(
      verifier.verify(BODY, sign(BODY, String(NOW_SECONDS)), String(NOW_SECONDS), {
        nowMs: NOW_MS,
      }),
    ).toEqual({ ok: false, reason: 'not_configured' });
  });
});
