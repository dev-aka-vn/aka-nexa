import { MongoService } from '../../../../platform/src/mongo/mongo.service.js';
import { ClientSession, ObjectId } from 'mongodb';

export interface OutboxDocument {
  readonly _id?: ObjectId;
  readonly published: boolean;
  readonly revisionRef: string; // e.g., "sub-1:0" or similar
  readonly connectorRef: string;
  readonly submissionId: string;
  readonly revision: number;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
  readonly publishedAt?: Date;
}

export interface OutboxEntry {
  readonly submissionId: string;
  readonly revision: number;
  readonly connectorRef: string;
  readonly payload: Record<string, unknown>;
}

export class OutboxRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<OutboxDocument>('outbox');
  }

  async insertInSession(entry: OutboxEntry, session: ClientSession): Promise<void> {
    await this.collection.insertOne(
      {
        published: false,
        revisionRef: `${entry.submissionId}:${entry.revision}`,
        connectorRef: entry.connectorRef,
        submissionId: entry.submissionId,
        revision: entry.revision,
        payload: entry.payload,
        createdAt: new Date(),
      },
      { session },
    );
  }

  async pollUnpublished(limit = 10): Promise<OutboxDocument[]> {
    return this.collection
      .find({ published: false })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
  }

  async markPublished(revisionRef: string): Promise<void> {
    await this.collection.updateOne(
      { revisionRef, published: false },
      { $set: { published: true, publishedAt: new Date() } },
    );
  }
}
