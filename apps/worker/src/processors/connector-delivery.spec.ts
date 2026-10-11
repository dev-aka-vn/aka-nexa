import { describe, it, expect, vi } from 'vitest';
import { ConnectorDeliveryProcessor } from './connector-delivery.processor.js';

/**
 * A limiter that admits every call. The CON-05 limiter has its own integration
 * suite (`packages/domain/src/connectors/rate-limit.integration.spec.ts`) over
 * real Redis; these cases are about the pre-call-commit / idempotency ordering,
 * so a permissive stub keeps the rate limit out of their way.
 */
function allowAllLimiter() {
  return {
    consume: vi.fn().mockResolvedValue({ allowed: true, count: 1, max: 60, resetInMs: 60000 }),
  } as any;
}

/**
 * A registry stub. `limiterConfig` is part of the surface the processor now
 * calls (CON-05), so a bare `{ resolve }` mock is no longer sufficient.
 */
function registryStub(resolve?: unknown) {
  return {
    resolve: resolve === undefined ? vi.fn() : vi.fn().mockReturnValue(resolve),
    limiterConfig: vi.fn().mockReturnValue({ max: 60, windowMs: 60000 }),
  } as any;
}

/**
 * A recording stand-in for the OBS-04/CON-06 metrics seam. The counters
 * themselves are asserted in `packages/platform/src/metrics/business-metrics.spec.ts`;
 * these cases assert only that the processor *writes* to the seam at the right
 * points with the right labels.
 */
function recorderStub() {
  return {
    recordSubmissionStatus: vi.fn(),
    recordConnectorOutcome: vi.fn(),
  } as any;
}

