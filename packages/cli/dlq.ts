import { Queue } from 'bullmq';
import {
  producerConnectionOptions,
  BULLMQ_PREFIX,
  CONNECTOR_DELIVERY_QUEUE,
  IM_OUTBOUND_QUEUE,
} from '@akane/platform';
import {
  AuditRepository,
  ConnectorCredentialsRepository,
  ConnectorRegistry,
  SubmissionRevisionsRepository,
} from '@akane/domain';

/** The shape `connector-delivery` jobs carry in `job.data`. */
interface DeliveryJobData {
  submissionId?: string;
  revision?: number;
  connectorRef?: string;
}

/** The shape `im-outbound` jobs carry in `job.data` (the `OutboundMessage`). */
interface OutboundJobData {
  message_id?: string;
  platform?: string;
  native_event_id?: string;
  channel_id?: string;
  action?: string;
}

/** One rendered DLQ row. Columns differ per queue; `fields` carries the values. */
interface DlqRow {
  readonly queue: string;
  readonly id: string;
  readonly fields: readonly string[];
  readonly failedAt: string;
}

/** One queue's DLQ column layout. */
interface QueueView {
  readonly name: string;
  readonly header: string;
  readonly render: DlqRenderer;
}

type DlqRenderer = (
  failureReason: string,
  attemptsMade: number,
  finishedOn: number | null | undefined,
  job: { id?: string; data: unknown },
  revisions: SubmissionRevisionsRepository,
) => Promise<DlqRow>;

const DELIVERY_HEADER =
  'queue\tid\tsubmission_id\trevision\toutbound\tattempts\tfailure_reason\tfailedAt';

const OUTBOUND_HEADER =
  'queue\tmessage_id\tplatform\tnative_event_id\tchannel_id\taction\tattempts\tfailure_reason\tfailedAt';

/** Every queue this tool can inspect, with the row shape each one renders. */
const QUEUE_VIEWS: readonly QueueView[] = [
  { name: CONNECTOR_DELIVERY_QUEUE, header: DELIVERY_HEADER, render: renderDeliveryRow },
  { name: IM_OUTBOUND_QUEUE, header: OUTBOUND_HEADER, render: renderOutboundRow },
];

export const INSPECTABLE_QUEUES: readonly string[] = QUEUE_VIEWS.map((v) => v.name);

function queueView(name: string): QueueView {
  const view = QUEUE_VIEWS.find((candidate) => candidate.name === name);
  if (view === undefined) {
    throw new Error(
      `Unknown queue '${name}'. Known queues: ${INSPECTABLE_QUEUES.join(', ')}`,
    );
  }
  return view;
}

/** Resolve a user-supplied `--queue` value, defaulting to the delivery queue. */
function resolveQueueView(requested: string | undefined): QueueView {
  return queueView(requested ?? CONNECTOR_DELIVERY_QUEUE);
}

/**
 * List the failed jobs on one queue (OUT-14).
 *
 * Queue names are never literals here: `IM_OUTBOUND_QUEUE` and
 * `CONNECTOR_DELIVERY_QUEUE` are shared constants, and a DLQ tool that
 * hardcoded a name would silently report on a queue nobody writes to — which
 * is exactly the failure that shipped when the api used `'im:inbound'` and
 * the worker used `'inbound-events'`.
 *
 * The outbound queue is rendered with the **platform event that produced the
 * message** (`native_event_id`), because "which inbound event does this
 * undelivered reply answer?" is the first question an operator asks, and a
 * `message_id` alone cannot answer it.
 */
