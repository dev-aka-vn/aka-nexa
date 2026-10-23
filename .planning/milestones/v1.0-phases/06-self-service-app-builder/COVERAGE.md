# Phase 6: Self-Service App Builder — API Coverage Matrix

**Phase:** 06-self-service-app-builder
**Generated:** 2026-10-11
**Scope:** external API/SDK surfaces this phase integrates. Every non-integrated capability of an integrated surface is an explicit, reasoned OPT-OUT (Full API Coverage by Default — opt out, never opt in).

## 1. Corporate IdP (OIDC) via `openid-client` 6.8.8

The builder's SSO surface (BLD-12, D-101..D-104). The v6 flat API is the integrated surface; the flow completes at the API endpoint (`/auth/oidc/begin`, `/auth/oidc/callback`) — the SPA never holds a token.

| capability | decision | reason |
|------------|----------|--------|
| discovery (issuer metadata) | INTEGRATE | One-time at module init (Pattern 4); `supportsPKCE()` gates the state parameter |
| authorization URL build (`buildAuthorizationUrl`) | INTEGRATE | `/auth/oidc/begin` — PKCE S256 challenge + scoped params |
| authorization code exchange (`authorizationCodeGrant`) | INTEGRATE | `/auth/oidc/callback` — `pkceCodeVerifier` + `expectedState` verified before any token use |
| ID-token claim verification (`acr`/`amr`) | INTEGRATE | D-102 MFA gate — a non-MFA-strong login is refused with AUTH_MFA_REQUIRED on every login |
| refresh / silent token exchange | INTEGRATE | D-103 — session lifetime tracks the IdP session; the silent exchange keeps the Redis session alive |
| userinfo endpoint | OPT-OUT | Profile/email claims arrive on the ID token; a separate userinfo call would add a round-trip and an access-token hold for no new claim |
| backchannel logout | OPT-OUT | Session lifetime already tracks the IdP session via silent exchange (D-103); a backchannel logout receiver is not required for the v1 SSO posture |
| token revocation | OPT-OUT | The API holds no long-lived user token to revoke — logout destroys the server-side Redis session record (D-101); the IdP-side session ends at the IdP |

## 2. FormIO SDK via `@formio/js` 5.6.1 (pinned)

The form engine and drag-and-drop builder (BLD-04, FRM-05, FRM-09). Browser-only surface — every touch is a guarded dynamic import (Pattern 1); a static import in a Node context throws `document is not defined`.

| capability | decision | reason |
|------------|----------|--------|
| form render (`Formio.createForm`) | INTEGRATE | FRM-09 draft preview — the renderer precedent (`apps/renderer`) |
| form build (`Formio.builder`) | INTEGRATE | BLD-04 drag-and-drop designer — the spike-S1-verified mount |
| change events (`builder.on('change')`) | INTEGRATE | The snapshot-capture seam for undo/redo (Pattern 2) |
| schema restore (`builder.setForm`) | INTEGRATE | The undo/redo restore path — FormIO 5.6.1 has no builder undo/redo API, so snapshots round-trip through setForm |
| submission handling | INTEGRATE | FRM-09 sandbox preview submissions (in-memory buffer, never the real submissions collection) |
| conditional logic (component `conditional`) | INTEGRATE | FRM-05 — native FormIO component property, authored in the builder's component edit form |
| validation (component `validate`) | INTEGRATE | FRM-05 — required/pattern/min/max/custom are native FormIO validate properties |

## Not this phase's integration surface

- **Connector HTTP calls (base_url, test connection)** — the connector execution path is Phase 5's processor territory (the `Connector` interface, D-89); the test connection runs operator-side in `packages/cli` (D-97/D-100). The builder only authors the request (definition minus secret).
- **IM platform delivery (Slack DM for the OTP)** — the OTP rides the existing chat pipeline's delivery port (plan 03); no new IM SDK is integrated in this phase.
- **Corporate IdP SAML** — deferred (STACK §8.6); OIDC covers the v1 IdP inventory (Open Question 1 / S3).
