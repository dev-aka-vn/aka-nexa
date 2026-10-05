# Product Requirements Document (PRD)

## IM-Driven App Builder & Integration Gateway

| Field | Value |
|---|---|
| **Version** | 2.0 (Complete) |
| **Status** | In Review |
| **Owner** | [TBD] |
| **Last Updated** | 2026-09-30 |
| **Classification** | Internal |

---

## Table of Contents

1. Executive Summary
2. Problem Statement
3. Vision & Guiding Principles
4. Goals & Non-Goals
5. Target Users & Personas
6. Core Concepts & Terminology
7. System Architecture
8. Functional Requirements
9. Non-Functional Requirements
10. Data Models
11. JEV-Compatible Specification
12. User Flows
13. API Design Principles
14. App Builder UI Requirements
15. Security & Compliance
16. Observability & Operations
17. Testing Strategy
18. Deployment & Infrastructure
19. Migration & Onboarding
20. MVP Roadmap
21. Success Metrics & KPIs
22. Risk Assessment & Mitigation
23. Open Questions
24. Glossary
25. Appendices

---

## 1. Executive Summary

This document specifies the requirements for an **IM-Driven App Builder & Integration Gateway** — a platform that transforms existing enterprise Instant Messaging (IM) systems (Telegram, Slack, Microsoft Teams, Zalo) into the primary interface for interacting with internal and external enterprise systems, without requiring end users to learn or authenticate against those systems directly.

The platform's core value proposition is **not** the chatbot. It is the combination of:

- **Form (FormIO.js)** — the universal, schema-driven data-entry layer.
- **Integration / Data Layer** — routing submissions to internal document storage or external systems (Redmine, HR APIs, ERP, ticketing, etc.).
- **App Builder** — a self-service UI enabling non-developers to compose workflows.

Together, these form the **App Builder**, the true heart of the system.

Users interact through chat (natural language or slash commands). A **permission-first routing pipeline** resolves identity, checks RBAC, filters available tools, and calls a **JEV-compatible decision model** to select the correct app. The user receives a signed link to a form, submits data, and the platform routes it internally, externally, or both.

---

## 2. Problem Statement

Enterprises run dozens of internal systems (Redmine, Jira, HR portals, ticketing, procurement, asset management). Each has its own UI, authentication model, and learning curve. Onboarding every employee to every system is expensive, slow, and error-prone. Departments often build shadow processes (email chains, spreadsheets, shared drives) to avoid the friction of learning yet another tool.

**There is no unified, low-friction layer that:**

- Lets users perform cross-system actions in plain chat.
- Enforces per-department, per-app RBAC with real-user granularity.
- Routes structured data to the correct downstream system (internal DB or external API).
- Provides auditability and traceability without exposing backend system credentials or UIs.
- Enables department admins to build and maintain their own mini-applications without engineering involvement.

The result is duplicated effort, inconsistent data, poor audit trails, and low adoption of enterprise tools.

---

## 3. Vision & Guiding Principles

### 3.1. Vision Statement

> *"Chat is the entry point. Form is the interface. Integration is the product."*

Employees should be able to complete cross-system tasks (create a ticket, request leave, file a report, query records) entirely through IM + a single rendered form, without ever logging into the downstream system. Each department builds and owns its own apps, with its own roles, forms, and data destinations.

### 3.2. Guiding Principles

| # | Principle | Implication |
|---|---|---|
| P1 | **Permission-first** | No tool is ever exposed to a user who lacks the right. RBAC is checked before any decision engine call. |
| P2 | **Form as universal interface** | All data entry goes through FormIO.js. No IM-native forms, no custom HTML. |
| P3 | **Integration, not replacement** | We never become the system of record for downstream data. We route, we don't own. |
| P4 | **Self-service for departments** | App Owners and Admins can build, configure, and publish without engineering tickets. |
| P5 | **Traceability by design** | Every action maps to a `real_user_id` and a `submission_id`. No anonymous writes. |
| P6 | **Provider-agnostic decisions** | The JEV layer is swappable. No lock-in to a single AI/decision vendor. |
| P7 | **Defense in depth** | Permissions are checked at multiple layers. A single misconfiguration cannot expose unauthorized actions. |
| P8 | **Graceful degradation** | If JEV is down, rule-based fallback activates. If external APIs fail, internal writes still succeed. |

---

## 4. Goals & Non-Goals

### 4.1. Goals

| # | Goal |
|---|---|
| G1 | Provide a chat-first entry point for enterprise workflows across multiple IM platforms. |
| G2 | Deliver a self-service App Builder for non-developers (department admins) with full CRUD, RBAC, form design, and routing configuration. |
| G3 | Enforce per-app RBAC scoped exclusively to real users (no group-based permissions in v1). |
| G4 | Support internal document storage (MongoDB), external API integration (connectors), and hybrid modes. |
| G5 | Guarantee traceability: every action maps to a real user, regardless of downstream authentication model. |
| G6 | Abstract the decision engine behind a JEV-compatible interface with pluggable providers and fallback chains. |
| G7 | Support 1,000 concurrent users across multiple apps and IM platforms with defined SLA targets. |
| G8 | Provide strong security: one-time tokens for writes, signed deep links for reads, permission versioning, encrypted secrets. |
| G9 | Enable cross-app data sharing with explicit, audited grants. |
| G10 | Provide comprehensive observability: distributed tracing, metrics, alerting, and audit logging. |

### 4.2. Non-Goals

| # | Non-Goal | Rationale |
|---|---|---|
| NG1 | Building a general-purpose conversational AI assistant. | Scope is task-oriented, not open-ended chat. |
| NG2 | Replacing downstream systems (Redmine, HR, ERP) as system of record. | We route data; we don't own it. |
| NG3 | Native IM form rendering (adaptive cards, block kits). | We always use FormIO.js for consistency. |
| NG4 | Real-time collaboration on forms (multi-user editing). | Out of scope for v1. |
| NG5 | Full workflow engine (multi-step BPMN, approval chains with branching). | Single-step submissions only in v1. |
| NG6 | Mobile-native applications. | Responsive web rendering is sufficient. |
| NG7 | Offline mode or local data caching on client. | Requires network connectivity. |
| NG8 | Multi-tenancy across separate organizations. | Single enterprise deployment in v1. |

---

## 5. Target Users & Personas

| Persona | Description | Primary Needs | Key Interactions |
|---|---|---|---|
| **End User** | Any employee using IM daily | Fast, low-friction task completion; no new logins; clear status feedback | Send message → receive link → fill form → get confirmation |
| **App Owner** | Department lead accountable for an app | Full control over app lifecycle, RBAC, data retention, connector selection | App Builder UI, ownership transfer, deprecation decisions |
| **App Admin / Manager** | Delegated operator within a department | Manage RBAC assignments, view all submissions, publish/unpublish, configure forms | App Builder UI (scoped), submission viewer |
| **Global Admin** | Platform operator / IT admin | Manage connectors, approve ownership transfers, audit logs, system health | Admin dashboard, connector management, audit viewer |
| **Developer** | Builds new connectors, JEV providers, or platform extensions | Stable interfaces, clear contracts, SDK/documentation, test harness | CLI, API docs, connector SDK |
| **Auditor / Compliance** | Reviews access logs, data flows, retention | Immutable audit trail, exportable logs, retention proof | Read-only audit dashboard, export tools |

---

## 6. Core Concepts & Terminology

### 6.1. App

An **App** is a self-contained mini-tenant representing a single business function. It encapsulates:

- **Triggers**: Intents (natural language) and/or slash commands that activate the app.
- **RBAC**: Roles, permissions, and user assignments scoped to this app only.
- **Forms**: One or more FormIO.js schemas (versioned) for data entry.
- **Data Routing Config**: Internal (MongoDB), external (connector), or hybrid.
- **Lifecycle State**: `draft` → `published` → `deprecated` → `archived` → `purged`.
- **Retention Policy**: How long data is kept and how it is disposed of.

### 6.2. Real User vs. Chat User

| Concept | Definition | Identifier |
|---|---|---|
| **Chat User** | The identity as seen by the IM platform | `chat_user_id` (e.g., Slack `U12345`, Teams AAD ID) |
| **Real User** | The canonical platform identity | `real_user_id` (UUID, platform-generated) |

