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
export {
  OtpOnboardingService,
  type OtpRequestResult,
  type OtpVerifyResult,
} from './identity/otp/otp-onboarding.service.js';
export type { OtpDeliveryPort } from './identity/otp/otp-delivery.port.js';
export {
  OTP_LOCKOUT_MS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  OtpStateMachine,
  type OtpRecord,
  type OtpRequestDecision,
  type OtpTransition,
  type OtpVerifyDecision,
} from './identity/otp/otp-state-machine.js';
export { ProfileRepository } from './identity/profile.repository.js';
export type { Profile } from './identity/profile.repository.js';
export { SsoMappingService } from './identity/sso-mapping.service.js';
export type {
  SsoMappingInput,
  SsoMappingRecord,
  SsoMappingResult,
} from './identity/sso-mapping.service.js';
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
// The self-service builder's per-app ability factory
// (ACL-01/02/03/04/07/08/10, BLD-03, BLD-11) — the
// @casl/ability rule set the builder's surfaces and the
// API's enforcement both derive from.
export {
  APP_SECTION_PERMISSIONS,
  APP_SUBJECT,
  DEFAULT_BUILDER_ROLES,
  OWNERSHIP_SUBJECT,
  appOwners,
  canAssignOwner,
  canUnassignOwner,
  createBuilderAbility,
  isDefaultRole,
  viewerRoles,
  type AppRoleAssignment,
  type AppSectionPermission,
  type BuilderAbility,
  type DefaultBuilderRole,
} from './authz/builder-ability.js';
export { DslService } from './dsl/dsl.service.js';
export type { DslCompileResult } from './dsl/dsl.service.js';
export type { CompiledQuery, MongoFilter, QueryCtx } from './dsl/ast.js';
export { SubmissionRepository } from './submissions/submission.repository.js';
export type {
  QueryPage,
  QueryRow,
  QueryWithDslResult,
  Submission,
  SubmissionListFilter,
} from './submissions/submission.repository.js';
export { SubmissionRevisionsRepository } from './submissions/data-access/submission-revisions.repository.js';
export type {
  OutboundState,
  SubmissionRevisionDocument,
} from './submissions/data-access/submission-revisions.repository.js';
export { PublishedAppLoader, appIdOfToolId } from './decision/published-app-loader.js';
export type {
  AuthorizedApp,
  AuthorizeApp,
  PublishedApp,
  PublishedAppForm,
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
// Inbound adapters are intentionally NOT re-exported from this barrel: the
// entrypoint-drift gate forbids the worker from reaching any
// adapters/<name>/inbound/ path. api imports them via the @akane/domain
// subpath (see apps/api/src/adapters/teams/*).
export {
  ConversationReferenceRepository,
  type ConversationReferenceRecord,
  type ConversationReferenceInput,
} from './notifications/data-access/conversation-reference.repository.js';
export { NotificationAssemblerService } from './notifications/notification-assembler.service.js';
export type { NotificationAssembleResult } from './notifications/notification-assembler.service.js';
export { NotificationsModule } from './notifications/notifications.module.js';
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
  AppDefinitionRepository,
  AppIdInUseError,
  AppNotFoundError,
  VersionConflictError,
  applySectionPatch,
  type AppDefinitionDocument,
  type AppDataMode,
  type VersionSnapshotDocument,
} from './builder/data-access/app-definition.repository.js';
export {
  AppLifecycle,
  BuilderError,
  LifecycleTransitionError,
  SubmissionRefusedError,
  TriggerRegisterRefusedError,
  APP_LIFECYCLE_STATES,
  type AppLifecycleState,
} from './builder/app-lifecycle.js';
export {
  AppDefinitionValidationError,
  AppDefinitionService,
  RETAINED_VERSIONS,
} from './builder/app-definition.service.js';
export {
  assertCuratedTags,
  isPlatformTag,
  PLATFORM_DEPARTMENT_TAGS,
  PLATFORM_TAGS,
  PLATFORM_USE_CASE_TAGS,
  PlatformTagSchema,
  PlatformTagsSchema,
  type PlatformTag,
} from './builder/template/tag-set.js';
export {
  TemplateSeed,
  TEMPLATE_SEEDS,
  templateContentHash,
  type TemplateRecord,
  type TemplateSeedInput,
} from './builder/template/template.seed.js';
export { RepositorySavedQueryLookup } from './builder/saved-query.repository.js';
export { backfillSavedQueries } from './builder/saved-query.backfill.js';
export {
  migrateAppForms,
  transformLegacyApp,
  foldLegacyTriggers,
} from './builder/migration/forms-migration.js';
export {
  PUBLISH_SHARE_DROP_THRESHOLD_POINTS,
  DESCRIPTION_COLLISION_JACCARD_THRESHOLD,
  PublishGateService,
  type PublishGateResult,
  buildChangeSummary,
  declaredLabels,
  descriptionsCollide,
  publishedAppFromDefinition,
} from './builder/publish-gate.service.js';
export {
  RoutingOutcomeRepository,
  UNLABELLED_INTENT_LABEL,
  type RoutingOutcomeInput,
  type RoutingOutcomeRecord,
  type RoutingOutcomeStore,
} from './builder/routing-share/routing-outcome.repository.js';
export {
  RoutingShareComputer,
  ROUTING_SHARE_WINDOW_MS,
} from './builder/routing-share/routing-share.computer.js';
export {
  registerRoutingShareMetrics,
  ROUTING_SHARE_METRIC,
} from './builder/routing-share/routing-share.metrics.js';
// Field mapping (BLD-05) — the data-routing
// tab's mapping store on the app definition,
// beside the definition surfaces that own the
// section it writes.
export {
  FieldMappingService,
  FieldMappingValidationError,
  type FieldMappingRecord,
} from './builder/data-routing/field-mapping.service.js';
export {
  ConnectorCredentialsRepository,
  type ConnectorCredential,
} from './connectors/data-access/connector-credentials.repository.js';
export { RedmineAdapter } from './connectors/redmine.adapter.js';
export { RestCore } from './connectors/rest-core.js';
// Connector requests (BLD-10, D-97..D-100) —
// the self-service request queue beside the
// definition surfaces that own it.
export {
  ConnectorRequestNotFoundError,
  ConnectorRequestPendingExistsError,
  ConnectorRequestTransitionError,
} from './builder/connector-request/connector-request.errors.js';
export type {
  ConnectorRequestDocument,
  ConnectorRequestState,
} from './builder/connector-request/connector-request.document.js';
export {
  ConnectorRequestRepository,
  type ConnectorRequestTransitionOptions,
} from './builder/connector-request/connector-request.repository.js';
export {
  ConnectorRequestService,
  ConnectorRequestValidationError,
} from './builder/connector-request/connector-request.service.js';

// Ownership transfers (ACL-05, ACL-10,
// T-06-31) — the self-service transfer
// surface beside the definition surfaces
// that own the app's owner.
export {
  GlobalAdminRequiredError,
  TransferNotFoundError,
  TransferPendingExistsError,
  TransferTransitionError,
  TransferValidationError,
} from './acl/transfer-request.errors.js';
export type {
  TransferRequestDocument,
  TransferState,
} from './acl/transfer-request.document.js';
export { TransferRequestRepository } from './acl/transfer-request.repository.js';
export {
  TransferRequestService,
  type TransferActor,
} from './acl/transfer-request.service.js';
export {
  buildFormsFixture,
  buildLegacyShapeDocument,
  type LegacyShapeDocument,
} from './builder/forms-fixture.js';
