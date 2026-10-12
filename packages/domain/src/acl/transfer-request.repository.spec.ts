/**
 * ACL-05 — the transfer-request repository.
 *
 * The repository owns the `transfer_requests`
 * collection and the **one-pending-transfer-per-app**
 * invariant: a partial unique index on `{ app_id }`
 * where `state = 'pending'`, created idempotently on
 * first use (the `ConnectorRequestRepository`
 * pattern). The index covers pending rows only — an
 * approved, rejected, or auto-cancelled transfer for
 * the app never blocks a fresh request, which is what
 * makes the re-request flow expressible at the data
 * layer.
 *
 * ## The in-memory double
 *
 * The double models the five operations the repository
 * uses — `createIndex`, `insertOne`, `findOne`, `find`,
 * `findOneAndUpdate` — and **enforces the partial
 * unique index the way MongoDB does**: an insert that
 * would create a second pending row for the same
 * `app_id` fails with the driver's `11000`
 * duplicate-key error. The repository maps that to the
 * named `TRANSFER_PENDING_EXISTS` refusal, the
 * structural half of the invariant (the service-level
 * check is the other half).
 *
 * The double also **records every `createIndex` call**,
 * so the spec asserts the index is partial on
 * `state = 'pending'` — the thing that makes a
 * resolved transfer NOT block a fresh request for the
 * same app.
 */

import { describe, expect, it } from 'vitest';

import type { MongoService } from '@akane/platform';

import type { TransferRequestDocument } from './transfer-request.document.js';
import { TransferRequestRepository } from './transfer-request.repository.js';

// ─── In-memory collection double ─────────────────────────

type Doc = Record<string, unknown> & { _id?: string };

/** The driver's duplicate-key failure — the partial unique index firing. */
class DuplicateKeyError extends Error {
  readonly code = 11000;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `fake-id-${idCounter}`;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    return JSON.stringify(actual) === JSON.stringify(expected);
  });
}

interface RecordedIndex {
  readonly keys: Record<string, 1>;
  readonly options: Record<string, unknown>;
}

class FakeCollection {
  private readonly docs: Doc[] = [];
  readonly indexes: RecordedIndex[] = [];

  async createIndex(
    keys: Record<string, 1>,
    options: Record<string, unknown> = {},
  ): Promise<string> {
    this.indexes.push({ keys, options });
    return `fake-index-${this.indexes.length}`;
  }

  async insertOne(doc: Doc): Promise<{ acknowledged: boolean }> {
    const pendingIndex = this.indexes.find(
      (index) =>
        index.options.partialFilterExpression !== undefined &&
        index.options.unique === true,
    );
    if (pendingIndex !== undefined) {
      const filter = pendingIndex.options
        .partialFilterExpression as Doc;
      const duplicate = this.docs.find(
        (existing) =>
          matches(existing, filter) &&
          matches(existing, {
            app_id: doc['app_id'],
          }),
      );
      if (duplicate !== undefined) {
        throw new DuplicateKeyError();
      }
    }
    const stored = { ...doc, _id: nextId() };
    this.docs.push(stored);
    return { acknowledged: true };
  }

  async findOne(filter: Doc): Promise<Doc | null> {
    return (
      this.docs.find((doc) => matches(doc, filter)) ?? null
    );
  }

  async find(filter: Doc): Promise<{
    sort: (sort: Doc) => { toArray: () => Promise<Doc[]> };
  }> {
    const found = this.docs.filter((doc) =>
      matches(doc, filter),
    );
    return {
      sort: (sort: Doc) => ({
        toArray: async () => {
          const key = Object.keys(sort)[0];
          const direction = sort[key];
          return [...found].sort((left, right) => {
            const leftValue = String(left[key] ?? '');
            const rightValue = String(right[key] ?? '');
            return direction === -1
              ? rightValue.localeCompare(leftValue)
              : leftValue.localeCompare(rightValue);
          });
        },
      }),
    };
  }

  async findOneAndUpdate(
    filter: Doc,
    update: { $set: Doc },
    options: { returnDocument: 'after' | 'before' },
  ): Promise<Doc | null> {
    const index = this.docs.findIndex((doc) =>
      matches(doc, filter),
    );
    if (index === -1) {
      return null;
    }
    const updated = {
      ...this.docs[index],
      ...update.$set,
    };
    this.docs[index] = updated;
    return options.returnDocument === 'after'
      ? updated
      : this.docs[index];
  }
}

/** A `MongoService` double handing out the fake collection. */
function fakeMongo(): MongoService & {
  collection: FakeCollection;
} {
  const collection = new FakeCollection();
  return {
    collection,
    db: () =>
      ({
        collection: () => collection,
      }) as never,
  } as never;
}