- Mapping is resolved at the start of every request and cached in Redis.
- One Real User may have multiple Chat User identities (e.g., Slack + Teams).
- RBAC is **always** scoped to `real_user_id`. Groups, attributes, and IM-side roles are **not** used in v1.

### 6.3. Tool

A **Tool** is an executable action exposed by an App. Format: `{app_id}:{action}` (e.g., `ticket-create:create_ticket`, `hr-leave:request_leave`). Tools are filtered by permission before being sent to the JEV decision engine.

### 6.4. Submission

An **immutable** record of a form submission. Contains:
- `submission_id` (UUID, serves as the global trace ID)
- User identity (`real_user_id`, `chat_user_id`, `im`)
- Form reference and version
- Submitted data (JSON)
- Destination references (internal and/or external)
- Timestamps and status

### 6.5. Connector

A **reusable integration instance** (e.g., `redmine-prod`, `hr-api-v2`) with:
- Shared authentication credentials (encrypted)
- Rate limiting configuration
- Retry and backoff policy
- Health check endpoint

Apps **reference** connectors; they do not own credentials. Connectors are managed by Global Admins.

### 6.6. Link Types

| Type | Purpose | Token Mechanism | TTL | Consumption |
|---|---|---|---|---|
| **Create Link** | Open a blank form for new submission | One-time JWT + Redis | 30 min (configurable) | Consumed atomically on submit |
| **Edit Link** | Open a pre-filled form for editing | One-time JWT + Redis | 4 hours (configurable) | Consumed on submit; loadable multiple times before submit |
| **View Link** | Display a read-only record | Signed deep link (no Redis) | Up to 90 days | Fresh permission check on every access |
| **Query Link** | Execute a saved query and display results | Signed deep link (no Redis) | Up to 90 days | Fresh permission + query execution on access |
| **Notification Link** | Deep link from inbound webhook | Signed, bound to original submitter | Configurable | Single-use or multi-use per config |

### 6.7. Permission Version (`perm_version`)

A monotonically increasing integer per user (or per user-per-app). Incremented whenever the user's permissions change. Read links embed the `perm_version` at issuance time; on access, the current version is compared. Mismatch → access denied.

---

## 7. System Architecture

### 7.1. High-Level Flow

```
[IM: Slack / Teams / Zalo / Telegram]
         │  message / slash command / button interaction
         ▼
 [IM Adapter Layer]                 — normalizes events to unified schema
         ▼
 [Rate Limiter]                     — per-user, per-IM throttling
         ▼
 [Identity Service]                 — chat_user_id → real_user_id (Redis cached)
         ▼
 [RBAC Aggregator]                  — resolves roles, permissions, tool set for user
         ▼
 [Tool Filter]                      — filters global tool list → user-authorized subset
         ▼
 [JEV Abstraction Layer]            — JEV-compatible decision call (filtered tools only)
         ▼
 [App Runtime]
    ├── App Registry                — loads app definition (versioned, cached)
    ├── Defense-in-depth RBAC       — re-checks permission at execution boundary
    ├── Link Service                — issues one-time or signed links
    └── Form Service                — FormIO.js schema retrieval + pre-fill
         ▼
 [Form Renderer: FormIO.js]         — responsive web UI (separate from IM)
         ▼
 [Submission Processor]
    ├── Validation                  — schema validation, business rules
    ├── Token Consumption           — atomic (Redis GETDEL / Lua script)
    └── Data Router
         ├── Internal → MongoDB collections (per app, declared indexes)
         ├── External → Connector Layer (shared auth, idempotent calls)
         └── Hybrid   → internal (sync) + external (async via BullMQ)
         ▼
 [Message Formatter]                — renders confirmation / error / status
         ▼
 [IM Adapter Layer]                 — sends response back to user's IM channel
```

### 7.2. Component Diagram (Logical)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        API Gateway / Load Balancer                   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       │                         │                         │
┌──────▼──────┐         ┌───────▼───────┐         ┌──────▼──────┐
│ IM Adapters │         │  Core API     │         │  Form       │
│ (Slack,     │         │  (NestJS)     │         │  Renderer   │
│  Teams,     │         │               │         │  (FormIO.js │
│  Zalo, TG)  │         │  - Identity   │         │   Web App)  │
│             │         │  - RBAC       │         │             │
│             │         │  - JEV        │         │             │
│             │         │  - App Runtime│         │             │
│             │         │  - Links      │         │             │
│             │         │  - Data Router│         │             │
└──────┬──────┘         └───────┬───────┘         └──────┬──────┘
       │                         │                         │
       │                ┌────────┼────────┐               │
       │                │        │        │               │
       │         ┌──────▼──┐ ┌───▼───┐ ┌──▼────┐         │
       │         │ MongoDB │ │ Redis │ │ BullMQ│         │
       │         │ (Data)  │ │(Cache,│ │(Async │         │
       │         │         │ │Tokens)│ │Queue) │         │
       │         └─────────┘ └───────┘ └───┬───┘         │
       │                                    │              │
       │                              ┌─────▼─────┐       │
       │                              │ Connector  │       │
       │                              │ Workers    │       │
       │                              │ (Redmine,  │       │
       │                              │  HR, ERP)  │       │
       │                              └────────────┘       │
       │                                                   │
       └───────────────────────────────────────────────────┘
