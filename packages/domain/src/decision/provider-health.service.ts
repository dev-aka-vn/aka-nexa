import type { HealthStatus, JevProvider } from '@akane/contract';

export interface ProviderHealthRecord {
  readonly healthy: boolean;
  readonly probedAtMs: number;
}

/**
 * 60-second health-probe loop (RTE-07).
 *
 * A provider is *usable* only while its latest probe succeeded and is fresh
 * (within one probe interval). A failed probe, a stale probe, or a probe that
 * has not run yet means "not verified right now" — the orchestrator skips it,
 * except that the terminal rule-based provider's unhealthiness is a hard
 * failure: it is the only provider that is guaranteed to work, so its absence
 * must be loud, not a silent clarify.
 *
 * The interval timer is `unref`'d so a probe loop never keeps a worker alive,
 * and `now` is injectable so specs can pin the staleness boundary.
 */
export class ProviderHealthService {
  readonly #records = new Map<string, ProviderHealthRecord>();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly providers: readonly JevProvider[],
    private readonly intervalMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Begin the 60s sampling loop. Idempotent. */
  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => {
      void this.probeAll();
    }, this.intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async probeAll(): Promise<void> {
    await Promise.all(
      this.providers.map(async (provider) => {
        let healthy = false;
        try {
          const status: HealthStatus = await provider.healthCheck();
          healthy = status.status === 'healthy' || status.status === 'degraded';
        } catch {
          healthy = false;
        }
        this.#records.set(provider.name, { healthy, probedAtMs: this.now() });
      }),
    );
  }

  lastResult(name: string): ProviderHealthRecord | undefined {
    return this.#records.get(name);
  }

  /** Latest probe succeeded and is younger than one probe interval. */
  isUsable(name: string): boolean {
    const record = this.#records.get(name);
    if (!record || !record.healthy) return false;
    return this.now() - record.probedAtMs <= this.intervalMs;
  }

  /** True only when a recorded probe is failing or stale — the skip signal. */
  isSkipped(name: string): boolean {
    const record = this.#records.get(name);
    if (!record) return false; // never probed: not a skip, just unverified
    return !record.healthy || this.now() - record.probedAtMs > this.intervalMs;
  }

  /**
   * The local-provider guarantee. Throws when the rule-based provider's latest
   * probe failed or went stale — an operation cannot fail *loud* without an
   * exception the caller is forced to confront.
   */
  assertLocalHealthy(localProviderName: string): void {
    if (this.isSkipped(localProviderName)) {
      throw new Error(`LOCAL_PROVIDER_UNHEALTHY: '${localProviderName}' failed its health probe`);
    }
  }
}
