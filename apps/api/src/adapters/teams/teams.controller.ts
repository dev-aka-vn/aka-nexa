import { BadRequestException, Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { TeamsAuthGuard } from './teams-auth.guard.js';
import { TeamsActivityService } from './teams-activity.service.js';

@Controller('teams')
@UseGuards(TeamsAuthGuard)
export class TeamsController {
  constructor(private readonly activityService: TeamsActivityService) {}

  @Post('events')
  async handleEvents(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const b = body as { type?: unknown; value?: unknown; id?: unknown } | undefined;

    // D-06: Teams endpoint-verification handshake answered before the pipeline.
    if (b && typeof b === 'object' && b.type === 'urlVerification') {
      res.status(200).send(String(b.value ?? ''));
      return;
    }

    if (!b || typeof b !== 'object' || typeof b.id !== 'string' || b.id.length === 0) {
      throw new BadRequestException();
    }

    const outcome = await this.activityService.handle(b);
    // Both 'enqueued' and 'duplicate' are successful acks.
    res.status(200).send(outcome);
  }
}