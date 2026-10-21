import { MongoService } from '@akane/platform';
import { AuditRepository, ActorErasureService, SubmissionRevisionsRepository } from '@akane/domain';

export interface EraseActorDeps {
  mongo?: MongoService;
  mongoService?: MongoService;
  audit?: AuditRepository;
  auditRepo?: AuditRepository;
  auditRepository?: AuditRepository;
  revisions?: SubmissionRevisionsRepository;
  submissionRevisions?: SubmissionRevisionsRepository;
  submissionRevisionsRepository?: SubmissionRevisionsRepository;
  now?: () => number;
}

function parseArgs(args: string[]): { realUserId?: string; ticket?: string } {
  const out: { realUserId?: string; ticket?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--real-user-id' || a === '--realUserId') out.realUserId = args[++i];
    else if (a === '--ticket' || a === '--ticket-ref') out.ticket = args[++i];
    else if (a.startsWith('--real-user-id=')) out.realUserId = a.split('=')[1];
    else if (a.startsWith('--ticket=')) out.ticket = a.split('=')[1];
  }
  return out;
}

function resolveDeps(deps?: EraseActorDeps): { mongo: MongoService; audit: AuditRepository; revisions: SubmissionRevisionsRepository } {
  const mongo = deps?.mongo ?? deps?.mongoService;
  if (!mongo) throw new Error('mongo required');
  const audit = deps?.audit ?? deps?.auditRepo ?? deps?.auditRepository ?? new AuditRepository(mongo);
  const revisions = deps?.revisions ?? deps?.submissionRevisions ?? deps?.submissionRevisionsRepository ?? new SubmissionRevisionsRepository(mongo);
  return { mongo, audit, revisions };
}

export async function eraseActor(realUserId: string, ticket: string, deps?: EraseActorDeps, operatorId?: string): Promise<number> {
  const { mongo, audit, revisions } = resolveDeps(deps);
  const service = new ActorErasureService(mongo, audit, revisions, deps?.now);
  const result = await service.erase(realUserId, ticket, operatorId);
  const status = (result as { status?: string }).status ?? '';
  if (status === 'nothing-matched' || status === 'already-erased' && false) {
    // nothing-matched => non-zero; already-erased => zero? plan: second invocation reports already-erased; exit? CLI exits non-zero only when no actor matches.
  }
  if (status === 'nothing-matched') {
    console.error(`nothing matched for ${realUserId}`);
    return 1;
  }
  const r = result as { redacted?: number; purged?: number };
  console.log(`${status}: redacted=${r.redacted ?? 0} purged=${r.purged ?? 0}`);
  return 0;
}

export async function runEraseActor(args: string[] = process.argv.slice(2), deps?: EraseActorDeps): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed.realUserId || !parsed.ticket) {
    console.error('missing --real-user-id or --ticket');
    process.exitCode = 2;
    return;
  }
  const code = await eraseActor(parsed.realUserId, parsed.ticket, deps);
  if (code !== 0) process.exitCode = code;
}

// alias
export const runErase = runEraseActor;

export default runEraseActor;
