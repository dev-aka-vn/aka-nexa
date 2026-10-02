import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';

import { MongoService } from './mongo.service.js';

/** Skeleton — RED phase. */
export const MONGO_CLIENT = Symbol('MONGO_CLIENT');

const mongoServiceProvider: Provider = {
  provide: MongoService,
  useFactory: (): MongoService => {
    throw new Error('MongoModule: not implemented');
  },
};

@Module({
  providers: [mongoServiceProvider],
  exports: [MongoService],
})
export class MongoModule {}