```

### 7.3. Key Architectural Decisions

| # | Decision | Rationale |
|---|---|---|
| AD-1 | Permission-first routing (Identity → RBAC → Tool Filter → JEV) | Reduces JEV input space, improves accuracy, prevents exposure of unauthorized tools, reduces cost. |
| AD-2 | JEV-compatible specification | Swap providers without changing core logic. Enables fallback chains, A/B testing, conformance tests. |
| AD-3 | FormIO.js as sole form engine | One rendering engine for all apps. Consistent UX. No IM-native form fragmentation. Rich component library. |
| AD-4 | MongoDB as first-class internal destination | Internal storage is not a fallback; it's a primary mode. Schema-flexible, supports per-app collections. |
| AD-5 | Shared connector authentication | Similar to Redmine model: one service account, many projects. Reduces credential sprawl. |
| AD-6 | Per-app RBAC | Supports multi-department isolation. HR app permissions don't leak into IT ticketing. |
| AD-7 | Real-user-only RBAC (no groups in v1) | Simplifies assignment logic. No group sync complexity. Groups may be added in v2. |
| AD-8 | Atomic token consumption via Redis | Prevents double-submission. Race-condition safe. |
| AD-9 | Stateless application services | Horizontal scaling. Session state in Redis. No sticky sessions required. |
| AD-10 | BullMQ for async external calls | Decouples form submission latency from external API latency. Enables retries without user-facing delays. |
| AD-11 | Signed deep links for reads (no Redis) | Scales to millions of read links without Redis memory pressure. Fresh permission check compensates. |
| AD-12 | NestJS as application framework | TypeScript, modular, DI, built-in validation, OpenTelemetry support, strong ecosystem. |

### 7.4. Technology Stack

| Layer | Technology | Justification |
|---|---|---|
| Runtime | Node.js 20+ / NestJS 10+ | TypeScript, DI, modularity |
| Database | MongoDB 7+ | Flexible schema, per-app collections, change streams |
| Cache / Tokens | Redis 7+ (Cluster mode) | Sub-ms reads, atomic operations, pub/sub |
| Queue | BullMQ (Redis-backed) | Reliable async processing, retries, DLQ |
| Form Engine | FormIO.js (open-source) | Schema-driven, builder + renderer, extensive components |
| IM SDKs | Bolt (Slack), Bot Framework (Teams), Zalo OA API, Telegram Bot API | Official SDKs |
| Observability | OpenTelemetry + Prometheus + Grafana + Loki | Distributed tracing, metrics, logs |
| Secrets | HashiCorp Vault or AWS KMS / GCP KMS | Encrypted at rest, rotation support |
| Deployment | Docker + Kubernetes (or PM2 cluster for simpler setups) | Horizontal scaling, rolling updates |
| CI/CD | GitHub Actions / GitLab CI | Automated testing, deployment |

---

## 8. Functional Requirements

### 8.1. Identity & Mapping

| ID | Requirement | Priority |
|---|---|---|
| FR-I-1 | System MUST resolve `chat_user_id` → `real_user_id` on every inbound request. | P0 |
| FR-I-2 | Mapping MUST support **pre-provisioning** (CSV/bulk import by admin) and **lazy onboarding** (OTP verification via IM). | P0 |
| FR-I-3 | One real user MAY have multiple chat accounts across different IMs (e.g., Slack + Teams). | P0 |
| FR-I-4 | Mapping MUST be cached in Redis with configurable TTL (default: 1 hour). | P0 |
| FR-I-5 | Unmapped users MUST receive a friendly onboarding prompt with instructions, never a raw system error. | P0 |
| FR-I-6 | Mapping changes (create, update, deactivate) MUST invalidate Redis cache immediately via pub/sub. | P0 |
| FR-I-7 | System MUST support deactivation of a mapping (user leaves company) without deleting historical submissions. | P1 |
| FR-I-8 | OTP onboarding MUST expire after 10 minutes and allow max 3 attempts before lockout (30 min). | P0 |
| FR-I-9 | System MUST log all identity resolution events (success, failure, cache hit/miss). | P1 |
| FR-I-10 | Admin MUST be able to search mappings by email, `real_user_id`, or `chat_user_id`. | P1 |

### 8.2. RBAC (Per-App)

| ID | Requirement | Priority |
|---|---|---|
| FR-R-1 | Each app MUST define its own roles and permissions, independent of other apps. | P0 |
| FR-R-2 | Roles MUST be assignable only to `real_user_id`. No group-based assignment in v1. | P0 |
| FR-R-3 | System MUST provide default roles: `owner`, `admin`, `manager`, `user`. | P0 |
| FR-R-4 | Custom roles MUST be definable per app with arbitrary permission sets. | P1 |
| FR-R-5 | An app MUST have exactly one `owner` at all times. | P0 |
| FR-R-6 | Owner transfer MUST require global admin approval. Pending transfers auto-cancel after 7 days. | P0 |
| FR-R-7 | Permissions MUST be checked at **two points**: pre-JEV (tool filter) and pre-execution (defense-in-depth). | P0 |
| FR-R-8 | Permission changes MUST bump a per-user-per-app `perm_version` to invalidate outstanding read links. | P0 |
| FR-R-9 | RBAC resolution MUST be cached per user per app (Redis, TTL 5 min) with immediate invalidation on change. | P0 |
| FR-R-10 | System MUST support permission denials with clear, user-facing messages (not generic errors). | P1 |
| FR-R-11 | App Owner MUST be able to view all role assignments and modify them (except transferring ownership). | P0 |
| FR-R-12 | Bulk role assignment (CSV upload) MUST be supported for apps with >50 users. | P2 |

### 8.3. JEV Abstraction

| ID | Requirement | Priority |
|---|---|---|
| FR-J-1 | System MUST define a `JEV-compatible` specification (request/response schema, health endpoint, error codes). | P0 |
| FR-J-2 | Providers MUST be pluggable via a provider registry (configuration-driven, no code change to swap). | P0 |
| FR-J-3 | System MUST support a **fallback chain** (e.g., OpenJev → OpenAI-compatible → rule-based). | P0 |
| FR-J-4 | JEV calls MUST be cached by `hash(text + sorted(tool_ids) + locale)` with configurable TTL (default: 5 min). | P1 |
| FR-J-5 | Confidence threshold MUST be configurable per app. Below threshold → clarification prompt or fallback to rule-based. | P0 |
| FR-J-6 | JEV MUST receive **only** the filtered tool set for the requesting user, never the global tool list. | P0 |
| FR-J-7 | JEV request MUST include: user text, tool list (id + description), locale, conversation context (last N turns). | P0 |
| FR-J-8 | JEV response MUST include: selected tool ID, confidence score, alternatives (top 3), provider name, latency. | P0 |
| FR-J-9 | If JEV returns multiple high-confidence alternatives (within 10% of top), system MUST present disambiguation options to user. | P1 |
| FR-J-10 | JEV provider health MUST be checked every 60 seconds. Unhealthy providers are skipped in the chain. | P0 |
| FR-J-11 | System MUST support a "no-JEV" mode where slash commands bypass JEV entirely (deterministic routing). | P1 |

### 8.4. Form & App Builder

| ID | Requirement | Priority |
|---|---|---|
| FR-F-1 | All forms MUST use FormIO.js (both builder and renderer). No other form engine is permitted. | P0 |
| FR-F-2 | Forms MUST be versioned (incrementing integer). Submissions MUST store `form_version` at time of submission. | P0 |
| FR-F-3 | Form schemas MUST be stored as JSON documents in MongoDB. | P0 |
| FR-F-4 | App Builder UI MUST allow: app CRUD, RBAC management, form design (drag-and-drop), data routing configuration, trigger management. | P0 |
| FR-F-5 | App Builder MUST support lifecycle: `draft` → `published` → `deprecated` → `archived`. | P0 |
| FR-F-6 | App definitions MUST be versioned with rollback support (keep last 20 versions). | P1 |
| FR-F-7 | Pre-fill MUST be server-side, driven by `real_user` profile attributes (e.g., employee code, department). | P0 |
| FR-F-8 | Form Builder MUST support conditional logic (show/hide fields based on values). | P1 |
| FR-F-9 | Form Builder MUST support validation rules (required, pattern, min/max, custom JS). | P0 |
| FR-F-10 | Forms MUST support file upload components with configurable max size (default: 10MB) and allowed MIME types. | P1 |
| FR-F-11 | Form preview MUST be available in App Builder before publishing. | P0 |
| FR-F-12 | Published form changes MUST NOT affect in-progress submissions (version pinning at link creation). | P0 |
| FR-F-13 | Form Builder MUST support multi-language labels (i18n keys) if i18n is enabled. | P2 |
| FR-F-14 | Draft forms MUST NOT be accessible via any link or trigger. | P0 |

### 8.5. Link Lifecycle

| ID | Requirement | Priority |
|---|---|---|
| FR-L-1 | **Create links**: one-time use, TTL 30 min (configurable per app), consumed atomically on submit via Redis `GETDEL` or Lua script. | P0 |
| FR-L-2 | **Edit links**: one-time on submit, loadable multiple times before submit, TTL 4 hours (configurable). | P0 |
| FR-L-3 | **View links**: signed deep links (JWT), TTL up to 90 days, no Redis storage, fresh permission check on every access. | P0 |
| FR-L-4 | **Query links**: signed deep links, execute query fresh on every access, TTL up to 90 days. | P1 |
| FR-L-5 | **Notification links**: created by inbound webhook, bound to original submitter's `real_user_id`. | P1 |
| FR-L-6 | TTLs MUST be configurable per app (override platform defaults). | P1 |
| FR-L-7 | Read links (view/query) MUST validate `perm_version` on every access. Mismatch → 403 with re-authentication guidance. | P0 |
| FR-L-8 | All link accesses MUST be logged: `jti` (JWT ID), `real_user_id`, action, IP address, User-Agent, timestamp. | P0 |
| FR-L-9 | Expired links MUST return a clear "link expired" message with option to request a new one via IM. | P1 |
| FR-L-10 | Link URLs MUST be unguessable (UUID-based or signed token, no sequential IDs). | P0 |
| FR-L-11 | System MUST support optional short-URL wrapping for IM display (configurable). | P2 |

### 8.6. Data Routing

| ID | Requirement | Priority |
|---|---|---|
| FR-D-1 | Each app MUST select a data mode: `internal` \| `external` \| `hybrid`. | P0 |
| FR-D-2 | **Internal**: Write to one or more MongoDB collections defined by the app. Collections are auto-created on first write. | P0 |
| FR-D-3 | **External**: Call a referenced connector with field mapping. Mapping supports template syntax `{{form.field}}` and `{{real_user.attribute}}`. | P0 |
| FR-D-4 | **Hybrid**: Write internal (synchronous) + call external (asynchronous via BullMQ queue). Internal write MUST succeed for submission to be confirmed. | P0 |
| FR-D-5 | Internal collections MUST support declared indexes (defined in app config, created at publish time). | P0 |
| FR-D-6 | A Query DSL MUST be provided for reading internal data. Raw MongoDB queries MUST NOT be exposed to app builders. | P0 |
| FR-D-7 | Queries MUST auto-inject `real_user_id` filter unless the user holds `view_all` permission for that app. | P0 |
| FR-D-8 | Submissions in hybrid mode MUST store both `internal_ref` (MongoDB document ID) and `external_ref` (connector response ID) when both succeed. | P0 |
| FR-D-9 | If external call fails in hybrid mode, submission status MUST be `partial` and a retry MUST be queued. | P0 |
| FR-D-10 | Data Router MUST validate the submission against the form schema before routing. | P0 |
| FR-D-11 | Field mapping MUST support transformations: date format, string concatenation, lookup tables. | P1 |
| FR-D-12 | System MUST support "write-once" semantics: a `submission_id` cannot be routed twice to the same external system (idempotency). | P0 |

### 8.7. Cross-App Collection Sharing

| ID | Requirement | Priority |
|---|---|---|
| FR-X-1 | Apps MAY share their internal collections with other apps via explicit `shared_with` configuration. | P1 |
| FR-X-2 | Sharing MUST specify: grantee app ID, permission level (`read` \| `read_write`), and optional field-level filter (whitelist of fields). | P1 |
| FR-X-3 | Consumer apps MUST declare `external_collections` with alias and projected fields in their app definition. | P1 |
| FR-X-4 | Runtime access to shared collections MUST use the **consumer app's identity** and log `on_behalf_of: {real_user_id}` for the requesting user. | P1 |
| FR-X-5 | Circular references (App A shares to B, B shares to A) MUST be detected and rejected at publish time. | P1 |
| FR-X-6 | Share grants MUST be revocable by the owning app's owner or global admin. Revocation takes effect immediately. | P1 |
| FR-X-7 | Shared collection access MUST respect the consumer app's RBAC (user must have permission in the consumer app). | P1 |

### 8.8. Connectors

| ID | Requirement | Priority |
|---|---|---|
| FR-C-1 | Connectors MUST implement a common interface: `testConnection()`, `execute(operation, payload, context)`, `getCapabilities()`. | P0 |
| FR-C-2 | Connector instances MUST be managed globally by platform admins (not per-app). | P0 |
| FR-C-3 | Credentials MUST be encrypted at rest using AES-256-GCM with KMS-backed master keys. | P0 |
| FR-C-4 | Rate limits MUST be enforced per connector instance, shared across all apps referencing it. | P0 |
| FR-C-5 | External calls MUST be idempotent using `submission_id` as the idempotency key. | P0 |
| FR-C-6 | Failed calls MUST retry with exponential backoff (base: 2s, max: 5 retries), then route to Dead Letter Queue (DLQ). | P0 |
| FR-C-7 | Connector calls MUST be logged: `submission_id`, `real_user_id`, connector ID, operation, latency, HTTP status, response summary. | P0 |
| FR-C-8 | Connectors MUST support a `dry_run` mode for testing without side effects. | P1 |
| FR-C-9 | Connector health checks MUST run every 60 seconds. Unhealthy connectors trigger alerts. | P0 |
| FR-C-10 | Apps MUST NOT be able to create connectors; they can only reference existing ones. | P0 |
| FR-C-11 | Connector timeout MUST be configurable (default: 30s). | P1 |
| FR-C-12 | DLQ items MUST be viewable and manually retryable by global admins. | P1 |

### 8.9. Notification & Two-Way Sync

| ID | Requirement | Priority |
|---|---|---|
| FR-N-1 | System MUST accept inbound webhooks from external systems (e.g., Redmine status change, HR approval). | P1 |
| FR-N-2 | Webhooks MUST verify signature (HMAC-SHA256) and map external entity ID → `submission_id`. | P1 |
| FR-N-3 | Notifications MUST be delivered via IM to the original submitter with a deep link. | P1 |
| FR-N-4 | Polling fallback MUST exist for connectors without webhook support (configurable interval, min 60s). | P2 |
| FR-N-5 | Users MAY subscribe to notification topics per app (e.g., "notify me when status changes"). | P2 |
| FR-N-6 | Notification delivery MUST be retried (3 attempts) if IM delivery fails. | P1 |
| FR-N-7 | Users MUST be able to mute/unmute notifications per app. | P2 |
| FR-N-8 | Webhook endpoint MUST be protected against replay attacks (timestamp + nonce validation). | P1 |

### 8.10. Lifecycle & Retention

| ID | Requirement | Priority |
|---|---|---|
| FR-LC-1 | App states: `draft`, `published`, `deprecated`, `archived`, `purged`. | P0 |
| FR-LC-2 | `deprecated` apps remain functional but show a deprecation notice to users. No new triggers are registered. | P1 |
| FR-LC-3 | `archived` apps MUST be read-only: no triggers, no new submissions, existing view links still work. | P0 |
| FR-LC-4 | Retention policy MUST be configurable per app: `keep_forever`, `purge_after_days` (N days), `purge_immediately_on_archive`. | P0 |
| FR-LC-5 | Purge MUST soft-delete first (mark as deleted, exclude from queries); hard delete after 30-day grace period. | P0 |
| FR-LC-6 | Optional export before purge: JSON Lines or CSV to S3 / configured storage target. | P1 |
| FR-LC-7 | Ownership transfer MUST require global admin approval. Pending transfers auto-cancel after 7 days. | P0 |
| FR-LC-8 | Purge operations MUST be logged in the audit trail with operator ID and timestamp. | P0 |
| FR-LC-9 | Archived app data MUST remain queryable by global admins for compliance purposes. | P1 |

### 8.11. IM Adapter Layer

| ID | Requirement | Priority |
|---|---|---|
| FR-IM-1 | System MUST support at minimum: Slack, Microsoft Teams, Zalo, Telegram. | P0 (Slack), P1 (others) |
| FR-IM-2 | Each IM adapter MUST normalize inbound events to a unified `InboundEvent` schema. | P0 |
| FR-IM-3 | Each IM adapter MUST normalize outbound messages from a unified `OutboundMessage` schema. | P0 |
| FR-IM-4 | Adapters MUST handle IM-specific rate limits and retry logic. | P0 |
| FR-IM-5 | Adapters MUST support slash commands, natural language messages, and interactive elements (buttons, menus where available). | P1 |
| FR-IM-6 | Adapters MUST handle IM webhook verification challenges (e.g., Slack URL verification, Teams token validation). | P0 |
| FR-IM-7 | If an IM platform is unreachable, messages MUST be queued and retried. Users MUST NOT see silent failures. | P0 |
| FR-IM-8 | Adapters MUST support threading: responses should appear in the same thread as the user's message where supported. | P1 |

### 8.12. Audit & Compliance

| ID | Requirement | Priority |
|---|---|---|
| FR-AU-1 | All state-changing actions MUST be logged to an immutable audit log. | P0 |
| FR-AU-2 | Audit log entries MUST include: timestamp, actor (`real_user_id`), action, target, previous state, new state, IP, request ID. | P0 |
| FR-AU-3 | Audit logs MUST be retained for minimum 3 years (configurable). | P0 |
| FR-AU-4 | Audit logs MUST be exportable (CSV, JSON Lines) by global admins. | P1 |
| FR-AU-5 | Audit log MUST be append-only. No update or delete operations permitted. | P0 |
| FR-AU-6 | Global admins MUST have a searchable audit dashboard with filters (user, app, action, date range). | P1 |

---

## 9. Non-Functional Requirements

### 9.1. Scale & Throughput

| ID | Requirement | Target |
|---|---|---|
| NFR-S-1 | Concurrent users | 1,000 |
| NFR-S-2 | IM events processed at peak | ≥ 50 events/sec |
| NFR-S-3 | Form submission throughput at peak | ≥ 10 req/sec |
| NFR-S-4 | Horizontal scaling | Stateless services + Redis/MongoDB backends |
| NFR-S-5 | Deployment model | Cluster mode (PM2 / Node cluster) or container orchestration (K8s) |
| NFR-S-6 | Maximum apps per deployment | 200 |
| NFR-S-7 | Maximum forms per app | 20 |
| NFR-S-8 | Maximum submissions stored per app | 1,000,000 (before archival recommended) |

### 9.2. Performance (Latency)

| ID | Metric | Target (p95) |
|---|---|---|
| NFR-P-1 | Identity resolution (cached) | < 10 ms |
| NFR-P-2 | RBAC aggregation (cached) | < 30 ms |
| NFR-P-3 | JEV decision (excluding model cold-start) | < 500 ms |
| NFR-P-4 | Form page load (server response) | < 800 ms |
| NFR-P-5 | End-to-end: IM message → link response in chat | < 2 s |
| NFR-P-6 | Form submission → internal write confirmation | < 1 s |
| NFR-P-7 | Link generation (create/edit) | < 50 ms |
| NFR-P-8 | View/query link access → data rendered | < 1.5 s |

### 9.3. Security

| ID | Requirement |
|---|---|
| NFR-SEC-1 | One-time tokens MUST be consumed atomically (Redis `GETDEL` or Lua script). No race conditions. |
| NFR-SEC-2 | No PII in JWTs. Only opaque IDs (`real_user_id`, `app_id`, `jti`). |
| NFR-SEC-3 | All secrets (connector credentials, signing keys) encrypted with KMS-backed keys (AES-256-GCM). |
| NFR-SEC-4 | Read links MUST validate `perm_version` on every access. Stale links are rejected. |
| NFR-SEC-5 | Audit log for ALL state-changing actions (create, update, delete, permission change, purge). |
| NFR-SEC-6 | Rate limiting per user (10 req/min), per app (100 req/min), per connector (per connector config). |
| NFR-SEC-7 | All external communication over TLS 1.2+. |
| NFR-SEC-8 | Form renderer MUST sanitize all inputs. No XSS vectors. CSP headers enforced. |
| NFR-SEC-9 | JWT signing keys MUST be rotated every 90 days with zero-downtime (dual-key validation window). |
| NFR-SEC-10 | Brute-force protection: max 5 failed link validations per IP per 10 minutes → temporary block. |
| NFR-SEC-11 | CORS MUST be restricted to known origins (IM platforms + form renderer domain). |
| NFR-SEC-12 | Dependency scanning (npm audit, Snyk) MUST run in CI pipeline. Critical vulnerabilities block deployment. |

### 9.4. Observability

| ID | Requirement |
|---|---|
| NFR-O-1 | Trace ID = `submission_id`, propagated end-to-end (IM → API → Form → Data Router → Connector). |
| NFR-O-2 | OpenTelemetry instrumentation for NestJS, MongoDB, Redis, HTTP, BullMQ. |
| NFR-O-3 | Metrics exposed via Prometheus: JEV latency/confidence, RBAC resolution latency, connector success/failure rate, token issue/consume rates, queue depth, form load time. |
| NFR-O-4 | Alerts: connector failure >5% over 5 min, token consume failure spike (>10/min), JEV confidence average drop below 0.6, DLQ depth > 50, Redis memory > 80%. |
| NFR-O-5 | Structured JSON logging (level, timestamp, trace_id, service, message, metadata). |
| NFR-O-6 | Log retention: 30 days hot (searchable), 1 year cold (archived). |
| NFR-O-7 | Health check endpoints: `/health/live` and `/health/ready` for orchestrator probes. |
| NFR-O-8 | Dashboard: real-time view of active users, submissions/min, JEV accuracy, connector health. |

### 9.5. Availability & Reliability

| ID | Requirement |
|---|---|
| NFR-A-1 | Target uptime: 99.9% for core services (≤ 43 min downtime/month). |
| NFR-A-2 | JEV fallback chain MUST ensure decisions are still possible if primary provider is down. |
| NFR-A-3 | Connector failures MUST NOT block internal writes in hybrid mode. |
| NFR-A-4 | MongoDB and Redis MUST be deployed in replica sets (minimum 3 nodes for production). |
| NFR-A-5 | Automated failover for database connections. |
| NFR-A-6 | Zero-downtime deployments (rolling updates, health-check gated). |
| NFR-A-7 | Disaster recovery: RPO ≤ 1 hour, RTO ≤ 4 hours. |
| NFR-A-8 | Automated backups: MongoDB daily full + continuous oplog. Redis RDB every 5 min. |

### 9.6. Accessibility & Usability

| ID | Requirement |
|---|---|
| NFR-U-1 | Form renderer MUST meet WCAG 2.1 AA (keyboard navigation, screen reader labels, color contrast). |
| NFR-U-2 | App Builder UI MUST be usable without documentation for basic app creation (guided wizard). |
| NFR-U-3 | All user-facing messages MUST be clear, actionable, and free of stack traces. |
| NFR-U-4 | Form renderer MUST be responsive (desktop, tablet, mobile browser). |
| NFR-U-5 | Loading states MUST be indicated for any operation > 500ms. |

---

## 10. Data Models

### 10.1. Identity Mapping

```json
{
  "mapping_id": "map_uuid",
  "chat_user_id": "U12345",
  "im": "slack",
  "real_user_id": "usr_42",
  "email": "a.nguyen@company.com",
  "display_name": "An Nguyen",
  "verified_at": "2026-01-15T10:00:00Z",
  "verified_by": "sso | otp | admin_import",
  "status": "active | deactivated",
  "created_at": "2026-01-15T09:00:00Z",
  "updated_at": "2026-01-15T10:00:00Z"
}
```

### 10.2. Real User Profile

```json
{
  "real_user_id": "usr_42",
  "email": "a.nguyen@company.com",
  "display_name": "An Nguyen",
  "department": "Engineering",
  "employee_code": "EMP-2024-042",
  "attributes": {
    "manager_id": "usr_10",
    "cost_center": "CC-ENG-01",
    "location": "HCMC"
  },
  "status": "active | deactivated",
  "created_at": "2026-01-10T08:00:00Z",
  "updated_at": "2026-01-15T10:00:00Z"
}
```

### 10.3. App Definition

```yaml
app:
  id: "hr-leave-request"
  name: "Leave Request"
  description: "Submit and manage leave requests"
  owner: "usr_42"
  status: "published"
  version: 3
  created_at: "2026-06-01T00:00:00Z"
  updated_at: "2026-09-28T14:30:00Z"

  triggers:
    - type: intent
      intent: "request_leave"
      examples: ["I want to take leave", "Request annual leave"]
    - type: slash_command
      command: "/leave request"

  rbac:
    roles:
      - name: "user"
        permissions: ["leave:create", "leave:view_own", "leave:edit_own"]
      - name: "manager"
        permissions: ["leave:view_team", "leave:approve", "leave:reject"]
      - name: "admin"
        permissions: ["leave:*"]
    assignments:
      - role: "user"
        users: ["usr_100", "usr_101", "usr_102"]
      - role: "manager"
        users: ["usr_10"]
      - role: "admin"
        users: ["usr_42"]

  forms:
    - id: "create-leave"
      schema_ref: "forms/leave-create-v2.json"
      version: 2
      action: "create"
      required_permission: "leave:create"
      prefill:
        employee_code: "{{real_user.employee_code}}"
        department: "{{real_user.department}}"
    - id: "view-leave"
      schema_ref: "forms/leave-view-v1.json"
      version: 1
      action: "view"
      required_permission: "leave:view_own"

  data:
    mode: "hybrid"
    collections:
      - name: "leave_requests"
        indexes:
          - { fields: ["real_user_id", "status"], type: "compound" }
          - { fields: ["created_at"], type: "single", order: -1 }
    connector_ref: "hr-api-prod"
    operation: "create_leave_request"
    field_mapping:
      employee_code: "{{real_user.employee_code}}"
      start_date: "{{form.start_date}}"
      end_date: "{{form.end_date}}"
      leave_type: "{{form.leave_type}}"
      reason: "{{form.reason}}"

  lifecycle:
    retention:
      mode: "purge_after_days"
      days: 365
    deprecation_notice: "This app will be replaced by HR Portal v2 in Q1 2027."

  notifications:
    webhook_secret_ref: "secrets/hr-webhook-hmac"
    topics:
      - name: "leave_approved"
        template: "Your leave request {{submission_id}} has been approved."
      - name: "leave_rejected"
        template: "Your leave request {{submission_id}} was rejected. Reason: {{reason}}"