export async function dlqList(
  queueUrl: string,
  revisionsRepo: SubmissionRevisionsRepository,
  options: DlqListOptions = {},
): Promise<void> {
  const view = resolveQueueView(options.queue);
  const queueName = view.name;
  const queue = new Queue(queueName, {
    connection: producerConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  });

  try {
    const failed = await queue.getFailed(0, 1000);
    const rows: DlqRow[] = [];

    for (const job of failed) {
      rows.push(
        await view.render(
          job.failedReason || 'unknown',
          job.attemptsMade,
          job.finishedOn,
          job,
          revisionsRepo,
        ),
      );
    }
    rows.sort((a, b) => a.failedAt.localeCompare(b.failedAt));

    if (rows.length === 0) {
      console.log(`DLQ is empty (${queueName})`);
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

    console.log(view.header);
    for (const row of rows) {
      console.log(`${row.queue}\t${row.fields.join('\t')}`);
    }
  } finally {
    await queue.close();
  }
}

export interface DlqListOptions {
  showPayload?: boolean;
  auditRepo?: AuditRepository;
  /** Which queue to inspect. Defaults to the connector delivery queue. */
  queue?: string;
}

/** `connector-delivery`: submission, revision, outbound state, reason. */
async function renderDeliveryRow(
  failureReason: string,
  attemptsMade: number,
  finishedOn: number | null | undefined,
  job: { id?: string; data: unknown },
  revisions: SubmissionRevisionsRepository,
): Promise<DlqRow> {
  const data = job.data as DeliveryJobData;
  const submissionId = data?.submissionId;
  const revision = data?.revision;
  let outbound = 'unknown';
  if (submissionId !== undefined && revision !== undefined) {
    const rev = await revisions.findBySubmissionAndRevision(submissionId, revision);
    if (rev) {
      outbound = rev.outbound;
    }
  }
  return {
    queue: CONNECTOR_DELIVERY_QUEUE,
    id: job.id || 'unknown',
    fields: [
      job.id || 'unknown',
      submissionId ?? 'unknown',
      String(revision ?? 0),
      outbound,
      String(attemptsMade),
      String(failureReason),
      isoOrNow(finishedOn),
    ],
    failedAt: isoOrNow(finishedOn),
  };
}

async function renderOutboundRow(
  failureReason: string,
  attemptsMade: number,
  finishedOn: number | null | undefined,
  job: { id?: string; data: unknown },
): Promise<DlqRow> {
  const data = job.data as OutboundJobData;
  return {
    queue: IM_OUTBOUND_QUEUE,
    id: job.id || 'unknown',
    fields: [
      data.message_id ?? 'unknown',
      data.platform ?? 'unknown',
      // OUT-14: the platform event this reply answers — the join key back to
      // the inbound side, and what a `message_id` alone cannot give you.
      data.native_event_id ?? 'unknown',
      data.channel_id ?? 'unknown',
      data.action ?? 'unknown',
      String(attemptsMade),
      String(failureReason),
      isoOrNow(finishedOn),
    ],
    failedAt: isoOrNow(finishedOn),
  };
}

function isoOrNow(finishedOn: number | null | undefined): string {
  return finishedOn ? new Date(finishedOn).toISOString() : new Date().toISOString();
}

export interface DlqRetryOptions {
  force?: boolean;
  auditRepo?: AuditRepository;
  registry?: ConnectorRegistry;
  credsRepo?: ConnectorCredentialsRepository;
  queueUrl?: string;
  /** Which queue the job lives on. Defaults to the connector delivery queue. */
  queue?: string;
}

export async function dlqRetry(
  jobId: string,
  queueUrl: string,
  revisionsRepo: SubmissionRevisionsRepository,
  options: DlqRetryOptions = {},
): Promise<void> {
  const queueName = resolveQueueView(options.queue).name;
  const queue = new Queue(queueName, {
    connection: producerConnectionOptions(queueUrl),
    prefix: BULLMQ_PREFIX,
  });

  try {
    const failedJobs = await queue.getFailed();
    const job = failedJobs.find((j) => j.id === jobId);
    if (!job) {
      throw new Error(`Job not found in failed set: ${jobId} on ${queueName}`);
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
  const queue = readFlagValue(args, '--queue');
  if (command === 'list') {
    const showPayload = args.includes('--show-payload');
    await dlqList(deps.queueUrl, deps.revisionsRepo, {
      showPayload,
      auditRepo: deps.auditRepo,
      queue,
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
      queue,
    });
  } else {
    console.log(`Usage: dlq <list|retry> [--queue <${INSPECTABLE_QUEUES.join('|')}>]`);
  }
}

/** Read `--name value` from an argv list. */
function readFlagValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
