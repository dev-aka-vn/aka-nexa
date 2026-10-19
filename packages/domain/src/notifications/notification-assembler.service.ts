import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { ImPlatformSchema, OutboundMessageSchema, type ImPlatform, type OutboundMessage } from '@akane/contract';
import { NOTIFICATION_SEND_QUEUE } from '@akane/platform';

import { SubmissionRepository } from '../submissions/submission.repository.js';
import {
  SubmissionRevisionsRepository,
  type SubmissionRevisionDocument,
} from '../submissions/data-access/submission-revisions.repository.js';
import { IdentityMappingRepository } from '../identity/identity-mapping.repository.js';
import { LinkIssuerService, type IssueLinkInput } from '../links/link-issuer.service.js';

export type NotificationAssembleResult =
  | { kind: 'assembled'; message: OutboundMessage }
  | { kind: 'unresolved'; reference: string }
  | { kind: 'unmapped'; realUserId: string };

@Injectable()
export class NotificationAssemblerService {
  private readonly logger = new Logger(NotificationAssemblerService.name);

  constructor(
    private readonly revisions: SubmissionRevisionsRepository,
    private readonly submissions: SubmissionRepository,
    private readonly identity: IdentityMappingRepository,
    private readonly linkIssuer: LinkIssuerService,
  ) {}

  async assemble(
    connectorId: string,
    entityReference: string,
    statusText: string,
  ): Promise<NotificationAssembleResult> {
    const revision: SubmissionRevisionDocument | null =
      await this.revisions.findByDownstreamReference(connectorId, entityReference);

    if (!revision) {
      this.logger.warn({ reason: 'unresolved_reference', connectorId, reference: entityReference });
      return { kind: 'unresolved', reference: entityReference };
    }

    const submission = await this.submissions.findById(revision.submission_id);
    if (!submission) {
      this.logger.warn({ reason: 'unresolved_reference', connectorId, reference: entityReference });
      return { kind: 'unresolved', reference: entityReference };
    }

    const mapping = await this.identity.findByRealUserId(submission.real_user_id);
    if (!mapping) {
      this.logger.warn({ reason: 'unmapped_submitter', connectorId, realUserId: submission.real_user_id });
      return { kind: 'unmapped', realUserId: submission.real_user_id };
    }

    const platform = ImPlatformSchema.parse(mapping.platform) as ImPlatform;
    const channelId = mapping.channel_id ?? mapping.chat_user_id;

    const link = await this.linkIssuer.issue({
      appId: submission.app_id,
      realUserId: submission.real_user_id,
      formId: submission.form_id,
      formVersion: submission.form_version,
      action: 'notification',
    } as IssueLinkInput);

    const text = `${statusText} ${link}`.trim();

    const message: OutboundMessage = OutboundMessageSchema.parse({
      message_id: randomUUID(),
      platform,
      channel_id: channelId,
      chat_user_id: mapping.chat_user_id,
      text: text.length > 0 ? text : statusText,
      action: 'status',
      queue: NOTIFICATION_SEND_QUEUE,
      attempt: 0,
    });

    return { kind: 'assembled', message };
  }
}