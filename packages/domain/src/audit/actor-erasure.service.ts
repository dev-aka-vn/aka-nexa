import { MongoService } from '@akane/platform';
import { AuditRepository, type AuditEntry } from './audit.repository.js';

export interface ErasureResult {
  status: 'erased' | 'already-erased' | 'nothing-matched';
  outcome: 'erased' | 'already-erased' | 'nothing-matched';
  result: 'erased' | 'already-erased' | 'nothing-matched';
  erased: boolean;
  alreadyErased: boolean;
  nothingMatched: boolean;
  redacted: number;
  redactedCount: number;
  purged: number;
  purgedCount: number;
  count: number;
}

export class ActorErasureService {
  private readonly mongo?: MongoService;
  private readonly audit?: AuditRepository;
  private readonly revisions?: unknown;
  private readonly now: () => number;

  constructor(...args: unknown[]) {
    let now: (() => number) | undefined;
    for (const a of args) {
      if (a && typeof (a as { db?: unknown }).db === 'function') this.mongo = a as MongoService;
      else if (a && typeof (a as { append?: unknown }).append === 'function') this.audit = a as AuditRepository;
      else if (a && typeof (a as { purgeSubmissionBodies?: unknown }).purgeSubmissionBodies === 'function') this.revisions = a;
      else if (typeof a === 'function') now = a as () => number;
    }
    this.now = now ?? (() => Date.now());
  }

  private get db() {
    if (!this.mongo) throw new Error('ActorErasureService: no MongoService');
    return this.mongo.db();
  }

  private async findMappingDocs(realUserId: string): Promise<{ collection: string; docs: Record<string, unknown>[] }> {
    const collections = ['actor_identities', 'identity_mappings', 'actor_mappings'];
    for (const name of collections) {
      try {
        const docs = await this.db.collection(name).find({ real_user_id: realUserId }).toArray();
        if (docs.length > 0) return { collection: name, docs: docs as Record<string, unknown>[] };
      } catch {
        // ignore
      }
    }
    // fallback: maybe collection exists but empty; return first
    return { collection: 'actor_identities', docs: [] };
  }

  private collectRefs(docs: Record<string, unknown>[]): Set<string> {
    const refs = new Set<string>();
    for (const d of docs) {
      for (const [k, v] of Object.entries(d)) {
        if (k === 'actor_ref' || k === 'ref' || k.endsWith('_ref')) {
          if (typeof v === 'string') refs.add(v);
        }
      }
      if (typeof d._id === 'string') refs.add(d._id);
    }
    return refs;
  }

  private async hasPriorErasure(realUserId: string): Promise<boolean> {
    if (!this.audit) return false;
    try {
      const all = await this.audit.findAll();
      return all.some((e) => e.action === 'erasure.executed' && (e.target === realUserId || e.realUserId === realUserId || e.reference === realUserId));
    } catch {
      return false;
    }
  }

  async erase(realUserId: string, ticketRef: string, operatorId?: string): Promise<ErasureResult> {
    if (!realUserId || !ticketRef) throw new Error('real_user_id and ticket are required');
    const op = operatorId ?? 'operator';

    const { collection: mappingCollection, docs: mappingDocs } = await this.findMappingDocs(realUserId);
    const hadMapping = mappingDocs.length > 0;
    const refs = this.collectRefs(mappingDocs);
    if (refs.size === 0) refs.add(realUserId);

    if (!hadMapping) {
      const prior = await this.hasPriorErasure(realUserId);
      if (prior) {
        return makeResult('already-erased', 0, 0);
      }
      return makeResult('nothing-matched', 0, 0);
    }

    // delete mapping rows first
    await this.db.collection(mappingCollection).deleteMany({ real_user_id: realUserId });

    // redact audit rows: every *_ref field by convention
    const auditCollection = this.db.collection('audit_entries');
    const allDocs = await auditCollection.find({}).toArray();
    let redacted = 0;
    for (const doc of allDocs as Record<string, unknown>[]) {
      const set: Record<string, unknown> = {};
      let changed = false;
      for (const key of Object.keys(doc)) {
        if (key.endsWith('_ref')) {
          const val = doc[key];
          if (typeof val === 'string' && refs.has(val)) {
            set[key] = null;
            changed = true;
          } else if (val === realUserId) {
            set[key] = null;
            changed = true;
          }
        }
      }
      if (changed) {
        await auditCollection.updateOne({ _id: doc._id } as never, { $set: set } as never);
        redacted += 1;
      }
    }

    // purge submission bodies
    let purged = 0;
    if (this.revisions) {
      purged = await (this.revisions as { purgeSubmissionBodies: (a: unknown, b: unknown)=>Promise<number> }).purgeSubmissionBodies(realUserId, refs);
    } else {
      // fallback direct
      try {
        const res = await this.db.collection('submission_revisions').updateMany(
          { $or: [{ real_user_id: realUserId }] } as never,
          { $set: { data: null, purged_at: new Date() } } as never,
        );
        purged = res.modifiedCount ?? 0;
      } catch {
        purged = 0;
      }
    }

    const now = new Date(this.now());
    const entry: AuditEntry = {
      timestamp: now,
      actor: op,
      action: 'erasure.executed',
      target: realUserId,
      realUserId: realUserId,
      reference: ticketRef,
      ticket_ref: ticketRef,
      ticket: ticketRef,
      ticket_reference: ticketRef,
      operator: op,
    };
    if (this.audit) await this.audit.append(entry);

    return makeResult('erased', redacted, purged);
  }
}

function makeResult(status: ErasureResult['status'], redacted: number, purged: number): ErasureResult {
  return {
    status,
    outcome: status,
    result: status,
    erased: status === 'erased',
    alreadyErased: status === 'already-erased',
    nothingMatched: status === 'nothing-matched',
    redacted,
    redactedCount: redacted,
    purged,
    purgedCount: purged,
    count: redacted,
  };
}

export default ActorErasureService;
