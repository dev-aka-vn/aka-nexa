/**
 * `@akane/contract` — cross-boundary contracts (D-01, D-02).
 *
 * The one package every element may import without a domain dependency: the
 * boundary graph allows `adapters → contract` and nothing else from it, so
 * what lives here is exactly what crosses a process or component boundary.
 *
 * | Barrel | Contract | Frozen by |
 * |--------|----------|------------|
 * | `jev/` | the JEV v1 wire contract + the `JevProvider` seam | D-23, D-24 (RTE-10) |
 * | `links/` | the read-link claim set, the token-class table, the rate-limit key | D-21, D-22 (LNK-07, AUD-10) |
 * | `connector/` | the connector seam and DAT-13's idempotency declaration | DAT-13 |
 * | `events/` | the inbound/outbound IM envelopes | D-01, D-02 |
 *
 * ## "Frozen" means two different things here, and both are mechanical
 *
 * - the **JEV wire contract** and the **read-link claim set** are version-frozen:
 *   `.strict()` plus a test asserting the exact sorted top-level key set against
 *   a literal version-named array. `.strict()` catches an *added* key; only the
 *   test catches a *removed* one.
 * - `connector/` and `events/` are ordinary versioned contracts. They are
 *   `.strict()` so an unlisted field is rejected, but no key-set test freezes
 *   them: a connector gaining a descriptor field does not invalidate anything
 *   already deployed, which is the property that makes the two frozen schemas
 *   different in kind and not just in degree.
 *
 * Everything exported here is a **type, a schema or a frozen constant**. No I/O,
 * no clock, no randomness — the package is imported by the boundary guard's
 * fixture tests and must stay side-effect free to be safe there.
 */
export {
  JEV_SPEC_VERSION,
  JevAlternativeSchema,
  JevChoiceSchema,
  JevContextSchema,
  JevRequestSchema,
  JevResponseSchema,
  JevStateSchema,
  JEV_ABSTENTION_REQUIRES_CLARIFICATION,
  JEV_ABSTENTION_REQUIRES_NULL_CHOICE,
  JEV_V1_DOCUMENTS,
  refineAbstentionIsTotal,
  toJsonSchema,
  ToolDescriptorSchema,
  TurnSchema,
} from './jev/v1/index.js';
export type {
  JevAlternative,
  JevChoice,
  JevContext,
  JevRequest,
  JevResponse,
  JevState,
  JevV1Document,
  ToolDescriptor,
  Turn,
} from './jev/v1/index.js';

export {
  RULE_BASED_PROVIDER_NAME,
  SUPPORTED_JEV_SPEC_VERSION,
} from './jev/jev-provider.js';
export type {
  HealthStatus,
  JevCapability,
  JevProvider,
} from './jev/jev-provider.js';

export {
  MAX_READ_LINK_TTL_SECONDS,
  READ_LINK_CLAIMS_VERSION,
  READ_LINK_TARGET_RULES,
  READ_LINK_TTL_EXCEEDS_CEILING,
  ReadLinkActionSchema,
  ReadLinkClaimsSchema,
} from './links/read-link-claims.js';
export type { ReadLinkAction, ReadLinkClaims } from './links/read-link-claims.js';

export {
  DRAFT_TOKEN_KEY_PREFIX,
} from './links/token-classes.js';

export {
  TOKEN_CLASSES,
  isEmittableInV1,
  type TokenClass,
} from './links/token-classes.js';


export {
  AppIdSchema,
  CreateAppDraftSchema,
  SectionNameSchema,
  UpdateSectionSchema,
  DeprecateAppSchema,
  ForkTemplateSchema,
} from './builder/app-definition.contract.js';
export type {
  CreateAppDraftInput,
  SectionName,
  UpdateSectionInput,
  DeprecateAppInput,
  ForkTemplateInput,
} from './builder/app-definition.contract.js';

export {
  AppFormKindSchema,
  FORM_KIND_TO_ACTION,
  formKindForAction,
  FormTriggerSchema,
  AppFormConfigSchema,
  AppFormElementSchema,
} from './builder/forms.contract.js';
export type {
  AppFormKind,
  FormTrigger,
  AppFormConfig,
  AppFormElement,
} from './builder/forms.contract.js';

export {
  PublishGateResultSchema,
  PublishResponseSchema,
  ChangeSummaryRowSchema,
  ShareDropSchema,
} from './builder/publish.contract.js';
export type {
  PublishGateResult,
  PublishResponse,
  ChangeSummaryRow,
  ShareDrop,
} from './builder/publish.contract.js';
export {
  ConnectorRequestDefinitionSchema,
  ConnectorRequestResponseSchema,
  ConnectorRequestStateSchema,
} from './builder/connector-request.contract.js';
export type {
  ConnectorRequestDefinition,
  ConnectorRequestResponse,
  ConnectorRequestState,
} from './builder/connector-request.contract.js';
export {
  FieldMappingSchema,
  type FieldMapping,
} from './builder/field-mapping.contract.js';

// OTP self-onboarding contracts (IDN-05) — the
// chat ↔ worker payloads for the unmapped-
// employee flow, beside the frozen contracts.
export {
  OTP_ONBOARDING_INTENT,
  OtpCodeSchema,
  OtpOnboardingOutcomeSchema,
} from './identity/otp.contract.js';
export type { OtpCode, OtpOnboardingOutcome } from './identity/otp.contract.js';

// Submissions-viewer contracts (BLD-08, D-111) —
// the owner-scoped viewer's filters and the
// projected row (the export's field allowlist),
// beside the frozen contracts.
export {
  SubmissionStatusSchema,
  type SubmissionStatus,
  SubmissionViewerRowSchema,
  type SubmissionViewerRow,
  SubmissionsFilterSchema,
  type SubmissionsFilter,
} from './submissions/submissions.contract.js';

// Ownership-transfer contracts (ACL-05,
// ACL-10, T-06-31) — the owner's request,
// the served projection, and the global
// admin's approval queue, beside the frozen
// contracts.
export {
  TransferRequestCreateSchema,
  type TransferRequestCreate,
  TransferStateSchema,
  type TransferState,
  TransferRequestResponseSchema,
  type TransferRequestResponse,
  TransferApprovalQueueSchema,
  type TransferApprovalQueue,
} from './acl/transfer.contract.js';
