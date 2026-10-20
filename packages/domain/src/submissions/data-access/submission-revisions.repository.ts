import { MongoService } from '@akane/platform';
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
  readonly connectorId?: string | null;
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
      this.ensureIndexPromise = Promise.all([
        this.collection.createIndex(
          { edit_jti: 1 },
          {
            unique: true,
            partialFilterExpression: { edit_jti: { $exists: true } },
            background: true,
          },
        ),
        this.collection.createIndex(
          { connectorId: 1, downstreamReference: 1 },
          { background: true },
        ),
      ])
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

  async setConfirmed(
    submissionId: string,
    revision: number,
    downstreamReference?: string | null,
    connectorId?: string | null,
  ): Promise<void> {
    await this.ensureIndex();
    await this.collection.updateOne(
      { submission_id: submissionId, revision },
      {
        $set: {
          outbound: 'confirmed',
          downstreamReference: downstreamReference ?? null,
          ...(connectorId !== undefined ? { connectorId: connectorId ?? null } : {}),
          updatedAt: new Date(),
        },
      },
    );
  }

  async findByDownstreamReference(
    connectorId: string,
    reference: string,
  ): Promise<SubmissionRevisionDocument | null> {
    await this.ensureIndex();
    return this.collection.findOne({ connectorId, downstreamReference: reference });
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

  async purgeSubmissionBodies(realUserId: string, refs?: Set<string> | string[]): Promise<number> {
    await this.ensureIndex();
    const refSet = refs instanceof Set ? refs : new Set(refs ?? []);
    // Resolve submission ids owned by the subject.
    const submissionIds: string[] = [];
    try {
      const subs = await this.mongo.db().collection('submissions').find({ real_user_id: realUserId }).project({ _id: 1 }).toArray();
      for (const s of subs) submissionIds.push(String((s as { _id: unknown })._id));
    } catch {
      // ignore
    }
    const or: Record<string, unknown>[] = [];
    if (submissionIds.length > 0) or.push({ submission_id: { $in: submissionIds } });
    or.push({ real_user_id: realUserId });
    or.push({ actor_ref: { $in: Array.from(refSet.size ? refSet : [realUserId]) } });
    or.push({ actor: { $in: Array.from(refSet.size ? refSet : [realUserId]) } });
    const filter = or.length > 0 ? { $or: or } : {};
    const result = await this.collection.updateMany(filter as never, { $set: { data: null, purged_at: new Date() } } as never);
    return result.modifiedCount ?? 0;
  }

}
