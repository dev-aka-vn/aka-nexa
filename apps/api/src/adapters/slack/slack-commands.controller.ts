import { Body, Controller, Post, RawBody } from '@nestjs/common';

@Controller('slack')
export class SlackCommandsController {
  @Post('commands')
  handleCommand(
    @RawBody() _rawBody: Buffer | string,
    @Body() _body: Record<string, unknown>,
  ): Record<string, unknown> {
    // Placeholder implementation for Plan 02-01
    return { ok: true };
  }
}
