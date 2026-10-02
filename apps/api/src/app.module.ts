import { Module } from '@nestjs/common';
import { ConfigModule } from '@akane/platform';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
})
export class AppModule {}
