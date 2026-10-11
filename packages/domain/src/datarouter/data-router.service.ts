import { Injectable } from '@nestjs/common';
import { MongoService } from '@akane/platform';

export type RoutingMode = 'internal' | 'external' | 'hybrid';

export interface RouteSubmissionInput {
  readonly submissionId: string;
  readonly appId: string;
  readonly formId: string;
  readonly data: Record<string, unknown>;
  readonly connectorRef?: string;
  readonly revision?: number;
}

export type RouteSubmissionStatus = 'accepted' | 'failed_permanent';

export interface RouteSubmissionResult {
  readonly status: RouteSubmissionStatus;
  readonly revision: number;
}

export interface RouteEditInput {
  readonly submissionId: string;
  readonly appId: string;
  readonly formId: string;
  readonly data: Record<string, unknown>;
  readonly connectorRef?: string;
  readonly revision?: number;
  readonly editJti: string;
}

@Injectable()
export class DataRouterService {
  constructor(private readonly mongo: MongoService) {}

  async routeSubmission(input: RouteSubmissionInput, mode: RoutingMode): Promise<RouteSubmissionResult> {
    if (mode !== 'internal' && mode !== 'external' && mode !== 'hybrid') {
      return {
        status: 'failed_permanent',
        revision: input.revision ?? 0,
      };
    }

    const revision = input.revision ?? 0;
    const payload = input.data ?? {};

    const isEmptyPayload = typeof payload === 'object' && payload !== null && Object.keys(payload).length === 0;
    if ((mode === 'external' || mode === 'hybrid') && isEmptyPayload) {
      return {
        status: 'failed_permanent',
        revision,
      };
    }

    if ((mode === 'external' || mode === 'hybrid') && !input.connectorRef) {
      return {
        status: 'failed_permanent',
        revision,
      };
    }

    const session = this.mongo.client.startSession();

    try {
      await session.withTransaction(async () => {
        if (mode === 'internal' || mode === 'hybrid') {
          await this.mongo.db().collection('submission_revisions').insertOne(
            {
              submission_id: input.submissionId,
              revision,
              outbound: 'not_sent',
              data: payload,
              createdAt: new Date(),
            },
            { session },
          );
        }

        if (mode === 'external' || mode === 'hybrid') {
          await this.mongo.db().collection('outbox').insertOne(
            {
              published: false,
              revisionRef: `${input.submissionId}:${revision}`,
              connectorRef: input.connectorRef!,
              submissionId: input.submissionId,
              revision,
              payload: {
                submissionId: input.submissionId,
                appId: input.appId,
                formId: input.formId,
                data: payload,
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

  async routeEdit(input: RouteEditInput): Promise<RouteSubmissionResult> {
    const revision = input.revision ?? 1; // edits create a new revision
    const payload = input.data ?? {};
    const session = this.mongo.client.startSession();

    try {
      await session.withTransaction(async () => {
        // Insert revision with edit_jti
        await this.mongo.db().collection('submission_revisions').insertOne(
          {
            submission_id: input.submissionId,
            revision,
            outbound: 'not_sent',
            data: payload,
            createdAt: new Date(),
            edit_jti: input.editJti,
          },
          { session },
        );

        // Insert outbox row
        await this.mongo.db().collection('outbox').insertOne(
          {
            published: false,
            revisionRef: `${input.submissionId}:${revision}`,
            connectorRef: input.connectorRef!,
            submissionId: input.submissionId,
            revision,
            payload: {
              submissionId: input.submissionId,
              appId: input.appId,
              formId: input.formId,
              data: payload,
            },
            createdAt: new Date(),
          },
          { session },
        );
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
