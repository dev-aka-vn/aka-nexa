# aka-nexa

Nexa — Where chat meets systems.

An IM-driven app builder and integration gateway. Employees ask for something in chat, a
permission-first pipeline resolves their identity and picks the right app, and the reply carries a
signed link to a form whose submission is routed into the internal systems behind it.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | **24.x LTS** | The pinned runtime, and `engines.node` in the manifest is `>=24 <25`. npm **warns** on anything else rather than refusing it: you get an `EBADENGINE` warning, not a failed install, because nothing in this repository sets `engine-strict`. Your own `~/.npmrc` or global npm config can widen that into a hard failure — this claim is about what *this repository* configures. Separately, and for a different reason, TypeScript is pinned to exactly 6.0.3 because `typescript-eslint` declares a hard peer range below 6.1; that pin is about the compiler, not the Node version. |
| npm | ships with Node 24 | npm workspaces; no other package manager. |
| Docker | any recent version | MongoDB and Redis for the local stack (`compose.dev.yml`), and for the test suite. |
| Git | any | — |

`.nvmrc` contains `24`. `npm ci` is the install — the lockfile is committed and is what makes the
install reproducible (FND-02), so `npm install` is not a substitute.

## Running the three processes

The platform is three independently runnable Node processes: an HTTP API, a queue worker, and a
scheduler. Each is started by its own npm script, and **`SERVICE_NAME` is not set by any of those
scripts** — it is set inline on the command, because it is what identifies which process is booting
and what port it defaults to.

```sh
SERVICE_NAME=api        npm run start:api        # HTTP API          — http://127.0.0.1:3000
SERVICE_NAME=worker     npm run start:worker     # queue consumer     — http://127.0.0.1:3001
SERVICE_NAME=scheduler  npm run start:scheduler  # job scheduler      — http://127.0.0.1:3002
```

All three can run at once; they share no in-process state. Every process answers two health
endpoints:

| Endpoint | Meaning |
|---|---|
| `GET /health/live` | Liveness. Reads no dependency. A blip in a dependency must never restart an otherwise healthy process. |
| `GET /health/ready` | Readiness. Names MongoDB, the cache Redis and the queue Redis **separately**, so a degraded dependency is identified rather than collapsed into one boolean. |

```sh
curl -s http://127.0.0.1:3000/health/live    # {"status":"ok"}
curl -s http://127.0.0.1:3000/health/ready   # every dependency up, each named
```

