import { Injectable } from '@nestjs/common';
import { MongoService } from '@akane/platform';

export interface ConversationReferenceRecord {
  readonly key: string;
  readonly serviceUrl: string;
  readonly conversationId: string;
  readonly tenantId: string;
  readonly chatUserId: string;
  readonly channelId: string;
  readonly reference: unknown; // full continuation payload (Teams ConversationReference)
  readonly updatedAt: Date;
}

export interface ConversationReferenceInput {
  readonly serviceUrl: string;
  readonly conversationId: string;
  readonly tenantId: string;
  readonly chatUserId: string;
  readonly channelId: string;
  readonly reference: unknown;
}

@Injectable()
export class ConversationReferenceRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<ConversationReferenceRecord>('conversation_references');
  }

  static key(channelId: string, chatUserId: string): string {
    return `${channelId}::${chatUserId}`;
  }

  async upsert(key: string, input: ConversationReferenceInput): Promise<void> {
    await this.collection.updateOne(
      { key },
      {
        $set: {
          key,
          serviceUrl: input.serviceUrl,
          conversationId: input.conversationId,
          tenantId: input.tenantId,
          chatUserId: input.chatUserId,
          channelId: input.channelId,
          reference: input.reference,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  async get(key: string): Promise<ConversationReferenceRecord | null> {
    return this.collection.findOne({ key });
  }
}