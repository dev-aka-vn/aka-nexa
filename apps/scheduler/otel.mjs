/**
 * OTel loader entry for `scheduler` (D-20, OBS-01).
 *
 * ## Why this file exists and why it is not the entrypoint
 *
 * OpenTelemetry's Node instrumentations patch their targets at load time, so the
 * SDK has to be running before the module it instruments is loaded. Running
 * `node --import ./otel.mjs ./dist/main.js` puts this file first in the process,
 * ahead of every application module — which is the only ordering Node offers
 * without a custom loader.
 *
 * `src/main.ts` also calls `startOtel()` before its own dynamic import of
 * `app.module.js`, so a forgotten `--import` flag degrades to "the process still
 * traces HTTP" instead of "the process silently traces nothing". The two calls
 * are idempotent and hand back the same handle, so running both costs nothing.
 *
 * ## Why the deep specifier
 *
 * `@akane/platform/otel`, not `@akane/platform`. The root barrel transitively
 * loads `ioredis`, `mongodb`, `bullmq` and `@nestjs/terminus`; importing *that*
 * here would load four instrumented modules before `startOtel()` runs and
 * silently cost every database and queue span in the process. `otel/index.ts`
 * reaches none of them, which is the entire reason the package's `exports` map
 * has a `./otel` entry.
 *
 * The three copies of this file are byte-identical by design: `main.ts` is the
 * same across the three processes, and a loader entry that drifted from its
 * sibling would be invisible until one process lost half its spans.
 */
import { otelBootstrapConfigFromEnv, startOtel } from '@akane/platform/otel';

await startOtel(otelBootstrapConfigFromEnv());