describe('connector delivery processor - pre-call commit', () => {
  it('commits sent_unconfirmed before transport call', async () => {
    const callOrder: string[] = [];
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({
        outbound: 'not_sent',
      }),
      setSentUnconfirmed: vi.fn().mockImplementation(async () => {
        callOrder.push('setSentUnconfirmed');
      }),
      setConfirmed: vi.fn().mockImplementation(async () => {
        callOrder.push('setConfirmed');
      }),
    } as any;

    const connector = {
      execute: vi.fn().mockImplementation(async () => {
        callOrder.push('execute');
        return { status: 'succeeded', externalId: 'ext-1' };
      }),
    } as any;

    const registry = registryStub(connector);

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry, allowAllLimiter(), recorderStub());
    await processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any);

    expect(callOrder[0]).toBe('setSentUnconfirmed');
    expect(callOrder[1]).toBe('execute');
    expect(callOrder[2]).toBe('setConfirmed');
  });

  it('not_sent short-circuit', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({
        outbound: 'sent_unconfirmed',
      }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const registry = registryStub();

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry, allowAllLimiter(), recorderStub());
    await processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any);

    expect(revisionsRepo.setSentUnconfirmed).not.toHaveBeenCalled();
    expect(registry.resolve).not.toHaveBeenCalled();
  });

  it('per-revision idempotency - not_sent short-circuit on re-delivery', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({
        outbound: 'sent_unconfirmed',
      }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const connector = {
      execute: vi.fn(),
    } as any;

    const registry = registryStub(connector);

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry, allowAllLimiter(), recorderStub());
    await processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any);

    expect(connector.execute).not.toHaveBeenCalled();
    expect(revisionsRepo.setSentUnconfirmed).not.toHaveBeenCalled();
  });

  it('credential_rejected outcome does not consume retry budget', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({
        outbound: 'not_sent',
      }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const connector = {
      execute: vi.fn().mockResolvedValue({ status: 'rejected' }),
    } as any;

    const registry = registryStub(connector);

    const processor = new ConnectorDeliveryProcessor(revisionsRepo, registry, allowAllLimiter(), recorderStub());
    await expect(processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any)).resolves.toBeUndefined();

    expect(revisionsRepo.setSentUnconfirmed).toHaveBeenCalled();
    expect(connector.execute).toHaveBeenCalledTimes(1);
    expect(revisionsRepo.setConfirmed).not.toHaveBeenCalled();
  });

  /**
   * OBS-04's whole reason for existing: a submission whose internal write
   * committed and whose external leg is still trying must be visible as
   * `partial`. Registering the instrument was never enough — with no `add()`
   * call, no series is exported at all.
   */
  it('writes submission_status{status="partial"} while the external leg is retrying', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({ outbound: 'not_sent' }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const connector = {
      execute: vi.fn().mockResolvedValue({ status: 'failed_transient', externalId: null }),
    } as any;

    const metrics = recorderStub();
    const processor = new ConnectorDeliveryProcessor(
      revisionsRepo,
      registryStub(connector),
      allowAllLimiter(),
      metrics,
    );

    await expect(
      processor.process({
        data: {
          submissionId: 'sub-1',
          revision: 0,
          connectorRef: 'conn-1',
          payload: { appId: 'app-leave', data: {} },
        },
      } as any),
    ).rejects.toThrow();

    const statuses = metrics.recordSubmissionStatus.mock.calls.map((c: any[]) => c[0]);
    expect(statuses).toEqual([
      { appId: 'app-leave', status: 'sent' },
      { appId: 'app-leave', status: 'partial' },
    ]);
    // The attempt is attributed to the app, and a transient failure is not a
    // classified one, so the taxonomy stays `none` rather than inventing a code.
    expect(metrics.recordConnectorOutcome).toHaveBeenCalledWith({
      appId: 'app-leave',
      outcome: 'failed_transient',
      taxonomyCode: 'none',
    });
  });

  it('carries the connector taxonomy code and the app_id on a terminal outcome (CON-06, CON-07)', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({ outbound: 'not_sent' }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const connector = {
      execute: vi
        .fn()
        .mockResolvedValue({ status: 'rejected', externalId: null, code: 'credential_rejected' }),
    } as any;

    const metrics = recorderStub();
    const processor = new ConnectorDeliveryProcessor(
      revisionsRepo,
      registryStub(connector),
      allowAllLimiter(),
      metrics,
    );

    await processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { appId: 'app-hr', data: {} },
      },
    } as any);

    expect(metrics.recordConnectorOutcome).toHaveBeenCalledWith({
      appId: 'app-hr',
      outcome: 'rejected',
      taxonomyCode: 'credential_rejected',
    });
    expect(metrics.recordSubmissionStatus).toHaveBeenLastCalledWith({
      appId: 'app-hr',
      status: 'failed',
    });
  });

  it('records app_id="unknown" rather than dropping the series when no app is resolvable', async () => {
    const revisionsRepo = {
      findBySubmissionAndRevision: vi.fn().mockResolvedValue({ outbound: 'not_sent' }),
      setSentUnconfirmed: vi.fn(),
      setConfirmed: vi.fn(),
    } as any;

    const connector = {
      execute: vi.fn().mockResolvedValue({ status: 'succeeded', externalId: 'ext-9' }),
    } as any;

    const metrics = recorderStub();
    const processor = new ConnectorDeliveryProcessor(
      revisionsRepo,
      registryStub(connector),
      allowAllLimiter(),
      metrics,
    );

    await processor.process({
      data: {
        submissionId: 'sub-1',
        revision: 0,
        connectorRef: 'conn-1',
        payload: { data: {} },
      },
    } as any);

    // Non-vacuity: an unattributable attempt still emits, with a literal label.
    expect(metrics.recordConnectorOutcome).toHaveBeenCalledWith({
      appId: 'unknown',
      outcome: 'succeeded',
      taxonomyCode: 'none',
    });
    expect(metrics.recordSubmissionStatus).toHaveBeenLastCalledWith({
      appId: 'unknown',
      status: 'confirmed',
    });
  });
});
