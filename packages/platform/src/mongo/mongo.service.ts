import type { Db, MongoClient } from 'mongodb';

/**
 * Skeleton — RED phase. The behaviour lives in the spec; this exists so the
 * spec can run and fail on an assertion rather than on a missing module.
 */
export class MongoService {
  readonly client: MongoClient;

  constructor(url: string) {
    void url;
  }

  db(_name?: string): Db {
    throw new Error('MongoService.db: not implemented');
  }

  async ping(): Promise<void> {
    throw new Error('MongoService.ping: not implemented');
  }

  async onModuleDestroy(): Promise<void> {
    throw new Error('MongoService.onModuleDestroy: not implemented');
  }
}
