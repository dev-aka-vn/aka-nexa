import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { authorizeJWT, loadAuthConfigFromEnv } from '@microsoft/agents-hosting';
import type { AuthConfiguration } from '@microsoft/agents-hosting';

/**
 * Teams webhook authentication guard.
 *
 * Per STACK §7.3 the Microsoft 365 Agents SDK ships no auth middleware, so
 * `authorizeJWT(AuthConfiguration)` must be called explicitly. The guard builds
 * the auth configuration lazily (on first authenticated request) so a module
 * that never handles a Teams turn — including unit tests without Teams env —
 * still boots.
 *
 * D-06 exception: the Teams endpoint-verification handshake (`activity.type ===
 * 'urlVerification'`) carries no bot JWT. Per official Agents SDK guidance it is
 * the one unauthenticated case the guard passes through untouched so the
 * controller can echo the challenge.
 */
@Injectable()
export class TeamsAuthGuard implements CanActivate {
  private authConfig?: AuthConfiguration;
  private middleware?: ReturnType<typeof authorizeJWT>;

  private getMiddleware(): ReturnType<typeof authorizeJWT> {
    if (!this.middleware) {
      if (!this.authConfig) {
        this.authConfig = loadAuthConfigFromEnv();
      }
      this.middleware = authorizeJWT(this.authConfig);
    }
    return this.middleware;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      body?: unknown;
      headers?: Record<string, string | string[] | undefined>;
      method?: string;
    }>();
    const res = http.getResponse<Record<string, unknown>>();

    // D-06: urlVerification handshake passes through unauthenticated.
    const body = req.body as { type?: unknown } | undefined;
    if (body && typeof body === 'object' && body.type === 'urlVerification') {
      return true;
    }

    // Missing Authorization header → 401.
    if (!req.headers?.authorization) {
      throw new UnauthorizedException('authorization header not found');
    }

    let succeeded = false;
    try {
      await this.getMiddleware()(req as never, res as never, () => {
        succeeded = true;
      });
    } catch {
      succeeded = false;
    }

    if (!succeeded) {
      throw new UnauthorizedException();
    }
    return true;
  }

  static extractRawBody(_req: Request): Buffer | string | undefined {
    return undefined;
  }
}
