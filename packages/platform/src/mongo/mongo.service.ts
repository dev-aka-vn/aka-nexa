import { Db, MongoClient, type MongoClientOptions } from 'mongodb';

/**
 * ## Why the native driver and not Mongoose
 *
 * Mongoose's value is a compile-time `Schema` plus document middleware over a
 * *statically known* model. This product stores per-app runtime-defined
 * collections — App Builder authors declare their fields at runtime, up to 200
 * apps × 20 forms (NFR-S-6/S-7) — so there is no static model to compile and
 * Mongoose would capture none of its benefits while adding a second
 * serialisation layer between the store and the wire. One data-access style
 * everywhere is worth more than the middleware. The `mongodb` driver is also
 * traced by `instrumentation-mongodb` (bundled in
 * `auto-instrumentations-node`) exactly as it traces Mongoose, so dropping it
 * costs NFR-O-2 nothing.
 *
 * The boundary rule enforces the same rule statically: R3 in
 * `tooling/boundaries.config.mjs` allows the `mongodb` specifier only under
 * `packages/platform/src/mongo/**` and `packages/domain/src/**\/data-access/**`.
 *
 * ## Why nothing connects in the constructor
 *
 * Nest constructs providers while compiling a module, and a module is compiled
 * long before anything is ready to serve. Opening a socket there would mean a
 * unit test that merely imports `MongoModule` needs a live MongoDB, and a
 * production boot would fail on a slow dependency before it had finished
 * wiring. The driver connects on first operation instead, which is also what
 * lets `ping()` be the *only* thing readiness needs.
 *
 * ## Why `serverSelectionTimeoutMS` is bounded and small
 *
 * The default is 30 seconds. A readiness probe that hangs for 30 seconds is
 * worse than one that fails: the orchestrator's own probe timeout usually
 * expires first, so the process is reported as "unresponsive" rather than
 * "not ready", and an operator loses the one piece of information the
 * per-dependency design exists to give them. Three seconds is comfortably
 * longer than a healthy `ping` round-trip and short enough to be reported
 * inside a typical 5–10 s probe budget.
 */
export const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 3_000;

/** The database used when the connection URL carries no path. */
export const DEFAULT_DATABASE = 'akane';

export interface MongoServiceOptions {
  /**
   * How long the driver hunts for a reachable server before giving up. Bounded
   * so readiness fails fast and names the dependency instead of timing out.
   */
  readonly serverSelectionTimeoutMS?: number;
  readonly defaultDb?: string;
}

/** The database name in a `mongodb://` URL path, or `undefined` if there is none. */
function databaseFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname.replace(/^\//, '');
    return path === '' ? undefined : decodeURIComponent(path);
  } catch {
    // A malformed URL is the driver's problem to report, with its own message.
    // Guessing a database name here would replace a precise error with a
    // silent default.
    return undefined;
  }
}

export class MongoService {
  /** The raw driver client, exposed so repositories can reach driver features
   *  (sessions, transactions, change streams) the service does not wrap. */
  readonly client: MongoClient;

  readonly #defaultDb: string;
  #closed = false;

  constructor(url: string, options: MongoServiceOptions = {}) {
    const driverOptions: MongoClientOptions = {
      serverSelectionTimeoutMS:
        options.serverSelectionTimeoutMS ?? DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
    };
    this.client = new MongoClient(url, driverOptions);
    this.#defaultDb = options.defaultDb ?? databaseFromUrl(url) ?? DEFAULT_DATABASE;
  }

  /** The database a repository gets when it does not name one. */
  get defaultDb(): string {
    return this.#defaultDb;
  }

  /**
   * A `Db` handle. Synchronous by design — the driver connects on the first
   * operation, so naming a database is not an I/O event and callers that never
   * touch it never open a socket.
   */
  db(name: string = this.#defaultDb): Db {
    return this.client.db(name);
  }

  /**
   * Liveness signal for the readiness indicator.
   *
   * `{ ping: 1 }` against `admin` is the driver's own documented no-op: it
   * reaches the server and back, so it fails when the deployment is unreachable
   * or the primary is gone, and it is cheap enough to run on every probe.
   *
   * Rejects rather than hanging once the server stops, bounded by
   * `serverSelectionTimeoutMS`.
   */
  async ping(): Promise<void> {
    if (this.#closed) {
      throw new Error('MONGO_CLIENT_CLOSED: ping() on a destroyed MongoService');
    }
    await this.client.db('admin').command({ ping: 1 });
  }

  /**
   * D-09 requires `app.enableShutdownHooks()` on all three entrypoints, so
   * SIGTERM reaches here and the driver's sockets are closed before the process
   * exits — a zero-downtime rolling deploy should drain connections, not have
   * them severed.
   */
  async onModuleDestroy(): Promise<void> {
    this.#closed = true;
    await this.client.close();
  }
}
