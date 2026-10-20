import { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConfigModule, MongoModule, CryptoModule, redisCacheProvider, redisQueueProvider } from '@akane/platform';
import { ApiQueueModule } from '../../queue/api-queue.module.js';
import { ExternalWebhookModule } from './external-webhook.module.js';
import { ConnectorCredentialsRepository } from '@akane/domain';
import { NOTIFICATION_SEND_QUEUE } from '@akane/platform';

import { startThreeContainers, type ThreeContainers } from '../../../../../tooling/containers.js';

import * as nodeCrypto from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const TEST_SECRET = 'super-secret-value-xyz';
const CONN = 'conn-1';

function sign(secret: string, body: string): string {
  return 'sha256=' + nodeCrypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('external webhook replay protection (NOT-02, NOT-01)', () => {
  let containers: ThreeContainers;
  let app: INestApplication;
  let baseUrl: string;
  let notificationQueue: Queue;

  const logCalls: unknown[][] = [];

  beforeAll(async () => {
    containers = await startThreeContainers();

    const keyDir = mkdtempSync(join(tmpdir(), 'akane-hmac-'));
    const keyFile = join(keyDir, 'dev-local-key');
    writeFileSync(keyFile, randomBytes(32));
    process.env.NODE_ENV = 'test';
    process.env.SERVICE_NAME = 'api';
    process.env.MONGO_URL = 'mongodb://127.0.0.1:27017/akane-test';
    process.env.REDIS_CACHE_URL = containers.urls.cache;
    process.env.REDIS_QUEUE_URL = containers.urls.queue;
    process.env.CRYPTO_LOCAL_KEY_FILE = keyFile;

    vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
      logCalls.push(args);
    });
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logCalls.push(args);
    });
    vi.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
      logCalls.push(args);
    });

    const stubCreds = {
      get: async (ref: string) =>
        ref === `webhook:${CONN}:hmac-sha256`
          ? { credentialRef: ref, headerName: 'x-signature', decryptedValue: TEST_SECRET }
          : null,
      upsert: async () => undefined,
    };

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, MongoModule, CryptoModule, ApiQueueModule, ExternalWebhookModule],
      providers: [redisCacheProvider, redisQueueProvider],
    })
      .overrideProvider(ConnectorCredentialsRepository)
      .useValue(stubCreds)
      .compile();

    notificationQueue = moduleRef.get<Queue>(getQueueToken(NOTIFICATION_SEND_QUEUE));

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.listen(0);
    const server = app.getHttpServer();
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await containers?.stop();
  });

  async function post(headers: Record<string, string>, body: string) {
    const res = await fetch(`${baseUrl}/webhooks/external/${CONN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw
    }
    return { status: res.status, body: parsed };
  }

  function jobsCount() {
    return notificationQueue
      .getJobs(['waiting', 'active', 'completed', 'delayed'])
      .then((j) => j.length);
  }

  it('rejects a stale timestamp with 401 and logs skew', async () => {
    const body = JSON.stringify({ status: 'done' });
    const stale = new Date(Date.now() - 400_000).toISOString();
    const nonce = `n-${Date.now()}-stale`;
    const sig = sign(TEST_SECRET, body);
    const before = await jobsCount();
    const r = await post(
      { 'x-signature': sig, 'x-timestamp': stale, 'x-nonce': nonce },
      body,
    );
    expect(r.status).toBe(401);
    const after = await jobsCount();
    expect(after).toBe(before);
    const skewLogged = logCalls.some((c) =>
      c.some((a) => typeof a === 'object' && a !== null && (a as { reason?: string }).reason === 'timestamp_skew'),
    );
    expect(skewLogged).toBe(true);
  });

  it('rejects a reused nonce with 401 and logs replay', async () => {
    const body = JSON.stringify({ status: 'done' });
    const ts = new Date().toISOString();
    const nonce = `n-${Date.now()}-replay`;
    const sig = sign(TEST_SECRET, body);
    const first = await post(
      { 'x-signature': sig, 'x-timestamp': ts, 'x-nonce': nonce },
      body,
    );
    expect(first.status).toBe(200);
    const second = await post(
      { 'x-signature': sig, 'x-timestamp': ts, 'x-nonce': nonce },
      body,
    );
    expect(second.status).toBe(401);
    const replayLogged = logCalls.some((c) =>
      c.some((a) => typeof a === 'object' && a !== null && (a as { reason?: string }).reason === 'nonce_replay'),
    );
    expect(replayLogged).toBe(true);
  });

  it('rejects missing nonce or timestamp with 401', async () => {
    const body = JSON.stringify({ status: 'done' });
    const sig = sign(TEST_SECRET, body);
    const r1 = await post({ 'x-signature': sig, 'x-timestamp': new Date().toISOString() }, body);
    expect(r1.status).toBe(401);
    const r2 = await post({ 'x-signature': sig, 'x-nonce': `n-${Date.now()}-m` }, body);
    expect(r2.status).toBe(401);
  });

  it('accepts a valid webhook and enqueues one minimal job', async () => {
    const body = JSON.stringify({ status: 'done' });
    const ts = new Date().toISOString();
    const nonce = `n-${Date.now()}-happy`;
    const sig = sign(TEST_SECRET, body);
    const before = await jobsCount();
    const r = await post(
      { 'x-signature': sig, 'x-timestamp': ts, 'x-nonce': nonce },
      body,
    );
    expect(r.status).toBe(200);
    const after = await jobsCount();
    expect(after).toBe(before + 1);
    const jobs = await notificationQueue.getJobs(['waiting', 'active', 'completed', 'delayed']);
    const latest = jobs[jobs.length - 1];
    expect(latest.data).toMatchObject({ connectorId: CONN });
    expect(latest.data).toHaveProperty('body');
    expect(latest.data).not.toHaveProperty('signature');
    expect(latest.data).not.toHaveProperty('timestamp');
    expect(latest.data).not.toHaveProperty('nonce');
  });

  it('rejects a body mutated after signing with 401', async () => {
    const body = JSON.stringify({ status: 'done' });
    const mutated = JSON.stringify({ status: 'tampered' });
    const ts = new Date().toISOString();
    const nonce = `n-${Date.now()}-mut`;
    const sig = sign(TEST_SECRET, body);
    const r = await post(
      { 'x-signature': sig, 'x-timestamp': ts, 'x-nonce': nonce },
      mutated,
    );
    expect(r.status).toBe(401);
  });

  it('never logs the test secret', () => {
    const serialized = JSON.stringify(logCalls);
    expect(serialized).not.toContain(TEST_SECRET);
  });
});