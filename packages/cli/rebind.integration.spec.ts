import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MONGO_IMAGE, mongoUrl } from '../../tooling/containers.js';
import { MongoService } from '../platform/src/mongo/mongo.service.js';
import { AppRepository } from '../domain/src/registry/app.repository.js';
import { AuditRepository } from '../domain/src/audit/audit.repository.js';
import { rebindConnectorRef, loadAppSeed } from './rebind.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

describe('rebind CLI', () => {
  let mongo: StartedMongoDBContainer;
  let mongoService: MongoService;
  let appRepo: AppRepository;
  let auditRepo: AuditRepository;
  const testDir = join(process.cwd(), 'tmp-test-rebind');
  const seedPath = join(testDir, 'app.json');

  beforeAll(async () => {
    mkdirSync(testDir, { recursive: true });
    mongo = await new MongoDBContainer(MONGO_IMAGE).start();
    mongoService = new MongoService(mongoUrl(mongo), { defaultDb: 'akane-test' });
    appRepo = new AppRepository(mongoService);
    auditRepo = new AuditRepository();
  }, 300_000);

  afterAll(async () => {
    await mongoService?.onModuleDestroy();
    await mongo?.stop();
    rmSync(testDir, { recursive: true, force: true });
  }, 300_000);

  it('audited rebind: one change → one AUD-01 with correct before/after', async () => {
    // Insert app with old connector
    const apps = mongoService.db().collection('apps');
    await apps.deleteMany({});
    await apps.insertOne({ app_id: 'app-1', connector_ref: 'redmine-old' });

    // Create seed with new connector
    writeFileSync(
      seedPath,
      JSON.stringify({
        app_id: 'app-1',
        connector_ref: 'redmine-new',
      }),
    );

    const seed = await loadAppSeed(seedPath);
    const result = await rebindConnectorRef(seed, appRepo, auditRepo);
    expect(result.changed).toBe(true);

    const audits = await auditRepo.findAll();
    expect(audits.length).toBe(1);
    expect(audits[0].previous_state).toBe('redmine-old');
    expect(audits[0].new_state).toBe('redmine-new');
  }, 120_000);

  it('re-run of the same file → no second event', async () => {
    // Seed already has redmine-new from previous test
    const seed = await loadAppSeed(seedPath);
    const result2 = await rebindConnectorRef(seed, appRepo, auditRepo);
    expect(result2.changed).toBe(false);
    const auditsAfter2 = await auditRepo.findAll();
    expect(auditsAfter2.length).toBe(1); // Still just 1 from previous change
  }, 120_000);
});
