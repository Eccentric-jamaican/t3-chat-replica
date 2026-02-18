# Phase 2 Surface Matrix

As of 2026-02-17.

This matrix tracks public boundary hardening coverage for HTTP routes and public Convex functions.

## HTTP entrypoints

| Surface | Contract validation | Auth/Authz | Abuse controls | Error taxonomy |
| --- | --- | --- | --- | --- |
| `POST /api/chat` | `chatRequestSchema` | Better Auth user required | JSON-only, 64KB max, origin allowlist, rate limit | `x-sendcat-error-code` (`unauthorized`, `forbidden`, `invalid_json`, `invalid_request`, `rate_limited`, etc.) |
| `OPTIONS /api/chat` | n/a | origin-scoped CORS | n/a | n/a |
| `GET /api/gmail/auth/callback` | state/code shape checks + param length guards | encrypted OAuth state user binding | endpoint rate limit, oversized param rejection | deterministic redirect classification (`gmail=error|expired|busy|connected`) |
| `POST /api/gmail/push` | `gmailPushEnvelopeSchema` + `gmailHistoryPayloadSchema` | verify token guard | JSON-only, 256KB max, endpoint rate limit, replay key dedupe | taxonomy response headers + classified JSON/validation failures |
| `GET /api/whatsapp/webhook` | query token check | verify token | n/a | `forbidden` taxonomy on mismatch |
| `POST /api/whatsapp/webhook` | `whatsappWebhookSchema` | HMAC signature verification | JSON-only, 256KB max, endpoint rate limit, per-message replay dedupe | taxonomy response headers + classified JSON/validation failures |

## Public Convex functions

| Module | Public surface | Guard pattern | Notes |
| --- | --- | --- | --- |
| `threads.ts` | thread CRUD/share/claim | centralized `requireThreadAccess` + `requireAuthenticatedUserId` | ownership/session checks unified and classified |
| `messages.ts` | message CRUD/stream status | centralized `requireThreadAccess` + `requireMessageAccess` | thread/message access checks unified across all public handlers |
| `streamSessions.ts` | stream session start/abort | centralized `requireThreadAccess` | start path now uses classified `not_found`/`forbidden` errors |
| `favorites.ts` | list + list-item mutations | centralized `requireAuthenticatedUserId` + ownership assertion | list ownership checks standardized |
| `packages.ts` | list/seed | centralized auth helpers | seed is strict-auth; list remains guest-safe (`[]`) |
| `integrations/preferences.ts` | get/update preferences | centralized auth helpers | `get` remains guest-safe (`null`); `update` strict-auth |
| `integrations/evidence.ts` | drafts/pre-alert CRUD | centralized auth + `requireOwnedDraft` | draft ownership checks standardized across mutations |
| `integrations/gmail/connection.ts` | status/disconnect/oauth/sync | centralized auth helpers for mutating/action paths | status query remains guest-safe (`null`) |
| `integrations/whatsapp.ts` | linking status/code/disconnect | centralized auth + function rate-limit helper | linking code requests now rate-limited per user |

## Shared utilities used

- `convex/lib/functionErrors.ts`: function-level error taxonomy (`[code:functionName] message`).
- `convex/lib/authGuards.ts`: reusable auth + ownership/session guards.
- `convex/lib/functionRateLimit.ts`: classified function-level limiter wrapper.
- `convex/lib/functionBoundaries.ts`: shared zod argument checks for internal function boundaries.

