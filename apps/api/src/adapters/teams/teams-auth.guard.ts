import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Teams webhook authentication guard (skeleton for future use).
 *
 * Per STACK §7.3: The Microsoft 365 Agents SDK does not supply Nest middleware;
 * token validation is performed via `authorizeJWT(AuthConfiguration)` from the
 * Agents SDK. This guard exists as a structured hook for future enforcement
 * and preserves the adapter boundary contract.
 *
 * Note: This guard is not currently applied to all routes; it serves as a
 * safety scaffold consistent with the Teams adapter pattern.
 */
@Injectable()
export class TeamsAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    // Skeleton: actual JWT validation is handled by Agents SDK's authorizeJWT
    // when wiring AgentApplication. Keep as no-op for tracer E2E foundation.
    return true;
  }

  static extractRawBody(_req: Request): Buffer | string | undefined {
    // Placeholder for future raw body extraction logic if needed.
    return undefined;
  }
}
