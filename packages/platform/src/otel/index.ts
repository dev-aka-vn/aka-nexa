/**
 * The observability barrel (FND-07, OBS-01).
 *
 * Exported so each app's `main.ts` needs one import for the whole OTel surface, and
 * so nothing has to reach into a deep path to construct a second exporter.
 */
export { AllowlistSpanExporter } from './allowlist-span-exporter.js';
export {
  FORBIDDEN_SPAN_ATTRIBUTES,
  SPAN_ATTRIBUTE_ALLOWLIST,
  SPAN_ATTRIBUTE_ALLOWLIST_SET,
  filterSpanAttributes,
  type AllowlistedSpanAttribute,
} from './span-attribute-allowlist.js';
export {
  OTEL_PROMETHEUS_EXPORTER,
  PROMETHEUS_SCRAPE_ENDPOINT,
  createPrometheusExporter,
  getPrometheusExporter,
  setPrometheusExporter,
} from './otel.constants.js';
export {
  buildOtelSdk,
  otlpSignalUrl,
  startOtel,
  type OtelBootstrapConfig,
  type OtelHandle,
} from './otel.bootstrap.js';