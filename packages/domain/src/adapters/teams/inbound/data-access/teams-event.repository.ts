import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, type Collection } from 'mongodb';

/**
 * D-39 fail-closed storage timeouts: small enough that a Mongo outage surfaces
 * as a 503 inside the <200 ms ack budget rather than holding the connection.
 */
export const TEAMS_EVENT_REPOSITORY_SERVER_SELECTION_TIMEOUT_MS = 500;
export const TEAMS_EVENT_REPOSITORY_CONNECT_TIMEOUT_MS = 500;
export const TEAMS_EVENT_REPOSITORY_SOCKET_TIMEOUT_MS = 500;

export interface TeamsEventDocument {
  readonly platform_event_id: string; // D-07 dedupe key
  readonly platform: 'teams';
  readonly payload: unknown;
  readonly createdAt: Date;
}

export type TeamsEventInsertResult = 'inserted' | 'duplicate';

@Injectable()
export class TeamsEventRepository {
  private readonly client: MongoClient;
  private readonly dbName: string;
  private indexPromise: Promise<void> | undefined;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('MONGO_URL');
    this.client = new MongoClient(url, {
      serverSelectionTimeoutMS: TEAMS_EVENT_REPOSITORY_SERVER_SELECTION_TIMEOUT_MS,
      connectTimeoutMS: TEAMS_EVENT_REPOSITORY_CONNECT_TIMEOUT_MS,
      socketTimeoutMS: TEAMS_EVENT_REPOSITORY_SOCKET_TIMEOUT_MS,
    });
    this.dbName = new URL(url).pathname.replace(/^\//, '') || 'akane';
  }

  private get collection(): Collection<TeamsEventDocument> {
    return this.client.db(this.dbName).collection<TeamsEventDocument>('teams_events');
  }

  private ensureIndex(): Promise<void> {
    if (!this.indexPromise) {
      this.indexPromise = this.collection
        .createIndex({ platform_event_id: 1 } as unknown as Record<string, 1>, { unique: true })
        .then(() => undefined)
        .catch((err: unknown) => {
          // Index may already exist with same spec; ignore.
          const msg = err instanceof Error ? err.message : String(err);
          if (!/already exists|Index with name/i.test(msg)) {
            throw err;
          }
        });
    }
    return this.indexPromise;
  }

  async insert(platformEventId: string, payload: unknown): Promise<TeamsEventInsertResult> {
    await this.ensureIndex();
    try {
      await this.collection.insertOne({
        platform_event_id: platformEventId,
        platform: 'teams',
        payload,
        createdAt: new Date(),
      } as unknown as TeamsEventDocument);
      return 'inserted';
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        return 'duplicate';
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === 11000) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /E11000 duplicate key/i.test(msg);
}