`PORT` overrides the per-process default. If a process dies immediately after printing
`Nest application successfully started`, see the port trap in [Two traps](#two-traps).

## Configuration

**The boot contract is validated at startup by Zod, and a missing or malformed value fails the boot
with a named error rather than a default.** `.env.example` is that contract written down: every key
the schema declares, with the local development values filled in.

⚠️ **The sourcing line below rewrites `NODE_ENV`, and that is the variable the crypto guard keys
on.** `.env.example` carries an **active** `NODE_ENV=development`, and `set -a; . ./.env.example`
assigns every active line — so it overwrites a `NODE_ENV=production` you had already exported, in
the shell you keep using, without printing anything. A plaintext local key is permitted only while
the environment reads `NODE_ENV=development or test`; anything else is refused with
`CRYPTO_KEY_PROVIDER_REQUIRED:`. Source the file and then re-export `NODE_ENV` yourself, or set
only the two variables you actually need inline instead of sourcing the whole file.

```sh
# Adopt the documented development values in this shell:
set -a; . ./.env.example; set +a

# Provision the local key file once per checkout (32 raw bytes; the path, never the key):
head -c 32 /dev/urandom > .dev-local-key
```

### The application does not load a `.env` file

This is worth stating plainly because it is the opposite of what most Node projects do, and
`ConfigModule.forRoot()` is the API people reach for by habit.

**Configuration is read from the process environment only.** `packages/platform/src/config/config.module.ts`
builds its `ConfigService` in a `useFactory` over the live `process.env`, and nothing in this
repository reads a `.env` file from the working directory. A `.env` sitting next to your shell is
ignored — so `cp .env.example .env` does **not** configure anything, and a deployment supplies its
configuration through the environment, which is what an orchestrator does.

The dropped `.env` loader is deliberate rather than missing: a configuration file that carries
credentials on disk is a thing to avoid (NFR-SEC-3, D-15/D-17), and with a single deployment model
nothing in the repository needed the capability. `useFactory` is also what makes the validation
happen at **boot** rather than at module-import time — `forRoot()` snapshots the environment when it
is called, and Nest evaluates a decorator's arguments at import.

Every failure is greppable and names the offending key:

| Token | Meaning |
|---|---|
| `CONFIG_INVALID: <KEY> <code>` | Missing or malformed value. The process aborts before it serves anything. `<KEY>` is the dotted path to the offending value, or the literal `<root>` when the rule is about the configuration as a whole rather than about one key. |
| `CONFIG_INVALID: <root> REDIS_INSTANCES_NOT_DISTINCT` | The two Redis URLs name one instance. They must be two — see below. |
| `CRYPTO_KEY_PROVIDER_REQUIRED:` | A local key outside `NODE_ENV=development or test`, with no explicit operator opt-in. Refused before the key file is read. Two distinct messages share this token — a production boot gets its own wording — and they are not interchangeable. |
| `KMS_PROVIDER_BLOCKED:` | The KMS provider is selected and has no adapter yet. Named failure, on purpose. |
| `LOCAL_KEY_FILE_MISSING:` | The **variable** `CRYPTO_LOCAL_KEY_FILE` is unset or empty. This is about the variable, never about the file. |
| `ENOENT: no such file or directory, open '<path>'` | The variable is set and the **file** it names is not there — the normal state of a fresh checkout. A raw filesystem error from the key read, with nothing caught in front of it. Run the `head -c 32 /dev/urandom > .dev-local-key` recipe above; grepping for `LOCAL_KEY_FILE_MISSING:` after an `ENOENT` finds nothing, because the system never printed it. |
| `READ_LINK_CONFIG_INVALID: must set <KEYS>` | The api's read-link verification config is incomplete; `<KEYS>` names the absent ones. Not carried by `.env.example` — see [Read-link verification](#read-link-verification-the-apis-second-key) below for why. |

### Two Redis deployments, not one

`REDIS_CACHE_URL` and `REDIS_QUEUE_URL` must name **two different instances**, and the boot refuses
if they do not. `maxmemory-policy` is instance-wide, so a logical-database suffix (`/0` vs `/1`) on a
single Redis cannot express the split: the cache tier wants to evict under pressure, and the queue
tier must never evict because a lost job is lost work. Two URLs on one host are fine as long as the
ports differ, which is what the local stack does.

### The local key file

`CRYPTO_LOCAL_KEY_FILE` names a file holding exactly 32 raw bytes of key material. It is a **path**,
never a key value — a key in an environment variable is a key in the process table, in the crash
dump, and in every CI log that echoes its environment. `.dev-local-key` is gitignored, so following
the recipe above cannot commit a plaintext key.

Two failures, and their tokens are not interchangeable. If the **variable** is unset or empty you get
the named `LOCAL_KEY_FILE_MISSING:`. If the **file** it names is not there — the normal state of a
fresh checkout, because `.dev-local-key` is gitignored — you get a raw
`ENOENT: no such file or directory, open './.dev-local-key'` and nothing in front of it, so run the
recipe above.

`CRYPTO_KEY_PROVIDER=local` is development-only, and the gate is `NODE_ENV` rather than the provider
line: a plaintext local key is permitted only while the environment reads
`NODE_ENV=development or test`, and anything else is refused with
`CRYPTO_KEY_PROVIDER_REQUIRED:` before the key file is opened. That is what makes the sourcing recipe
above a warning rather than a convenience — it is the line that sets the switch.
`CRYPTO_KEY_PROVIDER=kms` is refused with `KMS_PROVIDER_BLOCKED:` until a deployment cloud is named.
Both are the guards working.

### Read-link verification (the api's second key)

The `api` verifies the signed read link a user is handed from chat, and that verification needs its
own key — separate from the envelope key above, because it is a **public** key that checks a signature
rather than a secret key that decrypts. Four variables are required at boot:

| Variable | What it is |
|---|---|
| `JWT_ISSUER` | The deployment id the link was minted under (D-21). |
| `JWT_AUDIENCE` | The form-renderer origin. The renderer is a static web app, so a link's audience is an origin rather than an API. |
| `JWT_READ_PUBLIC_KEY` | The P-256 public key a link's signature is verified against. |
| `RENDERER_ORIGIN` | The renderer's origin, used to build links and check that the audience matches. |

These are **not** in `.env.example`, and that is deliberate rather than an oversight: every active
line there is a shell assignment of the form `KEY=value` with no whitespace in the value, and a PEM
cannot satisfy that — its header line contains a space, and the key is multi-line even when its
newlines are written escaped. So the file a reader can `source` and the file that can carry a public
key are not the same file, and this section is the one that carries it.

Generate a development pair once per checkout. Signing is a tracer stand-in today — the issuer
returns a deterministic path and does not sign yet — so only the public half is read; generating the
pair now means the real issuer can adopt it without a config change.

```sh
# A P-256 pair — the verifier's algorithm allowlist is ES256.
openssl ecparam -name prime256v1 -genkey -noout -out read-link.pem
openssl ec -in read-link.pem -pubout -out read-link.pub.pem

# Export the public half, plus the three non-key values:
export JWT_READ_PUBLIC_KEY="$(cat read-link.pub.pem)"
export JWT_ISSUER=akane-local
export JWT_AUDIENCE=http://localhost:5173
export RENDERER_ORIGIN=http://localhost:5173
```

`JWT_READ_PUBLIC_KEY` accepts the PEM either as a real multi-line value or as one line with its
newlines written `\n` — the module expands the escapes once, before the key is parsed — because an
orchestrator commonly hands a value to a process as a single line.

A boot missing any of the four is refused with `READ_LINK_CONFIG_INVALID: must set …`, naming the
ones it is missing, rather than starting cleanly and failing on the first link it tries to verify.
The keys are read straight from the environment, not declared as schema fields, so a deployment that
sets a differently-named variable gets that refusal rather than a silent default.

During the 90-day rotation window (LNK-12) a second key, `JWT_READ_PUBLIC_KEY_PREVIOUS`, is accepted
as well. It is optional: omit it entirely outside a rotation, because an empty value trips the same
`must set` refusal as an absent one.

### Builder SSO authentication (BLD-12, D-101…D-104, IDN-08)

The self-service App Builder authenticates department admins against the enterprise
identity provider over OIDC. Four variables are required at boot, read straight from
the environment like the read-link config (not declared as schema fields, so a
differently-named variable gets a named refusal rather than a silent default):

| Variable | What it is |
|---|---|
| `OIDC_ISSUER` | The corporate IdP's issuer URL. Discovery is fetched once at module init from `<OIDC_ISSUER>/.well-known/openid-configuration` (T-06-09: a slow IdP degrades login latency, not security). |
| `OIDC_CLIENT_ID` | The builder's client registration at the IdP. |
| `OIDC_CLIENT_SECRET` | The client secret. |
| `OIDC_REDIRECT_URI` | The callback the `api` serves (`https://<api-host>/auth/oidc/callback`). |

A boot missing any of the four refuses to start with `OIDC_CONFIG_INVALID: must set …`,
naming the absent ones. In non-production the issuer may be `http://` (the integration
specs run an in-spec stub issuer on loopback); a production boot against an `http://`
issuer still fails discovery.

**The login flow** (`GET /auth/oidc/begin` → IdP → `GET /auth/oidc/callback`):

1. `begin` generates a PKCE S256 pair and stashes the `code_verifier` and `state`
   **server-side** in a pre-login Redis session (120 s, the authorization-code
   exchange window) — the browser carries only the opaque session id.
2. `callback` verifies the returned `state` against the stash **before** any network
   call (T-06-05), exchanges the code with the stashed verifier, and gates the
   login on the ID token's `acr`/`amr` claims (D-102): only the values in
   `ACCEPTABLE_ACR_VALUES` (`mfa`, `phr` — the Keycloak-style pair; the enterprise
   IdP's actual values are the S3 open question, and this one constant is the
   single place to change them) count as MFA-strong. A password-only login answers
   `403 AUTH_MFA_REQUIRED`.
3. First login auto-provisions the `real_user` (D-104) — no admin pre-mapping step.

**The session** (D-101): the authenticated session is an opaque Redis record
(`ak:sess:<uuid>`), delivered as an httpOnly, Secure, SameSite=Strict
`__Host-akane_sid` cookie — never a JWT, never readable by the SPA (T-06-07), and
the OIDC subject lives only in the server-side record (the PII-in-JWT constraint:
nothing of it is ever minted into our own tokens). The session middleware guards
every builder route except the two login routes:

- **CSRF** (T-06-04): SameSite=Strict is the structural layer; the second layer
  refuses a state-changing call (POST/PUT/PATCH/DELETE) whose `Origin` is absent
  or cross-origin with `403 CSRF_ORIGIN_MISMATCH`.
- **Lifetime** (D-103): the IdP session is the only TTL input — there is no second,
  independently-configured expiry. A session whose `idpSessionExp` has passed
  answers `401 SESSION_EXPIRED`; inside the renewal window (less than half the
  IdP session lifetime remaining) the server-stored refresh token is exchanged and
  the Redis TTL extended to the refreshed IdP lifetime. When the IdP session has
  ended, a full re-login is forced.
- **Logout** (`POST /auth/logout`): destroys the Redis record and clears the cookie
  (`Max-Age=0`, same five attributes).

**The Users page's identity surface** (IDN-08, D-110): `POST /users/sso-mappings`
maps an OIDC subject to an existing `real_user_id` with **no OTP** — the admin's
global-admin session is the proof (deliberately separate from the employee OTP
self-onboarding route, IDN-05). A non-global-admin answers `403 GLOBAL_ADMIN_REQUIRED`;
a mapping to an unknown `real_user_id` answers a field-naming inline error
(`REAL_USER_UNKNOWN`, field `realUserId`). `GET /users/sso-mappings?email=…` lists
the mappings carrying that email (the IDN-07 search shape). Both endpoints are
global-admin-only.

## Local infrastructure

`compose.dev.yml` starts the three data services the platform needs. It is a development convenience,
not a deployment topology — see [Deployment](#deployment).

```sh
docker compose -f compose.dev.yml up -d          # start
docker compose -f compose.dev.yml down -v        # stop, discarding the volumes
```

| Service | Image | Host address | `maxmemory-policy` |
|---|---|---|---|
| `mongo` | `mongo:8.0` | `127.0.0.1:27017` | — |
| `redis-cache` | `redis:8.10-alpine` | `127.0.0.1:6379` | `allkeys-lru` |
| `redis-queue` | `redis:8.10-alpine` | `127.0.0.1:6380` | `noeviction` |

Every published port binds to `127.0.0.1`, not `0.0.0.0`, so nothing here is reachable from the local
network. The two Redis containers are two separate deployments because `maxmemory-policy` is
instance-wide: the cache tier is allowed to evict, the queue tier is not.

**These addresses are already the ones in `.env.example`.** Bring the stack up, source the file, and
the boot needs no editing at all — but re-export `NODE_ENV` after sourcing, for the reason given
under [Configuration](#configuration): the recipe assigns `.env.example`'s active
`NODE_ENV=development` over whatever your shell had set.

```sh
docker compose -f compose.dev.yml up -d
set -a; . ./.env.example; set +a
head -c 32 /dev/urandom > .dev-local-key
SERVICE_NAME=api npm run start:api
```

MongoDB is deliberately started **without** `--replSet`; see trap B for why that matters.

## Two traps

Both of these cost real time during UAT, and both fail in a way that points somewhere other than the
cause. They are also covered by executable tests in `tooling/onboarding.spec.ts`, so the remedies
below are proven rather than merely written down.

### Trap A — port collision, and the "successfully started" lie

The default api port is 3000, and on a developer machine that port is often already taken. The
failure is reported in the least useful way possible:

```
Nest application successfully started     ← the last line a reader sees
...
Error: listen EADDRINUSE: address already in use :::3000
```

**Nest logs `successfully started` before it binds the port.** That message means the module graph
initialised, not that the process is alive — the bind happens immediately afterwards and a bare
`EADDRINUSE` kills it. So check the **exit code**, not the log: a process that printed the success
line and then exited has just lost the port race. (The address is `:::3000` rather than
`0.0.0.0:3000` because `app.listen` is called with no host, so Node binds the IPv6 wildcard. The
executable test above asserts the README's rendering against what Node actually printed, so the two
cannot drift apart.)

**Who is holding the port?** A container's published port is held by a root-owned `docker-proxy`, so
`ss` and `lsof` will tell you nothing about it unless you are root:

```sh
docker ps --filter publish=3000 --format '{{.Names}}'   # empty ⇒ no container publishes 3000
```

When that prints nothing, the holder is **not identifiable from your own account** — either no
container publishes it and it is a plain process you own (`ss -ltnp | grep 3000` will name that one),
or the port is held by something this account cannot enumerate. The onboarding spec uses exactly this
command, and it runs **after** a bind it wanted has already failed: it identifies the holder of a port
it could not take, and it does **not** stop a collision from happening.

**Fix:** give the process a free port.

```sh
PORT=3100 SERVICE_NAME=api npm run start:api
```

### Trap B — a healthy MongoDB reported as `mongo: down`

Point `MONGO_URL` at a MongoDB that was started with `--replSet` — including a MongoDB started by
testcontainers, which always is — and a plain URL fails:

```
MONGO_URL=mongodb://127.0.0.1:27017/akane
curl http://127.0.0.1:3000/health/ready
{"status":"error","error":{"mongo":{"status":"down"}}}
```

MongoDB is running. Nothing is wrong with it. The server advertises itself as a replica-set member
using its **container hostname**, the driver performs topology discovery, believes the advertisement,
and then tries to resolve a name that only exists inside the container's network — so every `ping()`
fails while the server is perfectly healthy. The symptom is a readiness probe, and the cause is a
URL.

**Fix:** add `directConnection=true`, which tells the driver to use the seed address and ignore the
advertised member list. That is the correct mode for a single node reached through a published port:

```sh
MONGO_URL='mongodb://127.0.0.1:27017/akane?directConnection=true'
```

`compose.dev.yml` deliberately runs MongoDB **without** `--replSet`, so this trap does not fire in the
default local setup and `.env.example`'s `MONGO_URL` correctly carries no such parameter. You need it
when you point `MONGO_URL` at an external or testcontainers MongoDB.

## Deployment

Out of scope for this repository: there are no Kubernetes manifests, no Helm chart, and no image
build. This is a **local development** convenience and nothing more — `compose.dev.yml` publishes
everything on loopback for a developer laptop, and its shape (one Mongo, two Redis, no
authentication, no replicas) is not a deployment topology. See [Local
infrastructure](#local-infrastructure) for what it actually starts.