import { MongoService } from '@akane/platform';

export interface AppDocument {
  readonly app_id: string;
  readonly connector_ref: string;
  readonly updatedAt?: Date;
}

export class AppRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<AppDocument>('apps');
  }

  async findByAppId(appId: string): Promise<AppDocument | null> {
    return this.collection.findOne({ app_id: appId });
  }

  async updateConnectorRef(appId: string, connectorRef: string): Promise<void> {
    await this.collection.updateOne(
      { app_id: appId },
      { $set: { connector_ref: connectorRef, updatedAt: new Date() } },
    );
  }

  async upsert(appId: string, connectorRef: string): Promise<void> {
    await this.collection.updateOne(
      { app_id: appId },
      { $set: { connector_ref: connectorRef, updatedAt: new Date() }, $setOnInsert: { app_id: appId } },
      { upsert: true },
    );
  }
}
