import { Module } from '@nestjs/common';
import { SlackCommandsController } from './slack-commands.controller.js';
import { SlackWebhookController } from './slack-webhook.controller.js';

@Module({
  controllers: [SlackCommandsController, SlackWebhookController],
})
export class SlackModule {}