```

### 10.4. Submission

```json
{
  "submission_id": "sub_a1b2c3d4",
  "app_id": "hr-leave-request",
  "app_version": 3,
  "form_id": "create-leave",
  "form_version": 2,
  "real_user_id": "usr_42",
  "chat_user_id": "U12345",
  "im": "slack",
  "data": {
    "start_date": "2026-10-15",
    "end_date": "2026-10-17",
    "leave_type": "annual",
    "reason": "Family event"
  },
  "status": "completed | partial | failed | pending_external",
  "destination": {
    "mode": "hybrid",
    "internal_ref": "leave_requests/doc_xyz789",
    "external_ref": {
      "connector": "hr-api-prod",
      "system_id": "LV-2026-0042",
      "status": "synced"
    }
  },
  "link": {
    "type": "create",
    "jti": "jwt_unique_id",
    "issued_at": "2026-09-30T09:59:00Z",
    "consumed_at": "2026-09-30T10:00:03Z"
  },
  "created_at": "2026-09-30T09:59:00Z",
  "submitted_at": "2026-09-30T10:00:03Z",
  "completed_at": "2026-09-30T10:00:05Z"
}
```

### 10.5. Connector Definition

```json
{
  "connector_id": "hr-api-prod",
  "name": "HR API (Production)",
  "type": "rest",
  "base_url": "https://hr.internal.company.com/api/v2",
  "auth": {
    "type": "bearer",
    "credential_ref": "kms://secrets/hr-api-token"
  },
  "rate_limit": {
    "requests_per_minute": 60,
    "burst": 10
  },
  "timeout_ms": 30000,
  "retry": {
    "max_attempts": 5,
    "backoff_base_ms": 2000,
    "backoff_multiplier": 2
  },
  "health_check": {
    "endpoint": "/health",
    "interval_seconds": 60
  },
  "status": "healthy | degraded | unhealthy",
  "managed_by": "usr_admin_01",
  "created_at": "2026-05-01T00:00:00Z"
}
```

### 10.6. Audit Log Entry

```json
{
  "audit_id": "aud_uuid",
  "timestamp": "2026-09-30T10:00:03Z",
  "actor": "usr_42",
  "action": "submission.create",
  "target_type": "submission",
  "target_id": "sub_a1b2c3d4",
  "app_id": "hr-leave-request",
  "previous_state": null,
  "new_state": "status:completed",
  "metadata": {
    "ip": "10.0.1.55",
    "user_agent": "Slack/2026.09",
    "trace_id": "sub_a1b2c3d4"
  }
}
```

---

## 11. JEV-Compatible Specification

### 11.1. Endpoints

#### POST `/decide`

**Request:**
```json
{
  "spec_version": "1.0",
  "request_id": "req_uuid",
  "state": {
    "locale": "en",
    "conversation_id": "conv_123",
    "turn_count": 3
  },
  "question": "I want to request leave for next week",
  "context": {
    "real_user_id": "usr_42",
    "app_hints": [],
    "previous_turns": [
      { "role": "user", "text": "hi" },
      { "role": "assistant", "text": "How can I help?" }
    ]
  },
  "tools": [
    {
      "id": "hr-leave-request:create_leave",
      "description": "Submit a new leave request",
      "parameters": ["start_date", "end_date", "leave_type"]
    },
    {
      "id": "hr-leave-request:view_leave",
      "description": "View my leave history",
      "parameters": ["date_range"]
    }
  ]
}
```

**Response:**
```json
{
  "spec_version": "1.0",
  "request_id": "req_uuid",
  "choice": {
    "tool_id": "hr-leave-request:create_leave",
    "confidence": 0.94
  },
  "alternatives": [
    { "tool_id": "hr-leave-request:view_leave", "confidence": 0.04 }
  ],
  "clarification_needed": false,
  "provider": "openjev-v2",
  "latency_ms": 230
}
```

#### GET `/health`

**Response:**
```json
{
  "status": "healthy | degraded | unhealthy",
  "model_version": "openjev-2.1.0",
  "spec_version": "1.0",
  "capabilities": ["tool_selection", "clarification", "multi_turn"],
  "uptime_seconds": 86400,
  "last_inference_at": "2026-09-30T09:59:00Z"
}
```

### 11.2. Provider Interface (TypeScript)

```typescript
interface JevProvider {
  readonly name: string;
  readonly spec_version: string; // "1.0"
  readonly capabilities: JevCapability[];

