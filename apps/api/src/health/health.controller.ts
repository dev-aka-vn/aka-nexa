import { Controller, Get } from '@nestjs/common';

/**
 * Liveness endpoint (FND-05).
 *
 * Reads no dependency on purpose: a downed MongoDB or Redis must fail readiness,
 * never liveness, so a dependency blip cannot cascade into a restart loop.
 */
@Controller('health')
export class HealthController {
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }
}
