import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConfigModule } from '../config/config.module.js';
import { MongoService } from './mongo.service.js';

/**
 * DI token for the Mongo connection (FND-05).
 *
 * A symbol, like `REDIS_CACHE` / `REDIS_QUEUE` (D-12), so a string token used
 * elsewhere cannot accidentally satisfy it. The service is registered under
 * **both** this token and its own class: the class is what repository code
 * injects, and the token is what the health layer and the boundary manifest
 * name, because those should not have to import a concrete class to refer to a
 * capability.
 */
export const MONGO_CLIENT = Symbol('MONGO_CLIENT');

/**
 * The URL comes from the validated `AppConfig`, never from a raw env read.
 * `namedValidate` has already refused a missing or non-URL value at boot
 * (FND-09), so `getOrThrow` here is a type narrowing, not a second validation.
 */
export const mongoServiceProvider: Provider = {
  provide: MongoService,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MongoService =>
    new MongoService(config.getOrThrow<string>('MONGO_URL')),
};

@Module({
  imports: [ConfigModule],
  providers: [mongoServiceProvider, { provide: MONGO_CLIENT, useExisting: MongoService }],
  exports: [MongoService, MONGO_CLIENT],
})
export class MongoModule {}