  decide(req: JevRequest): Promise<JevResponse>;
  healthCheck(): Promise<HealthStatus>;
}

type JevCapability = 'tool_selection' | 'clarification' | 'multi_turn' | 'streaming';

interface JevRequest {
  spec_version: string;
  request_id: string;
  state: { locale: string; conversation_id: string; turn_count: number };
  question: string;
  context: { real_user_id: string; app_hints: string[]; previous_turns: Turn[] };
  tools: ToolDescriptor[];
}

interface JevResponse {
  spec_version: string;
  request_id: string;
  choice?: { tool_id: string; confidence: number };
  alternatives?: { tool_id: string; confidence: number }[];
  clarification_needed: boolean;
  clarification_prompt?: string;
  provider: string;
  latency_ms: number;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  model_version: string;
  spec_version: string;
  capabilities: JevCapability[];
  uptime_seconds: number;
}
```

### 11.3. Reference Implementations

| Provider | Use Case | Notes |
|---|---|---|
| `OpenJevProvider` | Production (self-hosted) | Primary decision engine |
| `TypeSafeJevProvider` | Production (licensed) | If commercial license acquired |
| `OpenAICompatibleProvider` | Dev / staging / fallback | Any OpenAI-compatible API |
| `RuleBasedProvider` | Offline fallback | Regex + keyword matching, no external dependency |
| `CompositeProvider` | Production | Chains providers with configurable fallback order |

### 11.4. Fallback Chain Configuration

```yaml
jev:
  chain:
    - provider: "openjev-prod"
      timeout_ms: 500
      min_confidence: 0.7
    - provider: "openai-compatible"
      timeout_ms: 1000
      min_confidence: 0.75
    - provider: "rule-based"
      timeout_ms: 50
      min_confidence: 0.5
  cache:
    enabled: true
    ttl_seconds: 300
    key_strategy: "hash(text + sorted(tool_ids) + locale)"
  health_check_interval_seconds: 60
  circuit_breaker:
    failure_threshold: 5
    reset_timeout_seconds: 30
