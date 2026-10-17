import { runConnectorLoader, upsertConnector, type ConnectorSeed } from './connector.js';
import {
  assertKeyProviderAllowed,
  type KeyProviderGuardConfig,
} from '@akane/platform';

import type {
  AuditRepository,
  ConnectorCredentialsRepository,
  ConnectorRegistry,
  ConnectorRequestDocument,
  ConnectorRequestRepository,
} from '@akane/domain';

export async function provision(
  args: string[] = process.argv.slice(2),
  registry?: ConnectorRegistry,
  credsRepo?: ConnectorCredentialsRepository,
): Promise<void> {
  await runConnectorLoader(args, registry, credsRepo);
}

/**
 * What the operator supplies for one pending
 * request: the credential value, the header it
 * travels in, and the opaque handle it is stored
 * under. The **value** exists only here — it is
 * written through the repository's AES-256-GCM
 * envelope seam and never returns to any builder
 * surface (D-99, T-06-23).
 */
export interface OperatorCredentialInput {
  readonly credentialRef: string;
  readonly headerName: string;
  readonly plaintext: string;
}

/** The operator's provision step over the pending queue (BLD-10, D-97..D-100). */
export interface ProvisionConnectorRequestsOptions {
  readonly registry: ConnectorRegistry;
  readonly credsRepo: ConnectorCredentialsRepository;
  readonly requests: ConnectorRequestRepository;
  readonly audit: AuditRepository;
  /**
   * The operator's credential entry, per pending
   * request — the prompt seam. In production this
   * reads the operator's terminal input; a test
   * supplies the value directly.
   */
  readonly provideCredential: (
    request: ConnectorRequestDocument,
  ) => Promise<OperatorCredentialInput>;
  /**
   * The D-100 guard config. Defaults to the
   * process environment — the same config the
   * composition root validates at boot.
   */
  readonly guard?: KeyProviderGuardConfig;
}

/**
 * Provision every pending connector request:
 *
 * 1. **The D-100 guard fires first** — a
 *    production boot without a KMS provider
 *    refuses with `CRYPTO_KEY_PROVIDER_REQUIRED`
 *    before any credential I/O (FND-10 stays
 *    authoritative; the builder flow relaxes
 *    nothing).
 * 2. The credential is written through
 *    `ConnectorCredentialsRepository.upsert` —
 *    the AES-256-GCM envelope seam, the only
 *    path a secret enters the system.
 * 3. The connector registers through the
 *    existing `upsertConnector` seed seam —
 *    no new operator tooling.
 * 4. The request resolves to `provisioned`
 *    with the `credential_ref` handle, and
 *    the `connector_request.provisioned`
 *    AUD-01 entry lands with
 *    `previous_state`/`new_state`.
 *
 * @returns the resolved requests, in queue order.
 */
export async function provisionConnectorRequests(
  options: ProvisionConnectorRequestsOptions,
): Promise<ConnectorRequestDocument[]> {
  // D-100: fail closed before any credential I/O.
  assertKeyProviderAllowed(
    options.guard ?? guardConfigFromEnv(),
  );

  const pending = await options.requests.listPending();
  const provisioned: ConnectorRequestDocument[] = [];

  for (const request of pending) {
    const credential = await options.provideCredential(
      request,
    );

    // The only credential write path: the
    // envelope seam. No builder surface ever
    // holds the plaintext (T-06-23).
    await options.credsRepo.upsert(
      credential.credentialRef,
      credential.headerName,
      credential.plaintext,
    );

    // Register the connector through the
    // existing seed seam — the request's
    // definition minus the secret is exactly
    // the seed's shape.
    const seed: ConnectorSeed = {
      connector_ref: request.connector_id,
      connector_id: request.connector_id,
      name: request.name,
      base_url: request.base_url,
      credential_ref: credential.credentialRef,
      timeout_ms: request.timeout_ms,
      retries: request.retries,
      rate_limit: request.rate_limit,
      mapping: request.mapping,
      taxonomy: request.taxonomy,
    };
    await upsertConnector(seed, options.registry, options.credsRepo);

    // Resolve the request with the opaque handle.
    const resolved = await options.requests.transition(
      request.request_id,
      'provisioned',
      { credentialRef: credential.credentialRef },
    );
    if (resolved === null) {
      throw new Error(
        `CONNECTOR_REQUEST_NOT_FOUND: ${request.request_id} vanished during provision`,
      );
    }

    await options.audit.append({
      timestamp: new Date(),
      actor: 'operator',
      action: 'connector_request.provisioned',
      target: request.app_id,
      previous_state: 'pending',
      new_state: 'provisioned',
      connector_id: request.connector_id,
      request_id: request.request_id,
      credential_ref: credential.credentialRef,
    });

    provisioned.push(resolved);
  }

  return provisioned;
}

/**
 * The guard config as the process environment
 * carries it — the same source the composition
 * root validates at boot.
 */
function guardConfigFromEnv(): KeyProviderGuardConfig {
  return {
    NODE_ENV: process.env['NODE_ENV'],
    CRYPTO_KEY_PROVIDER:
      process.env['CRYPTO_KEY_PROVIDER'] ?? 'local',
    CRYPTO_LOCAL_KEY_ALLOWED:
      process.env['CRYPTO_LOCAL_KEY_ALLOWED'],
  };
}
