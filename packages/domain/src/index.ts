/**
 * `@akane/domain` — the domain modules (D-01, D-02).
 *
 * The `src/` subdirectories are the boundary element types. Each is owned by a
 * later plan; a new subdirectory is an explicit `eslint-plugin-boundaries`
 * config change, never a silent inheritance (D-02).
 */
export { IdentityService } from './identity/identity.service.js';
export { IdentityMappingRepository } from './identity/identity-mapping.repository.js';
export type { IdentityMapping } from './identity/identity-mapping.repository.js';
export {
  OIDC_PLATFORM,
  OidcProvisionService,
  type OidcProvisionOutcome,
} from './identity/oidc-provision.service.js';
export { ProfileRepository } from './identity/profile.repository.js';
export type { Profile } from './identity/profile.repository.js';
export { LinkIssuerService } from './links/link-issuer.service.js';
export type { IssueLinkInput } from './links/link-issuer.service.js';
export { ReadDenyService } from './links/read-deny.service.js';
export type {
  ReadDenyAction,
  ReadDenyContext,
  ReadDenyRecorder,
} from './links/read-deny.service.js';
export {
  SignatureFailureLimiter,
  SIGNATURE_FAILURE_MAX,
  SIGNATURE_FAILURE_WINDOW_MS,
  SIGNATURE_FAILURE_PREFIX,
  type SignatureFailureDecision,
} from './links/signature-failure-limiter.js';
export { ReadVerifierService } from './links/read-verifier.service.js';
export type {
  ReadVerifyResult,
  ReadVerifySuccess,
  ReadVerifyFailure,
  ReadLinkJwtVerifier,
  SavedQueryLookup,
  SavedQueryRecord,
  SubmissionLookup,
  SubmissionRecord,
  SubmissionRevisionLookup,
  SubmissionRevisionRecord,
  LinkTokenStoreSeam,
  EditOutcome,
} from './links/read-verifier.service.js';
export { LinkTokenStore } from './links/link-token.store.js';
export type {
  CreateOutcome,
  TokenOutcome,
  RedisStructuralSeam,
} from './links/link-token.store.js';
export { SeedSavedQueryLookup } from './links/seed-saved-query.lookup.js';
export { PermissionCheckService } from './authz/permission-check.service.js';
export { RbacService } from './authz/rbac.service.js';
export { RbacCacheService } from './authz/rbac-cache.service.js';
export { DslService } from './dsl/dsl.service.js';
export type { DslCompileResult } from './dsl/dsl.service.js';
export type { CompiledQuery, MongoFilter, QueryCtx } from './dsl/ast.js';
export { SubmissionRepository } from './submissions/submission.repository.js';
export type {
  QueryPage,
  QueryRow,
  QueryWithDslResult,
  Submission,
} from './submissions/submission.repository.js';
export { SubmissionRevisionsRepository } from './submissions/data-access/submission-revisions.repository.js';
export type {
  OutboundState,
  SubmissionRevisionDocument,
} from './submissions/data-access/submission-revisions.repository.js';
export { PublishedAppLoader } from './decision/published-app-loader.js';
export type {
  AuthorizedApp,
  AuthorizeApp,
  PublishedApp,
} from './decision/published-app-loader.js';
export { RuleBasedProvider } from './decision/rule-based.provider.js';
export { RoutingOrchestrator } from './decision/routing-orchestrator.js';
export type { RoutingInput, RoutingOutcome } from './decision/routing-orchestrator.js';
export { ProviderRegistry } from './decision/provider-registry.js';
export type {
  ProviderAttestation,
  ProviderChainConfig,
  ProviderChainEntry,
} from './decision/provider-registry.js';
export { ProviderHealthService } from './decision/provider-health.service.js';
export type { ProviderHealthRecord } from './decision/provider-health.service.js';
export {
  canonicalSameThreadText,
  DecisionCacheService,
} from './decision/decision-cache.service.js';
export type { DecisionCacheKeyInput } from './decision/decision-cache.service.js';
export { ClarificationSessionService } from './decision/clarification-session.service.js';
export type {
  ClarificationSession,
  ClarificationReply,
  ClarificationResponse,
} from './decision/clarification-session.service.js';
export { redact, isUncertain, type RedactionResult } from './decision/redaction.js';
export { DataRouterService } from './datarouter/data-router.service.js';
export type { RouteSubmissionInput, RouteSubmissionResult, RouteSubmissionStatus, RoutingMode, RouteEditInput } from './datarouter/data-router.service.js';
export { OutboxRepository } from './datarouter/data-access/outbox.repository.js';
export { ConnectorRegistry } from './connectors/connector.registry.js';
export {
  ConnectorRateLimiter,
  ConnectorRateLimitedError,
  DEFAULT_CONNECTOR_LIMIT,
  CONNECTOR_RATE_LIMIT_PREFIX,
  parseConnectorLimit,
  type ConnectorLimitConfig,
  type ConnectorLimitDecision,
} from './connectors/connector-rate-limiter.js';
// Admin/CLI surface. `@akane/cli` is a workspace package, so it reaches these
// through this barrel rather than a `../domain/src/**` relative path — the same
// rule every other package follows (a relative path resolves only under the
// test runner; it has no `.js` on disk after a build).
export { AuditRepository, type AuditEntry } from './audit/audit.repository.js';
export { AppRepository, type AppDocument } from './registry/app.repository.js';
export {
  ConnectorCredentialsRepository,
  type ConnectorCredential,
} from './connectors/data-access/connector-credentials.repository.js';
export { RedmineAdapter } from './connectors/redmine.adapter.js';
export { RestCore } from './connectors/rest-core.js';