```

---

## 12. User Flows

### 12.1. Create Flow (Write Operation)

```
1. User types message in IM (e.g., "I want to request leave" or "/leave request")
2. IM Adapter normalizes event → InboundEvent
3. Rate limiter checks user quota
4. Identity Service resolves chat_user_id → real_user_id (cache or DB)
   └── If unmapped → onboarding prompt, flow ends
5. RBAC Aggregator resolves roles + permissions for user across all apps
6. Tool Filter produces authorized tool subset
7. JEV Abstraction receives (question, filtered tools)
   └── Returns: selected tool + confidence
   └── If confidence < threshold → clarification prompt
   └── If JEV down → fallback chain activates
8. App Runtime loads app definition
9. Defense-in-depth RBAC re-check (user still has permission?)
10. Link Service generates one-time create link (JWT + Redis entry, TTL 30min)
11. Link sent to user via IM (formatted message with button/URL)
12. User clicks link → Form Renderer (FormIO.js) loads
    └── Server validates JWT, checks TTL, pre-fills from user profile
13. User fills form, clicks Submit
14. Token consumed atomically (Redis GETDEL)
    └── If already consumed → "already submitted" message
    └── If expired → "link expired" message
15. Submission validated against form schema
16. Data Router executes:
    ├── Internal: write to MongoDB collection
    ├── External: enqueue to BullMQ → Connector Worker calls API
    └── Hybrid: internal (sync) + external (async)
17. Confirmation message formatted and sent via IM
    └── Includes submission_id for reference
