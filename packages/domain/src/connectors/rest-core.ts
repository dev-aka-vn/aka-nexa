import { ConnectorExecuteOutcome } from '@contract/connector/connector';

export interface RestCredential {
  readonly headerName: string;
  readonly decryptedValue: string;
}

export interface RestConfig {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
}

export interface RestRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

export class RestCore {
  constructor(
    private readonly config: RestConfig,
    private readonly credential: RestCredential,
  ) {}

  async request(req: RestRequest): Promise<ConnectorExecuteOutcome> {
    const url = this.buildUrl(req.path);
    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 30000;

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        ...req.headers,
      };
      headers[this.credential.headerName] = this.credential.decryptedValue;
      headers['content-type'] = headers['content-type'] ?? 'application/json';

      const res = await fetch(url, {
        method: req.method,
        headers,
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: controller.signal,
      });

      if (res.ok) {
        // Try to extract external id if possible; not strictly required
        return {
          externalId: null,
          status: 'succeeded',
        };
      }

      if (res.status >= 500) {
        return {
          externalId: null,
          status: 'failed_transient',
        };
      }

      // 4xx - client errors
      return {
        externalId: null,
        status: 'rejected',
      };
    } catch (err) {
      // Network errors, timeouts etc
      return {
        externalId: null,
        status: 'failed_transient',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }
}
