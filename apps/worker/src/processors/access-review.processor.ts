import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AccessReviewService } from '@akane/domain';
import { MongoService } from '@akane/platform';

@Processor('access-review')
export class AccessReviewProcessor extends WorkerHost {
  constructor(private readonly mongo: MongoService) {
    super();
  }
  async process(_job: Job): Promise<void> {
    const service = new AccessReviewService(this.mongo);
    await service.run(new Date());
  }
}