18. Audit log entry written
```

### 12.2. View / Query Flow (Read Operation)

```
1. User queries in IM (e.g., "show my tickets" or "/tickets list")
2. Steps 2-7 same as Create Flow
3. JEV selects a "view" or "query" tool
4. Defense-in-depth RBAC check
5. Link Service generates signed view/query link (JWT, no Redis, TTL up to 90 days)
6. Link sent to user via IM
7. User clicks link → Form Renderer loads in "view" or "query results" mode
8. On access:
   a. Verify JWT signature
   b. Check expiry
   c. Fresh RBAC permission check (user still authorized?)
   d. Validate perm_version (has permission changed since link was issued?)
   e. If query: execute query with auto-injected user filter
9. Results rendered (read-only FormIO or table view)
10. Access logged (jti, user, timestamp, IP)
```

### 12.3. Inbound Notification Flow (Two-Way Sync)

```
1. External system sends webhook (e.g., "Ticket #123 status changed to Resolved")
2. Webhook endpoint verifies HMAC signature
3. External entity ID mapped → submission_id
4. Original submitter's real_user_id retrieved
5. Notification message formatted per app template
6. Deep link generated (bound to original submitter)
7. Message delivered via IM to original submitter
8. Delivery logged; retried (3x) if IM delivery fails
```

### 12.4. App Builder Flow (Admin)

```
1. App Owner opens App Builder UI (authenticated via SSO)
2. Creates new app (name, description, triggers)
3. Defines RBAC: creates roles, assigns permissions, assigns users
4. Designs form(s) using FormIO.js drag-and-drop builder
5. Configures data routing:
   ├── Internal: defines collection name, indexes
   ├── External: selects connector, maps fields
   └── Hybrid: both
6. Configures retention policy
7. Tests in "preview" mode (sandbox submissions)
8. Publishes app → triggers registered, indexes created
9. Monitors via submission viewer and audit dashboard
```

### 12.5. Onboarding Flow (New User)

```
1. Unmapped user sends first message in IM
2. System detects no mapping → sends onboarding prompt:
   "Hi! I don't recognize you yet. Please verify your identity."
3. User provides corporate email
4. System sends OTP to IM (or email)
5. User enters OTP within 10 minutes (max 3 attempts)
6. On success: real_user record created, mapping established
7. Welcome message sent with available commands/apps
8. On failure after 3 attempts: 30-min lockout, contact admin message
```

---

## 13. API Design Principles

### 13.1. Internal API (Service-to-Service)

- REST over HTTP/2, JSON payloads.
- Authentication: mTLS or internal service tokens.
- Versioning: URL path (`/v1/`).
- Error format: `{ "error": { "code": "PERMISSION_DENIED", "message": "...", "trace_id": "..." } }`.

### 13.2. External API (Webhooks, Connectors)

- Inbound webhooks: HMAC-SHA256 signature verification.
- Outbound connector calls: Bearer token or API key (encrypted at rest).
- Idempotency: `X-Submission-ID` header on all external calls.
- Timeout: configurable per connector (default 30s).

### 13.3. Form Renderer API

- Served as a separate web application.
- Authenticates via JWT in URL (one-time or signed).
- No session cookies. Stateless.
- CSP headers: `default-src 'self'; script-src 'self'`.

### 13.4. App Builder API

- REST, authenticated via SSO (OIDC).
- RBAC-scoped: users can only manage apps they own/admin.
- All mutations are versioned and audited.

---

## 14. App Builder UI Requirements

### 14.1. Pages / Views

| Page | Description | Access |
|---|---|---|
| Dashboard | Overview: my apps, recent submissions, health status | App Owner, Admin |
| App List | All apps I own/manage, filterable by status | App Owner, Admin |
| App Editor | Tabbed: General, Triggers, RBAC, Forms, Data Routing, Lifecycle | App Owner, Admin |
| Form Builder | FormIO.js drag-and-drop designer (embedded) | App Owner, Admin |
| Submission Viewer | Table + detail view of all submissions for an app | App Admin+ |
| Connector Manager | List, create, test connectors | Global Admin only |
| Audit Log Viewer | Searchable, filterable audit trail | Global Admin |
| User Management | Identity mappings, onboarding status | Global Admin |
| Settings | Platform config, JEV providers, defaults | Global Admin |

### 14.2. UX Requirements

| ID | Requirement |
|---|---|
| UX-1 | App creation MUST be completable in ≤ 5 steps (wizard mode). |
| UX-2 | Form Builder MUST support undo/redo (last 50 actions). |
| UX-3 | RBAC assignment MUST support search by name/email with autocomplete. |
| UX-4 | Data routing config MUST show a visual mapping (form field → connector field). |
| UX-5 | Publish action MUST show a confirmation dialog with summary of changes. |
| UX-6 | Errors MUST be inline, specific, and actionable (not generic "something went wrong"). |
| UX-7 | App Builder MUST be responsive (usable on tablet for field admins). |
| UX-8 | Loading skeletons for all async operations. |
| UX-9 | Breadcrumb navigation for deep hierarchies. |
| UX-10 | Keyboard shortcuts for common actions (Ctrl+S save, Ctrl+P preview). |

---

## 15. Security & Compliance

### 15.1. Authentication

| Aspect | Approach |
|---|---|
| IM → Platform | IM platform webhook verification (signing secrets) |
| User → Form | One-time JWT (write) or signed JWT (read) |
| Admin → App Builder | SSO (OIDC/SAML) with MFA |
| Service → Service | mTLS or internal service tokens |
| Platform → External | Per-connector credentials (encrypted) |

### 15.2. Authorization Model

- RBAC per app, per real user.
- Two enforcement points: pre-JEV (tool filter) and pre-execution (defense-in-depth).
- `perm_version` for read-link invalidation.
- No superuser bypass for app-level permissions (only global admin for platform ops).

### 15.3. Data Protection

| Aspect | Approach |
|---|---|
| At rest | MongoDB encryption at rest (AES-256). Redis: no PII stored (only tokens, IDs). |
| In transit | TLS 1.2+ everywhere. |
| Secrets | KMS-backed encryption. No secrets in code, config files, or env vars in plain text. |
| PII minimization | Only necessary fields collected. No PII in JWTs. |
| Data residency | Configurable per deployment (region-locked storage). |

### 15.4. Compliance Considerations

- **GDPR / Local Data Protection**: Right to erasure → purge workflow. Data portability → export.
- **Audit**: Immutable logs, 3-year retention minimum.
- **Access Review**: Quarterly access review reports (auto-generated: who has access to what).
- **Incident Response**: Security event alerts, breach notification workflow (out of scope for v1 but architecture must not prevent it).

---

## 16. Observability & Operations

### 16.1. Tracing

- OpenTelemetry SDK integrated in all services.
- Trace ID = `submission_id` propagated via headers.
- Spans: IM receive → identity → RBAC → JEV → link → form → submit → route → respond.
- Export to Jaeger / Tempo.

### 16.2. Metrics (Prometheus)

| Metric | Type | Labels |
|---|---|---|
| `jev_decision_duration_ms` | Histogram | provider, app_id |
| `jev_confidence` | Histogram | provider, app_id |
| `rbac_resolution_duration_ms` | Histogram | app_id |
| `connector_call_total` | Counter | connector_id, status |
| `connector_call_duration_ms` | Histogram | connector_id |
| `token_issued_total` | Counter | link_type, app_id |
| `token_consumed_total` | Counter | link_type, app_id, result |
| `form_submission_total` | Counter | app_id, mode |
| `queue_depth` | Gauge | queue_name |
| `active_im_connections` | Gauge | im_platform |

### 16.3. Alerting Rules

| Alert | Condition | Severity |
|---|---|---|
| Connector failure spike | >5% failures over 5 min | Critical |
| JEV confidence drop | Average < 0.6 over 10 min | Warning |
| Token consume failure | >10 failures/min | Warning |
| DLQ depth | > 50 items | Warning |
| Redis memory | > 80% maxmemory | Warning |
| MongoDB replication lag | > 5 seconds | Critical |
| Service down | Health check fails 3x consecutive | Critical |
| JEV all providers down | All providers unhealthy | Critical |

### 16.4. Runbook (Key Scenarios)

| Scenario | Action |
|---|---|
| JEV primary down | Automatic fallback. Alert. Investigate. No user impact if fallback healthy. |
| Connector timeout spike | Check external system. Increase timeout temporarily. Alert connector owner. |
| Redis OOM | Check token leak. Increase maxmemory. Evict expired keys. |
| IM webhook failing | Check IM platform status. Verify signing secret rotation. Replay from queue. |
| Double submission reports | Verify atomic consumption. Check Redis cluster split-brain. |

---

## 17. Testing Strategy

### 17.1. Test Pyramid

| Level | Coverage Target | Tools |
|---|---|---|
| Unit | >80% for business logic (RBAC, routing, link lifecycle) | Jest, Vitest |
| Integration | All API endpoints, DB operations, Redis operations | Supertest, Testcontainers |
| E2E (API) | Full user flows (message → link → submit → confirmation) | Playwright (API mode) |
| E2E (UI) | App Builder critical paths, Form Renderer | Playwright (browser) |
| Contract | JEV provider conformance, connector interface | Pact / custom harness |
| Load | 1,000 concurrent users, 50 events/sec | k6, Artillery |
| Security | OWASP Top 10, dependency scan | ZAP, Snyk, npm audit |

### 17.2. Specific Test Scenarios

| Scenario | Validation |
|---|---|
| Concurrent submission with same token | Only one succeeds; other gets "already submitted" |
| Permission revoked after link issued | Read link returns 403 on access |
| JEV timeout → fallback | Rule-based provider activates within 100ms |
| Connector failure in hybrid mode | Internal write succeeds; external queued for retry |
| Cross-app circular sharing | Rejected at publish time with clear error |
| Form version mismatch | Submission pinned to version at link creation |
| OTP brute force | Locked after 3 attempts |
| Expired create link | Clear "expired" message with re-request option |

### 17.3. JEV Conformance Tests

All JEV providers MUST pass a standardized test suite:
- 50 predefined intents with expected tool selections.
- Minimum accuracy: 85% on test set.
- Latency: p95 < 500ms.
- Graceful handling of empty tool list, unknown input, malformed requests.

---

## 18. Deployment & Infrastructure

### 18.1. Environment Strategy

| Environment | Purpose | Data |
|---|---|---|
| `dev` | Developer local / shared dev | Synthetic |
| `staging` | Pre-production validation | Anonymized production subset |
| `production` | Live | Real |

### 18.2. Deployment Topology (Production)

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │  (nginx / ALB)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼─────┐  ┌────▼────────┐
     │ Core API   │  │ Core API   │  │ Form        │
     │ Instance 1 │  │ Instance 2 │  │ Renderer    │
     │ (NestJS)   │  │ (NestJS)   │  │ (Static +   │
     │            │  │            │  │  API proxy) │
     └────────────┘  └────────────┘  └─────────────┘
              │              │
     ┌────────▼──────────────▼────────┐
     │         Data Layer             │
     │  ┌─────────┐  ┌────────────┐  │
     │  │ MongoDB │  │   Redis    │  │
     │  │ Replica │  │  Cluster   │  │
     │  │ Set (3) │  │  (3 nodes) │  │
     │  └─────────┘  └────────────┘  │
     └────────────────────────────────┘
              │
     ┌────────▼────────┐
     │ BullMQ Workers  │
     │ (Connector      │
     │  execution)     │
     └─────────────────┘
```

