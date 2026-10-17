import { ConnectorExecuteOutcome } from '@akane/contract';
import type { TransportError } from './error-taxonomy.js';

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
        let externalId: string | null = null;
        try {
          const body = await res.json();
          if (body && typeof body === 'object') {
            // Try common patterns like {issue: {id}}, {id}, etc.
            if ('issue' in body && body.issue && typeof body.issue === 'object' && 'id' in body.issue) {
              externalId = String(body.issue.id);
            } else if ('id' in body) {
              externalId = String(body.id);
            }
          }
        } catch {
          // Ignore parse errors
        }
        return {
          externalId,
          status: 'succeeded',
          code: undefined,
        };
      }

      // Use taxonomy to classify errors
      const { classifyError } = await import('./error-taxonomy.js');
      const isCreate = req.method === 'POST';
      const classified = classifyError(res.status, { isCreate });
      return classified.outcome;
    } catch (err) {
      // Network errors, timeouts etc
      const { classifyError } = await import('./error-taxonomy.js');
      const classified = classifyError(err as TransportError);
      return classified.outcome;
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