/** A pending transfer document for the fixtures. */
function pendingTransfer(
  overrides: Partial<TransferRequestDocument> = {},
): TransferRequestDocument {
  const requestedAt = new Date('2026-10-01T10:00:00.000Z');
  return {
    transfer_id: 'tr_0001',
    app_id: 'leave-request',
    from_user_id: 'user-0001',
    to_user_id: 'user-0002',
    state: 'pending',
    requestedAt,
    expiresAt: new Date(
      requestedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    ),
    ...overrides,
  } as TransferRequestDocument;
}

describe('TransferRequestRepository (ACL-05)', () => {
  it('creates the one-pending partial unique index on first use', async () => {
    const mongo = fakeMongo();
    const repository = new TransferRequestRepository(mongo);

    await repository.create(pendingTransfer());

    // The index is unique over app_id, covering pending
    // rows only — the structural half of the invariant.
    expect(mongo.collection.indexes).toHaveLength(1);
    expect(mongo.collection.indexes[0]).toEqual({
      keys: { app_id: 1 },
      options: {
        unique: true,
        partialFilterExpression: { state: 'pending' },
      },
    });
  });

  it('refuses a second pending request for the same app (the partial index firing)', async () => {
    const mongo = fakeMongo();
    const repository = new TransferRequestRepository(mongo);

    await repository.create(pendingTransfer());

    // A second pending transfer for the same app is the
    // duplicate-key failure the partial unique index
    // produces — mapped to the named refusal.
    await expect(
      repository.create(
        pendingTransfer({ transfer_id: 'tr_0002' }),
      ),
    ).rejects.toThrow(/TRANSFER_PENDING_EXISTS/);
  });

  it('a resolved transfer does not block a fresh request for the same app', async () => {
    const mongo = fakeMongo();
    const repository = new TransferRequestRepository(mongo);

    await repository.create(pendingTransfer());
    // The first request resolves — the partial index no
    // longer covers it.
    await repository.transition('tr_0001', 'approved');

    const fresh = await repository.create(
      pendingTransfer({ transfer_id: 'tr_0002' }),
    );
    expect(fresh.transfer_id).toBe('tr_0002');
  });

  it('finds one transfer by its immutable identity', async () => {
    const mongo = fakeMongo();
    const repository = new TransferRequestRepository(mongo);

    await repository.create(pendingTransfer());

    const found = await repository.findByTransferId(
      'tr_0001',
    );
    expect(found).toMatchObject({
      transfer_id: 'tr_0001',
      app_id: 'leave-request',
      state: 'pending',
    });
    expect(
      await repository.findByTransferId('tr_missing'),
    ).toBeNull();
  });

  it('lists the pending queue, newest first', async () => {
    const mongo = fakeMongo();
    const repository = new TransferRequestRepository(mongo);

    await repository.create(
      pendingTransfer({
        transfer_id: 'tr_old',
        requestedAt: new Date('2026-10-01T10:00:00.000Z'),
      }),
    );
    await repository.transition('tr_old', 'rejected');
    await repository.create(
      pendingTransfer({
        transfer_id: 'tr_new',
        requestedAt: new Date('2026-10-05T10:00:00.000Z'),
      }),
    );

    const pending = await repository.listPending();
    // The rejected row is not the queue; the pending one
    // is, newest first.
    expect(pending.map((request) => request.transfer_id)).toEqual([
      'tr_new',
    ]);
  });

  it('lists only the pending requests whose TTL has expired', async () => {
    const mongo = fakeMongo();
    const repository = new TransferRequestRepository(mongo);

    const now = new Date('2026-10-10T10:00:00.000Z');
    await repository.create(
      pendingTransfer({
        transfer_id: 'tr_expired',
        // Requested 2026-10-01, expires 2026-10-08 —
        // past the "now" of 2026-10-10.
        expiresAt: new Date('2026-10-08T10:00:00.000Z'),
      }),
    );
    await repository.create(
      pendingTransfer({
        transfer_id: 'tr_live',
        // Expires 2026-10-20 — still live at the "now".
        expiresAt: new Date('2026-10-20T10:00:00.000Z'),
      }),
    );

    const expired = await repository.listExpired(now);
    expect(expired.map((request) => request.transfer_id)).toEqual([
      'tr_expired',
    ]);
  });

  it('transitions a transfer to a terminal state, stamping resolvedAt', async () => {
    const mongo = fakeMongo();
    const repository = new TransferRequestRepository(mongo);

    await repository.create(pendingTransfer());

    const before = new Date('2026-10-02T10:00:00.000Z');
    const updated = await repository.transition(
      'tr_0001',
      'approved',
      { resolvedAt: before },
    );
    expect(updated).toMatchObject({
      transfer_id: 'tr_0001',
      state: 'approved',
      resolvedAt: before,
    });

    // A missing transfer transitions to nothing.
    expect(
      await repository.transition('tr_missing', 'rejected'),
    ).toBeNull();
  });
});