### 18.3. Scaling Strategy

| Component | Scaling Mechanism |
|---|---|
| Core API | Horizontal (add instances behind LB) |
| Form Renderer | Static assets via CDN; API scales with Core |
| MongoDB | Replica set; shard if >100GB |
| Redis | Cluster mode; add nodes for memory/throughput |
| BullMQ Workers | Add worker instances for connector throughput |

### 18.4. CI/CD Pipeline

```
Push → Lint → Unit Tests → Build → Integration Tests → Security Scan
  → Deploy to Staging → E2E Tests → Manual Approval → Deploy to Production
  → Smoke Tests → Monitor (15 min) → Complete
```

- Rollback: One-click revert to previous version.
- Database migrations: Forward-only, backward-compatible.

---

## 19. Migration & Onboarding

### 19.1. User Onboarding

| Method | Use Case |
|---|---|
| CSV Bulk Import | Initial rollout: HR provides employee list with emails + IM IDs |
| OTP Self-Service | Ongoing: new employees verify via IM |
| SSO Auto-Mapping | If IM identity provider matches corporate IdP (future) |

### 19.2. App Migration

- Existing processes (email forms, spreadsheets) → App Builder wizard.
- Migration guide per department.
- Parallel run period: old process + new app active for 2 weeks.

### 19.3. Connector Onboarding

| Step | Owner |
|---|---|
| Identify external system API + auth model | Developer |
| Implement connector interface | Developer |
| Test in staging (dry_run) | Developer + Global Admin |
| Register connector in production | Global Admin |
| Configure rate limits + alerts | Global Admin |
| Reference connector in app config | App Owner |

---

## 20. MVP Roadmap

### Phase 1 — Core Foundation (4–6 weeks)

| Deliverable | Details |
|---|---|
| NestJS + MongoDB + Redis skeleton | Project structure, config, health checks |
| Identity Service | Pre-provision (CSV) + OTP onboarding |
| App Registry + per-app RBAC | CRUD, role assignment, permission check |
| FormIO.js renderer | Render form from JSON schema, submit |
| One-time create links | JWT + Redis, atomic consumption |
| Internal storage mode | Write to MongoDB collection |
| Slack IM Adapter | Inbound/outbound, slash commands |
| Basic message formatter | Confirmation, error, link messages |
| Unit + integration tests | >70% coverage on core |

### Phase 2 — Integration & Async (3–4 weeks)

| Deliverable | Details |
|---|---|
| Connector interface + REST connector | Common interface, one implementation |
| External + hybrid data modes | Field mapping, async external calls |
| BullMQ integration | Queue, workers, retry, DLQ |
| Audit log + distributed tracing | OpenTelemetry, structured logging |
| Edit links | One-time submit, multi-load |
| Idempotency enforcement | submission_id dedup on connector calls |

### Phase 3 — App Builder UI (4–6 weeks)

| Deliverable | Details |
|---|---|
| App Builder web app | CRUD app, triggers, lifecycle |
| RBAC management UI | Roles, permissions, user assignment |
| Form Builder (FormIO.js embedded) | Drag-and-drop, preview, versioning |
| Data routing config UI | Mode selection, field mapping, connector ref |
| Submission viewer | Table + detail, filter, export |
| Test & preview mode | Sandbox submissions before publish |

### Phase 4 — Scale, Polish & Multi-IM (4–6 weeks)

| Deliverable | Details |
|---|---|
| JEV-compatible provider integration | OpenJev + rule-based fallback |
| Microsoft Teams adapter | Bot Framework integration |
| Zalo adapter | Zalo OA API |
| Read links (view/query) + perm_version | Signed deep links, fresh permission |
| Observability suite | Dashboards, alerts, runbooks |
| Inbound webhooks | Two-way sync with external systems |
| Load testing + optimization | 1,000 concurrent users validated |
| Documentation | User guide, admin guide, developer guide |

### Phase 5 — Advanced Features (Future, post-MVP)

| Feature | Target |
|---|---|
| Telegram adapter | Q1 post-MVP |
| Cross-app collection sharing | Q1 post-MVP |
| Approval workflows (single-step) | Q2 post-MVP |
| Group-based RBAC | Q2 post-MVP |
| Form i18n (multi-language) | Q2 post-MVP |
| Mobile-optimized form UX | Q3 post-MVP |
| AI-assisted form builder | Q3 post-MVP |

---

## 21. Success Metrics & KPIs

| Metric | Target (6 months post-launch) | Measurement |
|---|---|---|
| Weekly active users (WAU) | >60% of target employee base | Identity service logs |
| Average task completion time | < 2 minutes (message → confirmation) | Tracing |
| Form submission success rate | > 99% | Submission status |
| JEV accuracy (correct tool selected) | > 90% | Conformance tests + production sampling |
| App Builder adoption | > 10 apps built by non-developers | App registry |
| Shadow process reduction | > 50% reduction in email-based workflows | Department surveys |
| System uptime | > 99.9% | Monitoring |
| User satisfaction (CSAT) | > 4.2 / 5 | Quarterly survey |
| Connector success rate | > 98% | Connector metrics |
| Mean time to resolve (MTTR) for incidents | < 30 minutes | Ops log