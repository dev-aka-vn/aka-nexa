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
export { LinkIssuerService } from './links/link-issuer.service.js';
export type { IssueLinkInput } from './links/link-issuer.service.js';
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
