import { Module } from '@nestjs/common';
import { InboundEventProcessor } from './processors/inbound-event.processor.js';

@Module({
  providers: [InboundEventProcessor],
})
export class WorkerModule {}
