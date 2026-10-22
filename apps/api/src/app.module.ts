import { Module, type OnApplicationShutdown } from '@nestjs/common';
import './common/filters/link-error.filter.js';
import './common/guards/permission.guard.js';
import { TerminusModule } from '@nestjs/terminus';

import {
  BOUNDARY_MANIFEST,
  ConfigModule,
  CryptoModule,
  HealthController,
  INBOUND_ADAPTER_REGISTRATIONS,
  MetricsModule,
  MongoModule,
  ProviderBoundaryGuardRunner,
  redisCacheProvider,
  redisQueueProvider,
  redisShutdownProvider,
  shutdownOtel,
} from '@akane/platform';

import { ReadModule } from './read/read.module.js';
import { ThrottlerAppModule } from './common/throttler/throttler.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { AppBuilderModule } from './app-builder/app-builder.module.js';
import { SubmissionsModule } from './submissions/submissions.module.js';
import { AuditModule } from './audit/audit.module.js';
import { TeamsModule } from './adapters/teams/teams.module.js';
import { SlackModule } from './adapters/slack/slack.module.js';
import { ExternalWebhookModule } from './webhooks/external/external-webhook.module.js';
import { API_BOUNDARY_MANIFEST } from './bootstrap/boundary-manifest.js';
import {
  API_INBOUND_ADAPTERS,
  ApiAdapterCoverageRunner,
} from './bootstrap/adapter-coverage.runner.js';

/**
 * The `api` composition root (FND-03, FND-05, FND-08, OBS-01).
 *
 * ## What this module deliberately does **not** have
 *
 * No BullMQ `Worker`, no `QueueModule`, and no Job Scheduler registration. `api`
 * is the request path, and the <200 ms webhook-ack budget (D-13) is why: a
 * consumer polling a queue inside this process parks a blocking Redis command in
 * the very event loop that has to answer the ack. R1 enforces the `Worker` import
 * statically (`no-restricted-imports` on `apps/api/src/**`), and
 * `API_BOUNDARY_MANIFEST` refuses `QUEUE_PRODUCER_TOKEN` at boot — which is the
 * half lint cannot see, because `imports: [QueueModule]` is a *legal* import that
 * is only wrong for this process.
 *
 * ## What the process's request-path modules are
 *
 * `ReadModule` (the read path), `AuthModule` (the builder's OIDC session
 * surface, BLD-12), `UsersModule` (the Users page's SSO mapping surface,
 * IDN-08/D-110), `AppBuilderModule` (the self-service definition surfaces,
 * BLD-02), `SubmissionsModule` (the submissions viewer and its visible-column
 * export, BLD-08/D-111), and `AuditModule` (the read-only AUD-01 browse
 * surface, T-06-32). A difference that is not a readiness check is the drift
 * FND-03 exists to prevent, so it shows up as a diff here rather than as a
 * production surprise.
 *
 * ## Why `CryptoModule` is here with no consumer of it
 *
 * Nothing in this process injects `CRYPTO_KEY_PROVIDER` yet — Phase 1 stores no
 * secret (FND-10 stays pending, B-3). It is composed anyway because the module
 * is where the FND-10 production guard *runs*: `assertKeyProviderAllowed` is
 * called by its provider factory, so a module that is imported but never
 * consumed is exactly what makes the guard reachable from a real boot. Leaving
 * it out is what left `CRYPTO_KEY_PROVIDER_REQUIRED:` provable only through
 * `Test.createTestingModule({ imports: [CryptoModule] })` — a guard that no
 * process could reach, reachable only from a test.
 *
 * The cost is that boot now declares a crypto posture, so a process configured
 * with the local provider must also name its key file (`CRYPTO_LOCAL_KEY_FILE`,
 * a path — never the key). `NODE_ENV=production` still refuses first, before
 * any key file is read. If a future process genuinely holds no secret and wants
 * no key at all, that is the day to make the provider lazy — not the day to
 * quietly drop the guard from the composition root.
 */
@Module({
  imports: [
    ConfigModule,
    CryptoModule,
    MongoModule,
    TerminusModule.forRoot(),
    MetricsModule,
    ReadModule,
    AuthModule,
    UsersModule,
    AppBuilderModule,
    SubmissionsModule,
    AuditModule,
    TeamsModule,
    SlackModule,
    ExternalWebhookModule,
    ThrottlerAppModule.forRoot(),
  ],
  controllers: [HealthController],
  providers: [
    redisCacheProvider,
    redisQueueProvider,
    redisShutdownProvider,
    { provide: BOUNDARY_MANIFEST, useValue: API_BOUNDARY_MANIFEST },
    ProviderBoundaryGuardRunner,
    // OUT-03's api half. The token is api's own capability record (the worker
    // and scheduler manifests forbid it), and the runner asserts this build's
    // inbound registrations match the shared IM_ADAPTER_WIRING declaration —
    // so a platform that is wired on the worker side but has no receiver here
    // fails boot instead of dropping every message from it.
    { provide: INBOUND_ADAPTER_REGISTRATIONS, useValue: API_INBOUND_ADAPTERS },
    ApiAdapterCoverageRunner,
  ],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // T-1-24: buffered spans die with the process otherwise, and a rolling
    // deploy is exactly when telemetry is most likely to be short.
    await shutdownOtel();
  }
}
