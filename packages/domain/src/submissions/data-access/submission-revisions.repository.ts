import { MongoService } from '../../../../platform/src/mongo/mongo.service.js';
import { ClientSession } from 'mongodb';

export type OutboundState = 'not_sent' | 'sent_unconfirmed' | 'confirmed';

export interface SubmissionRevisionDocument {
  readonly _id?: string;
  readonly submission_id: string;
  readonly revision: number;
  readonly outbound: OutboundState;
  readonly data: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt?: Date;
  readonly downstreamReference?: string | null;
  readonly edit_jti?: string | null;
}

export class SubmissionRevisionsRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<SubmissionRevisionDocument>('submission_revisions');
  }

  private ensureIndexPromise: Promise<void> | null = null;

  private ensureIndex(): Promise<void> {
    if (this.ensureIndexPromise === null) {
      this.ensureIndexPromise = this.collection
        .createIndex(
          { edit_jti: 1 },
          {
            unique: true,
            partialFilterExpression: { edit_jti: { $exists: true } },
            background: true,
          },
        )
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.ensureIndexPromise;
  }

  async insertInSession(
    submissionId: string,
    revision: number,
    data: Record<string, unknown>,
    session: ClientSession,
    editJti?: string | null,
  ): Promise<void> {
    await this.ensureIndex();
    await this.collection.insertOne(
      {
        submission_id: submissionId,
        revision,
        outbound: 'not_sent',
        data,
        createdAt: new Date(),
        ...(editJti ? { edit_jti: editJti } : {}),
      },
      { session },
    );
  }

  async findBySubmissionAndRevision(submissionId: string, revision: number): Promise<SubmissionRevisionDocument | null> {
    return this.collection.findOne({ submission_id: submissionId, revision });
  }

  async setOutboundState(submissionId: string, revision: number, outbound: OutboundState): Promise<void> {
    await this.collection.updateOne(
      { submission_id: submissionId, revision },
      { $set: { outbound, updatedAt: new Date() } },
    );
  }

  async setConfirmed(submissionId: string, revision: number, downstreamReference?: string | null): Promise<void> {
    await this.collection.updateOne(
      { submission_id: submissionId, revision },
      { $set: { outbound: 'confirmed', downstreamReference: downstreamReference ?? null, updatedAt: new Date() } },
    );
  }

  async setSentUnconfirmed(submissionId: string, revision: number): Promise<void> {
    await this.collection.updateOne(
      { submission_id: submissionId, revision },
      { $set: { outbound: 'sent_unconfirmed', updatedAt: new Date() } },
    );
  }

  async findByOutboundStatus(outbound: OutboundState): Promise<SubmissionRevisionDocument[]> {
    return this.collection.find({ outbound }).toArray();
  }

  async findLatest(submissionId: string): Promise<SubmissionRevisionDocument | null> {
    const doc = await this.collection
      .find({ submission_id: submissionId })
      .sort({ revision: -1 })
      .limit(1)
      .toArray();
    return doc[0] ?? null;
  }

  async findByEditJti(jti: string): Promise<SubmissionRevisionDocument | null> {
    return this.collection.findOne({ edit_jti: jti });
  }
}
