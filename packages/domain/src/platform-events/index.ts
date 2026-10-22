/**
 * The neutral platform-event ledger (OUT-09, OUT-10, OUT-11).
 *
 * Deliberately its own domain element type (`tooling/boundaries.config.mjs`):
 * the api receiver writes to it, the worker reconciler and the scheduler sweep
 * read from it, and neither may reach an inbound adapter directory (R1).
 * Re-export everything from the root barrel; this subpath exists so a consumer
 * that only needs the ledger does not pull the whole domain graph into its
 * module.
 */
export {
  PLATFORM_EVENT_COLLECTION,
  PLATFORM_EVENT_RETENTION_DAYS,
  PLATFORM_EVENT_REPOSITORY_CONNECT_TIMEOUT_MS,
  PLATFORM_EVENT_REPOSITORY_SERVER_SELECTION_TIMEOUT_MS,
  PLATFORM_EVENT_REPOSITORY_SOCKET_TIMEOUT_MS,
  PLATFORM_EVENT_STATES,
  PlatformEventRepository,
} from './platform-event.repository.js';

export type {
  PlatformEventDocument,
  PlatformEventInput,
  PlatformEventInsertResult,
  PlatformEventRepositoryOptions,
  PlatformEventState,
} from './platform-event.repository.js';
