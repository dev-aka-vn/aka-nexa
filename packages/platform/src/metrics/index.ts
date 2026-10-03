/**
 * The metrics barrel (OBS-01).
 *
 * `business-metrics.ts` (plan 08) and `metrics.module.ts` + `metrics.controller.ts`
 * (this plan) are one capability from the outside: the meter, and the one
 * endpoint that serves it. Mirrors `../queue/index.ts` and the other platform
 * barrels, so no plan has to reach into a folder path to import them.
 *
 * `packages/platform/package.json`'s `exports` map is deliberately **not**
 * extended here — it declares only `"."` and `"./crypto"`, and plan 10 is the
 * first plan that must resolve a cross-package barrel specifier. Adding one
 * entry per plan is how that map drifts; adding all of them once, in the plan
 * that actually needs it, is not.
 */
export {
  METER_NAME,
  PLATFORM_HEARTBEAT_METRIC,
  QUEUE_JOB_FAILURES_METRIC,
  QUEUE_OLDEST_ITEM_AGE_METRIC,
  registerBusinessMetrics,
  type BusinessMetrics,
} from './business-metrics.js';
export { MetricsController } from './metrics.controller.js';
export {
  MetricsModule,
  prometheusExporterProvider,
  requirePrometheusExporter,
} from './metrics.module.js';