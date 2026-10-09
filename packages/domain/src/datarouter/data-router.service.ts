import { Injectable } from '@nestjs/common';
import { MongoService } from '../../../platform/src/mongo/mongo.service.js';

export type RoutingMode = 'internal' | 'external' | 'hybrid';

export interface RouteSubmissionInput {
  readonly submissionId: string;
  readonly appId: string;
  readonly formId: string;
  readonly data: Record<string, unknown>;
  readonly connectorRef?: string;
  readonly revision?: number;
}

export interface RouteSubmissionResult {
  readonly status: 'accepted';
  readonly revision: number;
}

@Injectable()
export class DataRouterService {
  constructor(private readonly mongo: MongoService) {}

  async routeSubmission(input: RouteSubmissionInput, mode: RoutingMode): Promise<RouteSubmissionResult> {
    const revision = input.revision ?? 0;
    const session = this.mongo.client.startSession();

    try {
      await session.withTransaction(async () => {
        if (mode === 'internal' || mode === 'hybrid') {
          await this.mongo.db().collection('submission_revisions').insertOne(
            {
              submission_id: input.submissionId,
              revision,
              outbound: 'not_sent',
              data: input.data,
              createdAt: new Date(),
            },
            { session },
          );
        }

        if (mode === 'external' || mode === 'hybrid') {
          if (!input.connectorRef) {
            throw new Error('CONNECTOR_REF_REQUIRED: external/hybrid routing requires connectorRef');
          }
          await this.mongo.db().collection('outbox').insertOne(
            {
              published: false,
              revisionRef: `${input.submissionId}:${revision}`,
              connectorRef: input.connectorRef,
              submissionId: input.submissionId,
              revision,
              payload: {
                submissionId: input.submissionId,
                appId: input.appId,
                formId: input.formId,
                data: input.data,
              },
              createdAt: new Date(),
            },
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }

    return {
      status: 'accepted',
      revision,
    };
  }
}
