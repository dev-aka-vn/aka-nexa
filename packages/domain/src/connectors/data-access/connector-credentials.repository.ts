import { Inject, Injectable } from '@nestjs/common';
import { CRYPTO_KEY_PROVIDER, KeyProvider } from '@platform/crypto/key-provider.js';
import { decryptSecret, encryptSecret, SecretEnvelope } from '@platform/crypto/envelope.js';
import { MongoService } from '@platform/mongo/mongo.service.js';

export interface ConnectorCredentialDocument {
  readonly _id: string; // credential_ref
  readonly envelope: SecretEnvelope;
  readonly headerName: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConnectorCredential {
  readonly credentialRef: string;
  readonly headerName: string;
  readonly decryptedValue: string;
}

@Injectable()
export class ConnectorCredentialsRepository {
  constructor(
    private readonly mongo: MongoService,
    @Inject(CRYPTO_KEY_PROVIDER) private readonly keyProvider: KeyProvider,
  ) {}

  private get collection() {
    return this.mongo.db().collection<ConnectorCredentialDocument>('connector_credentials');
  }

  async upsert(credentialRef: string, headerName: string, plaintext: string): Promise<void> {
    const envelope = await encryptSecret(plaintext, this.keyProvider);
    await this.collection.updateOne(
      { _id: credentialRef },
      {
        $set: {
          envelope,
          headerName,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  async get(credentialRef: string): Promise<ConnectorCredential | null> {
    const doc = await this.collection.findOne({ _id: credentialRef });
    if (!doc) {
      return null;
    }
    const decryptedValue = await decryptSecret(doc.envelope, this.keyProvider);
    return {
      credentialRef,
      headerName: doc.headerName,
      decryptedValue: Buffer.isBuffer(decryptedValue) ? decryptedValue.toString('utf8') : String(decryptedValue),
    };
  }
}
