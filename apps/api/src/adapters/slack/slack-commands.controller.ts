import { Body, Controller, Post, RawBody, UseInterceptors } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';

@Controller('slack')
export class SlackCommandsController {
  @Post('commands')
  handleCommand(@RawBody() _rawBody: Buffer | string, @Body() _body: any): any {
    // Placeholder implementation for Plan 02-01
    return { ok: true };
  }
}
