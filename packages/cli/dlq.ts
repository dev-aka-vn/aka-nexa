import { Queue } from 'bullmq';
import { producerConnectionOptions } from '@akane/platform';
import {
  AuditRepository,
  ConnectorCredentialsRepository,
  ConnectorRegistry,
  SubmissionRevisionsRepository,
} from '@akane/domain';

const DELIVERY_QUEUE_NAME = 'connector-delivery';
const BULLMQ_PREFIX = '{akane-q}';

/** The shape `connector-delivery` jobs carry in `job.data`. */
interface DeliveryJobData {
  submissionId?: string;
  revision?: number;
  connectorRef?: string;
}

export interface DlqListOptions {
  showPayload?: boolean;
  auditRepo?: AuditRepository;
}

export async function dlqList(
  queueUrl: string,
  revisionsRepo: SubmissionRevisionsRepository,
  options: DlqListOptions = {},
): Promise<void> {
  const queue = new Queue(DELIVERY_QUEUE_NAME, {
    connection: producerConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  });

  try {
    const failed = await queue.getFailed(0, 1000);
    const rows: Array<{
      id: string;
      submission_id: string;
      revision: number;
      outbound: string;
      taxonomyCode: string;
      attempts: number;
      failedAt: string;
    }> = [];

    for (const job of failed) {
      const data = job.data as DeliveryJobData;
      const submissionId = data?.submissionId;
      const revision = data?.revision;
      let outbound = 'unknown';
      if (submissionId !== undefined && revision !== undefined) {
        const rev = await revisionsRepo.findBySubmissionAndRevision(submissionId, revision);
        if (rev) {
          outbound = rev.outbound;
        }
      }
      rows.push({
        id: job.id || 'unknown',
        submission_id: submissionId || 'unknown',
        revision: revision ?? 0,
        outbound,
        taxonomyCode: job.failedReason || 'unknown',
        attempts: job.attemptsMade,
        failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : new Date().toISOString(),
      });
    }
    rows.sort((a, b) => a.failedAt.localeCompare(b.failedAt));

    if (rows.length === 0) {
      console.log('DLQ is empty');
      return;
    }

    if (options.showPayload) {
      if (options.auditRepo) {
        await options.auditRepo.append({
          timestamp: new Date(),
          actor: 'cli:dlq',
          action: 'dlq_show_payload',
          target: 'all',
        });
      }
    }

    console.log(
      'id\tsubmission_id\trevision\toutbound\ttaxonomyCode\tattempts\tfailedAt',
    );
    for (const row of rows) {
      console.log(
        `${row.id}\t${row.submission_id}\t${row.revision}\t${row.outbound}\t${row.taxonomyCode}\t${row.attempts}\t${row.failedAt}`,
      );
    }
  } finally {
    await queue.close();
  }
}

export interface DlqRetryOptions {
  force?: boolean;
  auditRepo?: AuditRepository;
  registry?: ConnectorRegistry;
  credsRepo?: ConnectorCredentialsRepository;
  queueUrl?: string;
}

export async function dlqRetry(
  jobId: string,
  queueUrl: string,
  revisionsRepo: SubmissionRevisionsRepository,
  options: DlqRetryOptions = {},
): Promise<void> {
  const queue = new Queue(DELIVERY_QUEUE_NAME, {
    connection: producerConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  });

  try {
    const failedJobs = await queue.getFailed();
    const job = failedJobs.find((j) => j.id === jobId);
    if (!job) {
      throw new Error(`Job not found in failed set: ${jobId}`);
    }

    const data = job.data as DeliveryJobData;
    const submissionId = data?.submissionId;
    const revision = data?.revision;

    if (submissionId !== undefined && revision !== undefined) {
      const rev = await revisionsRepo.findBySubmissionAndRevision(submissionId, revision);
      if (rev && rev.outbound === 'sent_unconfirmed') {
        if (!options.force) {
          throw new Error('sent_unconfirmed requires --force');
        }
      } else if (rev && rev.outbound !== 'not_sent' && !options.force) {
        // For other states, be conservative
      }
    }

    await job.retry();
  } finally {
    await queue.close();
  }
}

export async function runDlq(
  args: string[] = process.argv.slice(2),
  deps?: {
    queueUrl: string;
    revisionsRepo: SubmissionRevisionsRepository;
    auditRepo?: AuditRepository;
    registry?: ConnectorRegistry;
    credsRepo?: ConnectorCredentialsRepository;
  },
): Promise<void> {
  if (!deps) {
    throw new Error('Dependencies required');
  }
  const command = args[0];
  if (command === 'list') {
    const showPayload = args.includes('--show-payload');
    await dlqList(deps.queueUrl, deps.revisionsRepo, {
      showPayload,
      auditRepo: deps.auditRepo,
    });
  } else if (command === 'retry') {
    const jobId = args[1];
    if (!jobId) {
      throw new Error('Job ID required');
    }
    const force = args.includes('--force');
    await dlqRetry(jobId, deps.queueUrl, deps.revisionsRepo, {
      force,
      auditRepo: deps.auditRepo,
      registry: deps.registry,
      credsRepo: deps.credsRepo,
      queueUrl: deps.queueUrl,
    });
  } else {
    console.log('Usage: dlq <list|retry> [options]');
  }
}
