import { Injectable } from '@nestjs/common';
import { MongoService } from '@akane/platform';

export type ConnectorTrustMechanism = 'hmac-sha256' | 'mtls' | 'ip-allowlist' | 'other';

export interface ConnectorTrustRecord {
  readonly connectorId: string;
  readonly mechanism: ConnectorTrustMechanism;
  readonly note: string;
  readonly updatedBy: string;
  readonly updatedAt: Date;
}

export interface ConnectorTrustInput {
  readonly mechanism: ConnectorTrustMechanism;
  readonly note: string;
  readonly updatedBy: string;
}

@Injectable()
export class ConnectorTrustRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<ConnectorTrustRecord>('connector_trust');
  }

  private async ensureIndex(): Promise<void> {
    await this.collection.createIndex({ connectorId: 1 }, { unique: true, background: true }).catch(() => undefined);
  }

  async get(connectorId: string): Promise<ConnectorTrustRecord | null> {
    return this.collection.findOne({ connectorId });
  }

  async upsert(connectorId: string, input: ConnectorTrustInput): Promise<ConnectorTrustRecord> {
    await this.ensureIndex();
    const now = new Date();
    const doc: ConnectorTrustRecord = {
      connectorId,
      mechanism: input.mechanism,
      note: input.note,
      updatedBy: input.updatedBy,
      updatedAt: now,
    };
    await this.collection.updateOne(
      { connectorId },
      { $set: doc },
      { upsert: true },
    );
    return doc;
  }

  async list(): Promise<ConnectorTrustRecord[]> {
    await this.ensureIndex();
    return this.collection.find({}).toArray();
  }
}