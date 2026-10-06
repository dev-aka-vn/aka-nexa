import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';

@Injectable()
@Processor('inbound-events')
export class InboundEventProcessor extends WorkerHost {
  async process(): Promise<any> {
    // Placeholder implementation for Plan 02-01
    return { ok: true };
  }
}
