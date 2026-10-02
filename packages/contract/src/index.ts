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
  isEmittableInV1,
  TOKEN_CLASSES,
} from './links/token-classes.js';
export type { TokenClass } from './links/token-classes.js';

export { RateLimitKeySchema, RateLimitScopeSchema } from './links/rate-limit-key.js';
export type { RateLimitKey, RateLimitScope } from './links/rate-limit-key.js';

export { ConnectorDescriptorSchema } from './connector/connector.js';
export type {
  Connector,
  ConnectorDescriptor,
  ConnectorExecuteInput,
  ConnectorExecuteOutcome,
} from './connector/connector.js';

export { ImPlatformSchema, InboundActionSchema, InboundEventSchema } from './events/inbound-event.js';
export type { ImPlatform, InboundAction, InboundEvent } from './events/inbound-event.js';

export { OutboundActionSchema, OutboundMessageSchema } from './events/outbound-message.js';
export type { OutboundAction, OutboundMessage } from './events/outbound-message.js';
