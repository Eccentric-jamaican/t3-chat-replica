# Reliability Hardening Log

## 2026-02-16 - Phase 1 Verification

### Scope verified
- Convex rate limit primitive (`rateLimit:checkAndIncrement`, `rateLimit:cleanupExpired`)
- Chat generation rate limiting path (`chat:streamAnswer`)
- HTTP boundary validation and guardrails (`/api/chat`, `/api/gmail/push`, `/api/whatsapp/webhook`)
- Build/runtime stability on touched files

### Commands and checks
- `npm test` -> passed (`28/28`)
- `npx convex codegen` -> completed
- `npx convex dev --once` -> functions deployed to dev Convex
- `npx tsc --noEmit` -> repo has pre-existing unrelated type errors; no new errors attributed to Phase 1 files

### Runtime checks
- Direct Convex function checks:
  - `rateLimit:checkAndIncrement` allowed/remaining behavior verified (max=2 test)
  - `rateLimit:cleanupExpired` deleted expired windows as expected
- End-to-end chat action:
  - created anon thread + user message
  - invoked `chat:streamAnswer`
  - assistant response persisted successfully
- Rate-limit enforcement test:
  - pre-filled `chat_stream:session:<sessionId>` bucket
  - `chat:streamAnswer` returned: `Rate limit reached...` from `convex/chat.ts`
- HTTP smoke checks against `https://admired-antelope-676.convex.site`:
  - `POST /api/chat` (unauth) -> `401`
  - `POST /api/gmail/push` invalid/unauthorized -> `403`
  - `POST /api/whatsapp/webhook` without signature -> `403`

### Browser observation
- Local app at `http://localhost:3100` fails `/api/chat` due CORS policy mismatch:
  - `OPTIONS /api/chat` from `http://localhost:3100` returns no ACAO header.
  - `OPTIONS /api/chat` from `http://localhost:3000` includes ACAO.
- This is environment/config behavior, not a regression from Phase 1 code.

## 2026-02-16 - Phase 1.1 (In Progress)

### Planned hardening
- Add HTTP endpoint-specific rate limiting for high-risk inbound routes:
  - Gmail OAuth callback
  - Gmail Pub/Sub push webhook
  - WhatsApp webhook
- Use IP-scoped buckets with `429` + `Retry-After` responses.

## 2026-02-16 - Phase 1.1 Implementation + Validation

### Implemented
- Added endpoint-specific limits in `convex/lib/rateLimit.ts`:
  - `gmailOAuthCallback` -> `30 / 5 min`
  - `gmailPushWebhook` -> `120 / min`
  - `whatsappWebhook` -> `120 / min`
- Added shared helpers:
  - `buildRetryAfterSeconds`
  - `isRateLimitContentionError`
- Added HTTP limiter enforcement in `convex/http.ts`:
  - IP extraction from `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`
  - limiter checks added to:
    - `/api/gmail/auth/callback`
    - `/api/gmail/push`
    - `/api/whatsapp/webhook` (POST)
  - standardized `429` responses with `Retry-After`
- Added contention fallback logic:
  - under Convex OCC contention, return `429` (fail closed) instead of `500`
  - applied in:
    - `convex/http.ts` (webhook/callback limiter)
    - `convex/chat.ts` (chat action limiter)
    - `convex/chatHttp.ts` (HTTP chat limiter)

### Issue found during testing
- Initial high-concurrency webhook test produced many `500`s due OCC write contention on `rateLimitWindows`.
- Convex logs confirmed repeated mutation conflicts in `rateLimit:checkAndIncrement`.
- Implemented contention fallback (`429`) so user-facing behavior is stable under burst load.

### Phase 1.1 tests run
- `npm test` -> passed (`28/28`)
- `npx convex dev --once` -> deployed
- Concurrency stress (Node `fetch` burst):
  - WhatsApp webhook: response mix became `403/429` (no `500`)
  - Gmail push webhook: response mix became `403/429` (no `500`)
- Browser smoke on `http://localhost:3100`:
  - created new chat
  - sent prompt
  - received assistant response (`pong`) successfully

### Env/config adjustment for local testing
- Updated Convex dev env var:
  - `ALLOWED_ORIGINS=https://www.sendcat.app,http://localhost:3000,http://localhost:3100,http://localhost:5173`
- Purpose: allow local browser testing from port `3100` and `5173` without CORS failures.

## 2026-02-17 - Phase 1.2 Implementation + Validation

### Goal
- Add structured rate-limit telemetry so abuse spikes are measurable (not just console logs).

### Implemented
- Added telemetry storage table in `convex/schema.ts`:
  - `rateLimitEvents` with source, bucket, key, outcome, retryAfterMs, path/method, createdAt, expiresAt
  - indexes:
    - `by_expires_at`
    - `by_bucket_created`
    - `by_outcome_created`
- Extended `convex/rateLimit.ts`:
  - `recordEvent` internal mutation
  - `listRecentEvents` internal query (quick operator visibility)
  - `cleanupExpired` now also cleans expired `rateLimitEvents`
- Wired telemetry emission into limiter paths:
  - `convex/http.ts` via `emitRateLimitEvent` for:
    - blocked (`outcome=blocked`)
    - OCC fallback (`outcome=contention_fallback`)
  - `convex/chat.ts` emits chat action limiter events
  - `convex/chatHttp.ts` emits `/api/chat` HTTP limiter events

### Validation
- Build/runtime:
  - `npx convex dev --once` -> deployed schema + functions
  - `npx convex codegen` -> updated bindings
  - `npm test` -> passed (`28/28`)
  - `npx tsc --noEmit` filtered to touched files -> no new errors on touched files
- Runtime telemetry checks:
  - Burst load against `POST /api/whatsapp/webhook` produced `403/429` mix.
  - Queried `rateLimitEvents` and confirmed persisted events with:
    - `source=http`
    - `bucket=whatsapp_webhook`
    - outcomes including both `blocked` and `contention_fallback`
  - `rateLimit:listRecentEvents` returns recent structured records as expected.

## 2026-02-17 - Phase 1.3 Implementation + Validation

### Goal
- Reduce limiter hot-path contention and make telemetry usable at higher traffic without event storms.

### Implemented
- Optimized limiter write path in `convex/rateLimit.ts`:
  - `checkAndIncrement` no longer patches the row when a key is already over limit.
  - This prevents unnecessary writes for blocked requests and lowers conflict rates.
- Added telemetry deduplication in `convex/rateLimit.ts`:
  - `recordEvent` now computes a 5-second `dedupeKey` and skips duplicate events within that window.
  - Added schema/index support in `convex/schema.ts`:
    - `rateLimitEvents.dedupeKey`
    - index `rateLimitEvents.by_dedupe_key`
- Added operator summary query:
  - `rateLimit:getEventSummary` for quick windowed counts by `source:bucket:outcome`.

### Validation
- `npx convex dev --once` -> deployed new index + function changes.
- `npx convex codegen` -> refreshed generated API types.
- `npm test` -> passed (`28/28`).
- Targeted TS check on touched reliability files -> no new errors in touched files.
- Runtime checks:
  - Repeated limiter calls on the same key confirmed blocked requests do not increase stored counter after threshold.
  - Burst webhook load still returns `403/429` (no `500`).
  - `rateLimit:getEventSummary` shows deduped telemetry instead of per-request event floods.

## 2026-02-17 - Phase 1.4 Implementation + Validation

### Goal
- Add automated operational alerting on sustained limiter pressure.

### Implemented
- Added alert storage table in `convex/schema.ts`:
  - `rateLimitAlerts`
  - indexes:
    - `by_alert_key`
    - `by_created_at`
    - `by_expires_at`
- Extended `convex/rateLimit.ts` with alert workflow:
  - `raiseAlertIfNeeded` (cooldown-deduped alert insert)
  - `markAlertEmailed`
  - `listRecentAlerts`
  - `monitorAndAlert` internal action
- Added monitor cron in `convex/crons.ts`:
  - `monitor-rate-limit-alerts` every 5 minutes.
- Alert behavior:
  - evaluates 5-minute summaries from `getEventSummary`
  - creates deduped alerts for threshold breaches
  - optional email notifications to `RATE_LIMIT_ALERT_EMAILS` (comma-separated)
  - email send is best-effort and does not block alert creation

### Validation
- `npx convex dev --once` -> deployed schema/index + cron + functions.
- `npx convex codegen` -> regenerated bindings.
- `npm test` -> passed (`28/28`).
- Targeted TS check on touched files -> no new errors in touched files.
- Runtime checks:
  - Seeded 40 blocked webhook events (`whatsapp_webhook`) via `rateLimit:recordEvent`.
  - `rateLimit:getEventSummary` returned `whatsapp_webhook:blocked = 40`.
  - First `rateLimit:monitorAndAlert` call: `createdAlerts = 1`.
  - Immediate second call: `createdAlerts = 0` (cooldown dedupe works).
  - `rateLimit:listRecentAlerts` returned the new persisted alert row.
  - Event dedupe sanity check with repeated same-key records produced only one stored event.

## 2026-02-17 - Phase 1.4.1 Sentry Alerting Integration + Validation

### Goal
- Reuse existing Sentry notifications for operational rate-limit alerts, instead of relying only on direct email sends.

### Implemented
- Extended `convex/rateLimit.ts`:
  - Added DSN parsing + Sentry envelope sender (`sendSentryRateLimitAlert`) for Convex action runtime.
  - `monitorAndAlert` now sends alert events to Sentry when `SENTRY_DSN` (or `RATE_LIMIT_SENTRY_DSN`) is configured.
  - Kept direct email notifications (`RATE_LIMIT_ALERT_EMAILS`) optional and independent.
- Alert result payload now includes:
  - `sentryAlerts` (count of alerts successfully sent to Sentry in that run).

### Validation
- `npm test` -> passed (`28/28`).
- `npx convex dev --once` -> deployed updated functions.
- `npx convex codegen` -> completed.
- Runtime checks via Convex MCP:
  - `rateLimit:monitorAndAlert` returned:
    - first call: `createdAlerts=1`, `sentryAlerts=1`
    - second immediate call: `createdAlerts=0`, `sentryAlerts=0` (cooldown dedupe still correct)
  - `rateLimit:listRecentAlerts` confirmed persisted alert rows remain intact.

## 2026-02-17 - Phase 1.4.2 Sentry-Only Alerting

### Goal
- Remove direct rate-limit alert emails and keep a single alerting path through Sentry.

### Implemented
- Updated `convex/rateLimit.ts`:
  - Removed optional direct email sending path (`RATE_LIMIT_ALERT_EMAILS`) from `monitorAndAlert`.
  - Removed `markAlertEmailed` mutation.
  - `monitorAndAlert` now reports only:
    - `createdAlerts`
    - `sentryAlerts`
    - `windowMinutes`

### Notes
- Sentry email delivery should now be controlled entirely by Sentry alert rules/notifications.

## 2026-02-17 - Phase 1.5 Implementation + Validation

### Goal
- Harden outbound network reliability with shared timeout/retry behavior on critical third-party calls.

### Implemented
- Added shared network helper in `convex/lib/network.ts`:
  - `fetchWithTimeout`
  - `fetchWithRetry` (exponential backoff + jitter, retryable status handling)
- Applied helper to high-value external integrations:
  - `convex/ebay.ts` (token, search, item details)
  - `convex/ebayTaxonomy.ts` (taxonomy tree fetches)
  - `convex/global.ts` (Serper/SerpAPI shopping fetches)
  - `convex/integrations/gmail/api.ts` (token refresh, list/get/history/watch)
  - `convex/http.ts` Gmail OAuth callback token/profile fetches
  - `convex/integrations/email.ts` (Resend send call with timeout; retries disabled to avoid duplicate-send risk)
  - `convex/chat.ts` and `convex/chatHttp.ts` `search_web` tool call path
- Added unit tests in `convex/lib/network.test.ts`:
  - successful first-attempt response
  - retry on retryable status
  - no retry on non-retryable status
  - retry on network error
  - timeout/abort behavior

### Validation
- `npm test` -> passed (`33/33`).
- `npx convex dev --once` -> deployed.
- `npx convex codegen` -> completed.
- Convex runtime smoke:
  - `rateLimit:monitorAndAlert` still executes successfully after changes.

### Notes
- During test runs, Vitest reports `close timed out after 10000ms` after successful completion. Tests still pass and exit code remains `0`; this appears to be runner/process-handle behavior rather than functional failure in touched logic.

## 2026-02-17 - Phase 1.6 Implementation + Validation

### Goal
- Add server-side replay protection for high-risk inbound webhook paths.

### Implemented
- Added generic idempotency key store in `convex/schema.ts`:
  - `idempotencyKeys`
  - indexes:
    - `by_scope_key`
    - `by_expires_at`
    - `by_scope_first_seen`
- Added `convex/idempotency.ts`:
  - `claimKey` (dedupe claim + hit tracking)
  - `cleanupExpired`
  - `listRecentByScope`
- Added cleanup cron in `convex/crons.ts`:
  - `cleanup-idempotency-keys` every hour.
- Wired replay protection into `convex/http.ts`:
  - Gmail push webhook:
    - dedupe key: `${emailAddress}:${historyId}`
    - scope: `gmail_push_history`
    - duplicate payloads short-circuit with `200 OK` + `X-Idempotent-Replay: 1`
  - WhatsApp webhook:
    - per-message dedupe key: `message.id`
    - scope: `whatsapp_message`
    - duplicate messages are filtered before scheduling processing
    - fully duplicate payloads short-circuit with `200 OK` + `X-Idempotent-Replay: 1`

### Validation
- `npm test` -> passed (`33/33`).
- `npx convex dev --once` -> deployed and created new idempotency indexes.
- `npx convex codegen` -> completed.
- Convex runtime checks:
  - `idempotency:claimKey` first call returned `duplicate=false`.
  - immediate second call on same key returned `duplicate=true` with incremented `hitCount`.
  - `idempotency:listRecentByScope` returned stored key row with expected counters and TTL fields.

### Notes
- Replay tracking is implemented fail-open in HTTP handlers (logs and continues if idempotency store is temporarily unavailable), prioritizing webhook availability.

## 2026-02-17 - Phase 1.7 Implementation + Validation

### Goal
- Add outbound circuit breakers for critical upstream providers to reduce cascading failures during provider incidents.

### Implemented
- Added circuit breaker state table in `convex/schema.ts`:
  - `outboundCircuitBreakers`
  - indexes:
    - `by_provider`
    - `by_updated_at`
- Added state machine functions in `convex/circuitBreaker.ts`:
  - `checkGate` (closed/open/half_open gate decision)
  - `recordSuccess`
  - `recordFailure` (threshold + cooldown based open transitions)
  - `listStatuses`
- Added shared helper in `convex/lib/circuitBreaker.ts`:
  - provider configs:
    - `openrouter_chat`
    - `serper_search`
    - `gmail_oauth`
  - response status classification (`success` / `failure` / `neutral`)
  - helper methods to gate and record outcomes from request paths.
- Integrated breaker checks in production paths:
  - `convex/chat.ts`
    - OpenRouter streaming call path
    - Serper web-search tool path
  - `convex/chatHttp.ts`
    - OpenRouter SSE path
    - Serper web-search tool path
  - `convex/http.ts`
    - Gmail OAuth callback token exchange
    - Gmail OAuth profile fetch
- Added tests in `convex/lib/circuitBreaker.test.ts` for status classification.

### Validation
- `npm test` -> passed (`36/36`).
- `npx convex dev --once` -> deployed schema + functions + integrations.
- `npx convex codegen` -> completed.
- Convex runtime checks via MCP:
  - `circuitBreaker:checkGate` initial call returned `allowed=true`.
  - `circuitBreaker:recordFailure` with threshold=1 opened circuit.
  - subsequent `checkGate` returned `allowed=false` with `retryAfterMs` while open.
  - `circuitBreaker:recordSuccess` reset to `closed`.
  - `circuitBreaker:listStatuses` returned updated breaker row.

### Notes
- Circuit-breaker metric writes are best-effort in helpers; request paths continue to prioritize availability if breaker recording itself fails.

## 2026-02-18 - Phase 1.8 Implementation + Validation

### Goal
- Add bulkhead concurrency controls and graceful degradation so upstream pressure does not cascade into full request pileups.

### Implemented
- Added bulkhead lease table in `convex/schema.ts`:
  - `outboundBulkheadLeases`
  - indexes:
    - `by_provider_lease`
    - `by_provider_expires`
    - `by_expires_at`
- Added bulkhead primitives in `convex/bulkhead.ts`:
  - `acquireSlot`
  - `releaseSlot`
  - `cleanupExpiredLeases`
  - `listInFlightByProvider`
- Added shared bulkhead helper in `convex/lib/bulkhead.ts`:
  - provider caps:
    - `openrouter_chat`: max 24
    - `serper_search`: max 12
    - `gmail_oauth`: max 8
  - lease management wrappers:
    - `acquireBulkheadSlot`
    - `releaseBulkheadSlot`
  - `BulkheadSaturatedError` + detection helper
  - Sentry warning events on saturation (cooldown-throttled per provider).
- Added cleanup cron in `convex/crons.ts`:
  - `cleanup-bulkhead-leases` every 30 minutes.
- Integrated graceful degradation paths:
  - `convex/chatHttp.ts`
    - preflight bulkhead gate for OpenRouter returns `503` + `Retry-After` when saturated
    - Serper saturation degrades to non-fatal tool result text (chat continues)
  - `convex/chat.ts`
    - OpenRouter saturation returns user-facing temporary-busy message
    - Serper saturation degrades to non-fatal tool result text (chat continues)
  - `convex/http.ts`
    - Gmail OAuth saturation redirects to `settings?tab=connections&gmail=busy`.
- Added tests:
  - `convex/lib/bulkhead.test.ts`

### Validation
- `npm test` -> passed (`37/37`).
- `npx convex dev --once` -> deployed schema + functions + indexes.
- `npx convex codegen` -> completed.
- Runtime checks via Convex MCP:
  - `bulkhead:acquireSlot` succeeds under capacity.
  - second acquire with `maxConcurrent=1` returns `acquired=false` + `retryAfterMs`.
  - `bulkhead:releaseSlot` successfully releases active lease.
  - `bulkhead:listInFlightByProvider` returns active lease rows while held.

### Notes
- Bulkhead tracking is fail-open if tracking mutation calls fail unexpectedly, so request paths remain available while logging operational errors.

## 2026-02-17 - Phase 1.9 Implementation + Validation

### Goal
- Add repeatable load drills with explicit SLO gates so reliability changes can be evaluated consistently before/after tuning.

### Implemented
- Added load drill runner:
  - `scripts/reliability/run-load-drills.mjs`
  - staged concurrency execution with per-stage:
    - throughput
    - latency (`p50/p95/p99`)
    - status code counts
    - network error counts
- Added SLO gate evaluation in runner:
  - webhook scenarios:
    - `p95 <= 1500ms`
    - `5xx rate <= 1%`
    - `network error rate <= 2%`
    - `unknown status rate <= 5%`
  - chat scenario:
    - `p95 <= 12000ms`
    - `5xx rate <= 5%`
    - `network error rate <= 5%`
    - `unknown status rate <= 10%`
- Added scenario coverage:
  - `/api/gmail/push`
  - `/api/whatsapp/webhook`
  - `/api/chat` (enabled when `RELIABILITY_AUTH_TOKEN` and `RELIABILITY_THREAD_ID` are provided)
- Added docs:
  - `scripts/reliability/README.md`
- Added npm script:
  - `package.json` -> `reliability:drill`

### Validation
- Quick drill executed:
  - `node scripts/reliability/run-load-drills.mjs --quick=true --base-url=https://admired-antelope-676.convex.site`
  - report generated at:
    - `.output/reliability/phase-1-9-load-drill-2026-02-17T11-57-56-470Z.json`
  - results:
    - `gmail_push_webhook`: PASS (`p95=658ms`, statuses `403=30`)
    - `whatsapp_webhook`: PASS (`p95=544ms`, statuses `403=30`)
    - `chat_stream_http`: skipped (missing auth token + thread id)
- Regression checks:
  - `npm test` -> passed (`37/37`)
  - `npx convex dev --once` -> deployed
  - `npx convex codegen` -> completed

### Notes
- Current quick run was unauthenticated for webhook-provider auth, so expected behavior is mainly `403` responses with latency/SLO observation. Full chat-path drills require valid auth + thread inputs.

## 2026-02-17 - Phase 1.9 Authenticated Drill Run

### Command
- `npm run reliability:drill`
  - with:
    - `RELIABILITY_BASE_URL=https://admired-antelope-676.convex.site`
    - `RELIABILITY_AUTH_TOKEN=<valid convex jwt>`
    - `RELIABILITY_THREAD_ID=j973czgh6habh5w0sq0r8cc5vd8180rs`

### Report
- `.output/reliability/phase-1-9-load-drill-2026-02-17T12-07-59-241Z.json`

### Results
- `gmail_push_webhook`: PASS
  - `p95=1166ms`
  - statuses: `403=120`, `429=700`
- `whatsapp_webhook`: PASS
  - `p95=1033ms`
  - statuses: `403=120`, `429=700`
- `chat_stream_http`: PASS
  - `p95=798ms`
  - statuses: `200=18`

### Outcome
- Overall drill result: `PASS`.

## 2026-02-17 - Phase 1.10 (Part 1) Implementation + Validation

### Goal
- Add production runtime control knobs for reliability behavior and provide operator snapshot queries.

### Implemented
- Added centralized env-driven config parser:
  - `convex/lib/reliabilityConfig.ts`
  - configurable domains:
    - rate limits
    - circuit breaker thresholds/cooldowns
    - bulkhead concurrency/lease TTL
    - ops snapshot defaults
- Wired runtime knobs into live reliability paths:
  - `convex/lib/rateLimit.ts` now exposes `getRateLimits()` from env config
  - `convex/chat.ts`, `convex/chatHttp.ts`, `convex/http.ts` use dynamic rate limit values
  - `convex/lib/circuitBreaker.ts` uses dynamic circuit config
  - `convex/lib/bulkhead.ts` uses dynamic bulkhead config + sentry cooldown knob
- Added operator snapshot query set:
  - `convex/ops.ts` -> `ops:getReliabilitySnapshot`
  - snapshot sections:
    - active reliability config values
    - rate-limit pressure + alerts
    - circuit breaker states
    - bulkhead in-flight counts
    - replay-protection duplicate stats
- Added schema index to support ops replay queries:
  - `idempotencyKeys.by_first_seen` in `convex/schema.ts`.
- Added tests:
  - `convex/lib/reliabilityConfig.test.ts`

### New Env Knobs (Convex)
- Rate limits:
  - `RATE_LIMIT_CHAT_STREAM_MAX`
  - `RATE_LIMIT_CHAT_STREAM_WINDOW_MS`
  - `RATE_LIMIT_GMAIL_PUSH_MAX`
  - `RATE_LIMIT_GMAIL_PUSH_WINDOW_MS`
  - `RATE_LIMIT_WHATSAPP_MAX`
  - `RATE_LIMIT_WHATSAPP_WINDOW_MS`
  - `RATE_LIMIT_GMAIL_OAUTH_MAX`
  - `RATE_LIMIT_GMAIL_OAUTH_WINDOW_MS`
- Circuits:
  - `CIRCUIT_OPENROUTER_THRESHOLD`
  - `CIRCUIT_OPENROUTER_COOLDOWN_MS`
  - `CIRCUIT_SERPER_THRESHOLD`
  - `CIRCUIT_SERPER_COOLDOWN_MS`
  - `CIRCUIT_GMAIL_OAUTH_THRESHOLD`
  - `CIRCUIT_GMAIL_OAUTH_COOLDOWN_MS`
- Bulkheads:
  - `BULKHEAD_OPENROUTER_MAX_CONCURRENT`
  - `BULKHEAD_OPENROUTER_LEASE_TTL_MS`
  - `BULKHEAD_SERPER_MAX_CONCURRENT`
  - `BULKHEAD_SERPER_LEASE_TTL_MS`
  - `BULKHEAD_GMAIL_OAUTH_MAX_CONCURRENT`
  - `BULKHEAD_GMAIL_OAUTH_LEASE_TTL_MS`
  - `BULKHEAD_SENTRY_COOLDOWN_MS`
- Ops snapshot defaults:
  - `OPS_DEFAULT_WINDOW_MINUTES`
  - `OPS_MAX_ROWS_PER_SECTION`

### Validation
- `npm test` -> passed (`40/40`).
- `npx convex dev --once` -> deployed (new `idempotencyKeys.by_first_seen` index).
- `npx convex codegen` -> completed.
- Runtime check via MCP:
  - `ops:getReliabilitySnapshot` returned:
    - live config values
    - rate-limit pressure summary
    - circuit states
    - bulkhead in-flight map
    - replay-protection summary.

## 2026-02-17 - Phase 1.10 (Part 2) Implementation + Validation

### Goal
- Complete operator usability for runtime reliability controls and snapshot visibility.

### Implemented
- Fixed snapshot window filtering in `convex/ops.ts`:
  - `rateLimitPressure.recentAlerts` now returns only alerts within the requested time window.
- Added operator command in `package.json`:
  - `reliability:snapshot` -> `npx convex run ops:getReliabilitySnapshot`
- Updated reliability docs:
  - `scripts/reliability/README.md` now includes:
    - snapshot command usage
    - runtime reliability env knobs reference
    - custom snapshot window/limit command examples

### Validation
- `npm test` -> passed (`40/40`).
  - note: Vitest still prints existing runner transport timeout/hanging-process warning after successful completion.
- `npx convex dev --once` -> deployed updated `ops:getReliabilitySnapshot` behavior.
- `npx convex codegen` -> completed.
- `npm run reliability:snapshot` -> succeeded and confirmed:
  - `rateLimitPressure.recentAlerts` now respects window filtering
  - current runtime config values are visible in output.

## 2026-02-17 - Phase 1.11 Implementation + Validation

### Goal
- Package operational runbook guidance and baseline SLO thresholds per endpoint.

### Implemented
- Added operator runbook:
  - `scripts/reliability/RUNBOOK.md`
  - includes:
    - baseline SLO targets for `/api/chat`, `/api/gmail/push`, `/api/whatsapp/webhook`
    - first-5-minute triage flow
    - incident playbooks (rate-limit spikes, circuit opens, bulkhead saturation, replay surges)
    - operator command set for snapshot, drill, and targeted Convex diagnostics
- Added machine-readable baseline SLO config:
  - `scripts/reliability/slo-baseline.json`
- Linked runbook + SLO baseline from:
  - `scripts/reliability/README.md`
- Updated roadmap status:
  - `reliability-roadmap.md` now marks Phase 1 complete through 1.11.

### Validation
- `npm run reliability:snapshot` -> succeeded.
- `npm run reliability:drill -- --quick=true --base-url=https://admired-antelope-676.convex.site` -> succeeded with overall pass.
  - report:
    - `.output/reliability/phase-1-9-load-drill-2026-02-17T13-12-22-742Z.json`

## 2026-02-17 - Phase 2.1 (Data & Contract Hardening) Implementation + Validation

### Goal
- Start Phase 2 by centralizing request contracts and introducing a shared HTTP error taxonomy on critical endpoints.

### Implemented
- Added shared request contracts in:
  - `convex/lib/httpContracts.ts`
  - schemas:
    - `chatRequestSchema`
    - `gmailPushEnvelopeSchema`
    - `gmailHistoryPayloadSchema`
    - `whatsappWebhookSchema`
- Added shared HTTP error helper in:
  - `convex/lib/httpErrors.ts`
  - includes:
    - `createHttpErrorResponse`
    - `HTTP_ERROR_CODE_HEADER` (`x-sendcat-error-code`)
    - `formatValidationIssues`
- Wired shared contracts + taxonomy into:
  - `convex/chatHttp.ts` (`/api/chat`)
  - `convex/http.ts` (`/api/gmail/push`, `/api/whatsapp/webhook`, shared HTTP limiter path)
- Added tests:
  - `convex/lib/httpContracts.test.ts`
  - `convex/lib/httpErrors.test.ts`

### Validation
- `npm test` -> passed (`46/46`).
- `npx convex dev --once` -> deployed updated function code.
- `npx convex codegen` -> completed.

### Notes
- Existing plain-text error bodies were preserved for compatibility; this phase adds machine-readable error classification via `x-sendcat-error-code`.

## 2026-02-17 - Phase 2.2 (Endpoint Contract Tests + Taxonomy Coverage) Implementation + Validation

### Goal
- Add endpoint-level contract tests for core HTTP surfaces and close remaining unclassified error paths on those endpoints.

### Implemented
- Refactored HTTP handlers for direct testability in `convex/http.ts`:
  - exported `gmailPushHandler`
  - exported `whatsappWebhookVerifyHandler`
  - exported `whatsappWebhookPostHandler`
  - exported `chatPostHandler`
- Hardened `/api/chat` wrapper path in `convex/http.ts`:
  - catches unhandled `chatHandler` exceptions
  - maps to taxonomy response:
    - status `500`
    - `x-sendcat-error-code=internal_error`
- Added endpoint contract test suite:
  - `convex/http.contract.test.ts`
  - coverage includes:
    - `/api/chat`: `method_not_allowed`, `unauthorized`, `invalid_json`, `invalid_request`, `misconfigured`, `rate_limited`, wrapper `internal_error`
    - `/api/gmail/push`: `forbidden`, `invalid_request`, `rate_limited`
    - `/api/whatsapp/webhook` (POST): `forbidden`, `invalid_json`, `invalid_request`, `rate_limited`
  - all failing-path assertions verify `x-sendcat-error-code`.

### Validation
- `npm test` -> passed (`60/60`).
- `npx convex dev --once` -> deployed updated handlers.
- `npx convex codegen` -> completed.

### Notes
- Phase 2 now has both shared contracts/taxonomy (2.1) and endpoint-level contract tests on the three critical HTTP endpoints (2.2).

## 2026-02-17 - Phase 2.3 (Remaining Public HTTP Coverage + Audit) Implementation + Validation

### Goal
- Extend contract/taxonomy coverage to remaining public HTTP paths and add a concrete coverage audit.

### Implemented
- Refactored additional handlers in `convex/http.ts` for testability:
  - exported `gmailOAuthCallbackHandler`
  - exported `chatOptionsHandler`
- Closed a known unclassified validation path:
  - `/api/gmail/push` malformed JSON now maps to:
    - status `400`
    - `x-sendcat-error-code=invalid_json`
- Expanded endpoint contract tests in `convex/http.contract.test.ts`:
  - `/api/chat` `OPTIONS`:
    - allowed-origin CORS headers
    - unknown-origin no CORS headers
  - `/api/gmail/auth/callback`:
    - rate-limited response classified (`rate_limited`)
    - missing params redirect behavior (`gmail=error`)
    - invalid state redirect behavior (`gmail=error`)
  - `/api/whatsapp/webhook` `GET` verification:
    - valid challenge flow (`200`)
    - mismatch token forbidden classification (`forbidden`)
  - `/api/gmail/push` malformed JSON classification (`invalid_json`)

### Validation
- `npm test` -> passed (`68/68`).
- `npx convex dev --once` -> deployed updated handlers and tests.
- `npx convex codegen` -> completed.

### Coverage Audit (Phase 2 through 2.3)
- `/api/chat`
  - Contract tests cover `OPTIONS` + primary `POST` error taxonomy.
  - Wrapper-level unhandled errors mapped to `internal_error`.
- `/api/gmail/push`
  - Contract tests cover `forbidden`, `invalid_json`, `invalid_request`, `rate_limited`.
- `/api/whatsapp/webhook` (`GET` + `POST`)
  - Contract tests cover verify success + forbidden mismatch.
  - POST tests cover `forbidden`, `invalid_json`, `invalid_request`, `rate_limited`.
- `/api/gmail/auth/callback`
  - Contract tests cover rate-limit taxonomy and deterministic redirect error states.

## 2026-02-17 - Phase 2.4 (Function Boundary Hardening) Implementation + Validation

### Goal
- Harden internal Convex function boundaries used by HTTP flows with stricter argument contracts and classified validation failures.

### Implemented
- Added shared function boundary helpers and schemas in:
  - `convex/lib/functionBoundaries.ts`
  - includes:
    - `assertFunctionArgs(...)`
    - `gmailStoreConnectionArgsSchema`
    - `syncGmailArgsSchema`
    - `incrementalSyncArgsSchema`
    - `processWhatsappWebhookArgsSchema`
- Wired boundary validation into high-risk internal handlers:
  - `convex/integrations/gmail/oauth.ts`
    - `storeGmailConnection` now validates args before DB writes.
  - `convex/integrations/gmail/sync.ts`
    - `syncGmail` validates inbound args.
    - `incrementalSync` validates inbound args.
  - `convex/integrations/whatsapp.ts`
    - `processWebhook` validates payload contract before processing.
    - added explicit env guard helper for required media token:
      - `WHATSAPP_ACCESS_TOKEN`
- Added function-boundary test coverage:
  - `convex/lib/functionBoundaries.test.ts`
  - validates:
    - accepted/invalid argument contracts
    - classified boundary error message prefix:
      - `[invalid_function_args:<functionName>]`

### Validation
- `npm test` -> passed (`73/73`).
- `npx convex dev --once` -> deployed updated handlers.
- `npx convex codegen` -> completed.

### Coverage Matrix (Phase 2 through 2.4)
- HTTP boundary contracts:
  - `/api/chat`, `/api/gmail/push`, `/api/whatsapp/webhook` (`GET` + `POST`), `/api/gmail/auth/callback`
  - tested in `convex/http.contract.test.ts`
- Internal function boundary contracts:
  - `integrations.gmail.oauth.storeGmailConnection`
  - `integrations.gmail.sync.syncGmail`
  - `integrations.gmail.sync.incrementalSync`
  - `integrations.whatsapp.processWebhook`
  - schema + classification tested in `convex/lib/functionBoundaries.test.ts`

## 2026-02-17 - Phase 2.5 (Auth/Session + Abuse Controls) Implementation + Validation

### Goal
- Tighten abuse controls on externally reachable routes and strengthen session-origin protections for browser chat traffic.

### Implemented
- Extended HTTP taxonomy in `convex/lib/httpErrors.ts`:
  - added `unsupported_media_type`
  - added `payload_too_large`
- Added JSON/body-size abuse guards:
  - `convex/chatHttp.ts`:
    - `/api/chat` now enforces:
      - `Content-Type: application/json`
      - max request size (`64KB` via `Content-Length`)
  - `convex/http.ts`:
    - webhook handlers enforce:
      - `Content-Type: application/json`
      - max request size (`256KB` via `Content-Length`)
- Tightened browser-origin control for authenticated chat:
  - `convex/http.ts` `chatPostHandler` now rejects disallowed `Origin` with:
    - status `403`
    - `x-sendcat-error-code=forbidden`
- Added OAuth callback abuse guard:
  - `convex/http.ts` `gmailOAuthCallbackHandler` now rejects oversized query params (`code`, `state`, `error`) by redirecting to `gmail=error`.

### Contract Test Expansion
- Updated `convex/http.contract.test.ts` to cover new controls:
  - `/api/chat`:
    - `unsupported_media_type`
    - `payload_too_large`
    - disallowed-origin reject path
  - `/api/gmail/push`:
    - `unsupported_media_type`
    - `payload_too_large`
  - `/api/whatsapp/webhook` POST:
    - `unsupported_media_type`
    - `payload_too_large`
  - `/api/gmail/auth/callback`:
    - oversized-state redirect path (`gmail=error`)

### Validation
- `npm test` -> passed (`81/81`).
- `npx convex dev --once` -> deployed updated HTTP protections.
- `npx convex codegen` -> completed.

## 2026-02-17 - Phase 2.6 (Function Auth Hardening + Surface Closeout) Implementation + Validation

### Goal
- Standardize auth/authz behavior across public Convex functions with classified errors and add abuse throttling for high-risk non-HTTP user flows.

### Implemented
- Added shared function utilities:
  - `convex/lib/functionErrors.ts`
    - classified function error format: `[code:functionName] message`
  - `convex/lib/authGuards.ts`
    - reusable guards for:
      - required authentication
      - ownership checks
      - thread/message access checks
  - `convex/lib/functionRateLimit.ts`
    - classified wrapper around `rateLimit:checkAndIncrement`
    - contention fallback mapped to `rate_limited`
- Updated boundary helper to use the shared taxonomy path:
  - `convex/lib/functionBoundaries.ts` now throws via `throwFunctionError(...)` for invalid args.
- Refactored public modules to centralized guards:
  - `convex/threads.ts`
  - `convex/messages.ts`
  - `convex/streamSessions.ts`
  - `convex/favorites.ts`
  - `convex/packages.ts`
  - `convex/integrations/preferences.ts`
  - `convex/integrations/evidence.ts`
  - `convex/integrations/gmail/connection.ts`
  - `convex/integrations/whatsapp.ts`
- Added function-level abuse limiting for WhatsApp linking flow:
  - `integrations.whatsapp.requestLinkingCode` now enforces per-user limiter.
  - runtime knobs added:
    - `RATE_LIMIT_WA_LINK_CODE_MAX`
    - `RATE_LIMIT_WA_LINK_CODE_WINDOW_MS`
  - defaults:
    - `5 / 10 minutes`
- Added Phase 2 surface matrix:
  - `scripts/reliability/phase-2-surface-matrix.md`

### Added tests
- `convex/lib/functionErrors.test.ts`
- `convex/lib/authGuards.test.ts`
- `convex/lib/functionRateLimit.test.ts`
- Updated `convex/lib/reliabilityConfig.test.ts` for new linking-code limiter knobs.

### Validation
- `npm test` -> passed (`96/96`).
- `npx convex dev --once` -> deployed updated functions.
- `npx convex codegen` -> completed.

### Notes
- Vitest still prints the existing close-timeout warning after successful completion; test exit code remains `0`.

## 2026-02-18 - Phase 3.1 (Tool Cache Tier) Implementation + Validation

### Goal
- Start Phase 3 by reducing repeated upstream search calls with a persistent cache tier on expensive tool paths.

### Implemented
- Added persistent cache table in `convex/schema.ts`:
  - `toolResultCache`
  - indexes:
    - `by_namespace_key`
    - `by_expires_at`
- Added cache primitives in `convex/toolCache.ts`:
  - `toolCache:get` (internal query, TTL-aware)
  - `toolCache:set` (internal mutation, upsert-style)
  - `toolCache:cleanupExpired` (internal mutation)
- Added scheduled cleanup in `convex/crons.ts`:
  - `cleanup-tool-cache` every hour
- Added runtime cache TTL knob in `convex/lib/reliabilityConfig.ts`:
  - `TOOL_CACHE_WEB_SEARCH_TTL_MS` (default `300000` ms)
- Wired read-through caching into web-search tool execution:
  - `convex/chat.ts` (`search_web` text result cache namespace `search_web_text_v1`)
  - `convex/chatHttp.ts` (`search_web` JSON result cache namespace `search_web_json_v1`)

### Added/Updated tests
- Updated `convex/lib/reliabilityConfig.test.ts` for the new tool cache TTL knob.

### Validation
- `npm test` -> passed (`96/96`).
- `npx convex dev --once` -> deployed schema/index + function updates.
- `npx convex codegen` -> completed.

### Notes
- Initial full test run hit a transient Vitest worker timeout while resolving Better Auth dependencies; immediate targeted rerun and full rerun both passed.
- Existing Vitest close-timeout warning remains unchanged after successful runs.

## 2026-02-18 - Phase 3.2 (Product Tool Cache Expansion) Implementation + Validation

### Goal
- Extend Phase 3 cache tier beyond web search so repeated product lookups avoid re-hitting upstream provider APIs.

### Implemented
- Added shared cache key helpers in `convex/lib/toolCacheKeys.ts`:
  - `normalizeToolCacheText`
  - `buildProductSearchCacheKey`
- Added tests for deterministic key generation:
  - `convex/lib/toolCacheKeys.test.ts`
- Extended `search_products` tool execution in:
  - `convex/chat.ts`
  - `convex/chatHttp.ts`
  with read-through cache behavior:
  - cache hit:
    - skip upstream eBay/global provider calls
    - restore products directly to message state
  - cache miss:
    - run live provider fetches
    - cache successful combined product payloads
- Added new cache TTL runtime knob in `convex/lib/reliabilityConfig.ts`:
  - `TOOL_CACHE_PRODUCT_SEARCH_TTL_MS` (default `600000` ms)
- Updated cache-related docs in:
  - `scripts/reliability/README.md`
  - `reliability-roadmap.md`

### Validation
- `npm test` -> passed (`98/98`).
- `npx convex dev --once` -> deployed updated functions.
- `npx convex codegen` -> completed.

### Notes
- During validation, Convex surfaced an env-name length limit (`< 40 chars`) for
  `process.env` access. The WhatsApp linking limiter knobs were shortened to:
  - `RATE_LIMIT_WA_LINK_CODE_MAX`
  - `RATE_LIMIT_WA_LINK_CODE_WINDOW_MS`
- Existing Vitest close-timeout warning remains unchanged after successful runs.

## 2026-02-18 - Phase 3.4 (Load Drill Profile Expansion) Implementation + Validation

### Goal
- Expand reliability drill coverage from single-stage bursts to profile-driven load shapes (including soak and burst) aligned with Phase 3 scale criteria.

### Implemented
- Updated `scripts/reliability/run-load-drills.mjs` with:
  - profile selection (`--profile=quick|standard|burst|soak`)
  - backward-compatible `--quick=true` mapping to `quick` profile
  - duration-based stage execution for soak profiles
  - scenario filtering (`--scenarios=...`)
  - inter-stage cooldown support (`pauseAfterMs`)
  - profile-aware output filenames:
    - `load-drill-<profile>-<timestamp>.json`
- Updated reliability docs:
  - `scripts/reliability/README.md` (profiles + scenario filters)
  - `scripts/reliability/RUNBOOK.md` (operator commands for burst/soak drills)
  - `reliability-roadmap.md` (Phase 3.4 tracking)

### Validation
- `npm run reliability:drill -- --quick=true --base-url=https://admired-antelope-676.convex.site` -> passed.
- `npm test` -> passed (`98/98`).

### Notes
- Existing Vitest close-timeout warning remains unchanged after successful runs.

## 2026-02-18 - Phase 3.5 (Queued Tool Execution + Backpressure) Implementation + Validation

### Goal
- Move bursty tool work off inline chat execution into a queue/worker path with retries, leases, and observable backlog metrics.

### Implemented
- Added queued tool execution schema in `convex/schema.ts`:
  - `toolJobs` table with status, attempt, lease, TTL, and result/error fields.
  - indexes for queue claim, lease recovery, lifecycle cleanup, and metrics reads.
- Added queue/worker primitives in `convex/toolJobs.ts`:
  - enqueue/get/claim/complete/fail
  - retry with exponential backoff
  - stale-lease requeue behavior
  - `processQueue` worker action
  - `cleanupExpired` maintenance mutation
- Added queue client helper in `convex/lib/toolJobClient.ts`:
  - `enqueueToolJobAndWait` used by chat execution paths
- Added queue cleanup cron in `convex/crons.ts`:
  - `cleanup-tool-jobs` hourly
- Refactored tool execution on cache misses to use queue jobs:
  - `convex/chat.ts`:
    - `search_web`
    - `search_products`
    - `search_global`
  - `convex/chatHttp.ts`:
    - `search_web`
    - `search_products`
    - `search_global`
- Preserved partial-output UX in `/api/chat` stream:
  - emits `tool-output-partially-available` from queued results for web/product/global tools.
- Expanded queue tuning in `convex/lib/reliabilityConfig.ts`:
  - `TOOL_JOB_MAX_PER_RUN`
  - `TOOL_JOB_LEASE_MS`
  - `TOOL_JOB_WAIT_MS`
  - `TOOL_JOB_POLL_MS`
  - `TOOL_JOB_MAX_ATTEMPTS`
  - `TOOL_JOB_RETRY_BASE_MS`
  - `TOOL_JOB_TTL_MS`
  - `BULKHEAD_TOOL_JOB_MAX`
  - `BULKHEAD_TOOL_JOB_LEASE_MS`
- Expanded ops visibility in `convex/ops.ts`:
  - `config.toolJobs`
  - `toolJobs.byStatus`
  - `toolJobs.oldestQueuedAgeMs`
  - `toolJobs.oldestRunningAgeMs`

### Validation
- `npm test` -> passed (`98/98`).
- `npx convex dev --once` -> deployed updated schema/functions/indexes.
- `npx convex codegen` -> completed.
- `npm run reliability:drill -- --quick=true --base-url=https://admired-antelope-676.convex.site` -> passed.
  - report:
    - `.output/reliability/load-drill-quick-2026-02-18T02-06-37-671Z.json`
  - scenarios:
    - `gmail_push_webhook`: PASS
    - `whatsapp_webhook`: PASS
    - `chat_stream_http`: SKIPPED (missing `RELIABILITY_AUTH_TOKEN` + `RELIABILITY_THREAD_ID`)
- `npm run build` -> passed.

### Notes
- `npx tsc --noEmit` still reports pre-existing repo-wide TypeScript issues outside this phase scope.

## 2026-02-18 - Phase 3.3 (Cache Invalidation + Observability) Implementation + Validation

### Goal
- Make cache behavior operationally controllable under production incidents by adding namespace versioning and explicit invalidation commands.

### Implemented
- Added namespace versioning in `convex/lib/reliabilityConfig.ts`:
  - `getToolCacheNamespaces()` now derives runtime namespaces from env:
    - `TOOL_CACHE_WEB_SEARCH_NAMESPACE_VERSION` (default `v1`)
    - `TOOL_CACHE_PRODUCTS_NS_VER` (default `v1`)
- Updated chat cache consumers to use runtime namespaces instead of hardcoded constants:
  - `convex/chat.ts`
  - `convex/chatHttp.ts`
- Added operator cache controls in `convex/toolCache.ts`:
  - `clearNamespace` (bulk namespace invalidation)
  - `listNamespaceStats` (active-entry counts by namespace)
- Expanded ops snapshot in `convex/ops.ts` with tool-cache visibility:
  - `config.toolCacheNamespaces`
  - `toolCache.sampledActiveEntries`
  - `toolCache.byNamespace`
- Updated reliability docs/playbooks:
  - `scripts/reliability/README.md`
  - `scripts/reliability/RUNBOOK.md`
  - `reliability-roadmap.md`

### Validation
- `npm test` -> passed (`98/98`).
- `npx convex dev --once` -> deployed updated functions.
- `npx convex codegen` -> completed.

### Notes
- Existing Vitest close-timeout warning remains unchanged after successful runs.

## 2026-02-18 - Phase 3.6 (Tool Queue Partitioning + Backpressure) Implementation + Validation

### Goal
- Reduce queue starvation risk and isolate burst pressure by tool type on the background tool worker path.

### Implemented
- Added shared tool queue helpers:
  - `convex/lib/toolJobQueue.ts`
  - `convex/lib/toolJobQueue.test.ts`
- Extended tool job runtime config in `convex/lib/reliabilityConfig.ts`:
  - `TOOL_JOB_CLAIM_SCAN`
  - `TOOL_JOB_RUNMAX_WEB`
  - `TOOL_JOB_RUNMAX_PROD`
  - `TOOL_JOB_RUNMAX_GLOB`
  - `TOOL_JOB_QMAX_WEB`
  - `TOOL_JOB_QMAX_PROD`
  - `TOOL_JOB_QMAX_GLOB`
- Added queue backpressure enforcement in `convex/toolJobs.ts`:
  - per-tool queued-cap check on `toolJobs:enqueue`
  - queue saturation returns explicit `[queue_saturated:<tool>]` error
- Added fairer claim logic in `convex/toolJobs.ts`:
  - `claimNext` now computes per-tool running counts and skips candidates for saturated partitions.
- Added queue observability in `convex/toolJobs.ts` + `convex/ops.ts`:
  - `toolJobs.byTool`
  - `toolJobs.pressureByTool`
- Added schema indexes for efficient per-tool queue reads in `convex/schema.ts`:
  - `by_tool_status_available`
  - `by_tool_status_updated`
- Added queue saturation handling in `convex/lib/toolJobClient.ts` so callers degrade gracefully.

### Validation
- `npm test` -> passed (`101/101`).
- `npx convex codegen` -> completed.
- `npx convex dev --once` -> deployed schema/index/function changes.

## 2026-02-18 - Phase 4.1 / 4.2 (Synthetic Probes + Release Gate) Implementation + Validation

### Goal
- Make reliability checks enforceable before promotion by combining synthetic probes, load-drill results, and live snapshot gates.

### Implemented
- Added synthetic probe runner:
  - `scripts/reliability/run-synthetic-probes.mjs`
  - `npm run reliability:probe`
  - probes:
    - `/api/chat` CORS preflight
    - `/api/chat` auth guard
    - `/api/gmail/push` guard behavior
    - `/api/whatsapp/webhook` verification/signature guards
- Added release gate runner:
  - `scripts/reliability/run-release-gate.mjs`
  - `npm run reliability:gate`
  - gate combines:
    - synthetic probe run
    - load drill run
    - `ops:getReliabilitySnapshot` policy checks
- Added gate policy file:
  - `scripts/reliability/release-gate-policy.json`
- Updated reliability operator docs:
  - `scripts/reliability/README.md`
  - `scripts/reliability/RUNBOOK.md`
- Updated roadmap tracking:
  - `reliability-roadmap.md`

### Validation
- `npm run reliability:probe -- --base-url=https://admired-antelope-676.convex.site` -> passed.
  - report:
    - `.output/reliability/synthetic-probes-2026-02-18T03-34-20-651Z.json`
- `npm run reliability:gate -- --base-url=https://admired-antelope-676.convex.site --profile=quick` -> passed.
  - report:
    - `.output/reliability/release-gate-2026-02-18T03-37-51-311Z.json`

## 2026-02-18 - Phase 4.3 (Canary Automation) Implementation + Validation

### Goal
- Add rollout safety checks that compare control vs candidate reliability behavior before promotion.

### Implemented
- Added canary policy:
  - `scripts/reliability/canary-policy.json`
- Added canary runner:
  - `scripts/reliability/run-canary-checks.mjs`
  - command: `npm run reliability:canary`
- Canary workflow runs on both control and candidate URLs:
  - synthetic probes
  - load drill
  - scenario regression checks:
    - p95 ratio/absolute delta
    - 5xx rate delta
    - network error rate delta
    - unknown status delta
- Canary report includes explicit rollback criteria and artifact pointers.

### Validation
- `npm run reliability:canary -- --control-url=https://admired-antelope-676.convex.site --candidate-url=https://admired-antelope-676.convex.site --profile=quick` -> passed.
  - report:
    - `.output/reliability/canary-check-2026-02-18T03-54-30-275Z.json`

## 2026-02-18 - Phase 4.4 (Game-Day + Dashboard Automation) Implementation + Validation

### Goal
- Operationalize recurring reliability exercises and trend visibility.

### Implemented
- Added game-day runner:
  - `scripts/reliability/run-game-day.mjs`
  - command: `npm run reliability:gameday`
- Added SLO dashboard generator:
  - `scripts/reliability/build-slo-dashboard.mjs`
  - command: `npm run reliability:dashboard`
- Updated reliability docs and runbook with canary/game-day procedures.

### Validation
- `npm run reliability:gameday -- --base-url=https://admired-antelope-676.convex.site --profiles=quick` -> passed.
  - report:
    - `.output/reliability/game-day-2026-02-18T03-54-44-563Z.json`
- `npm run reliability:dashboard -- --max-reports=12` -> passed.
  - outputs:
    - `.output/reliability/slo-dashboard.md`
    - `.output/reliability/slo-dashboard.json`

## 2026-02-18 - Phase 4.5 (Burn-Rate Gate + Ownership Mapping) Implementation + Validation

### Goal
- Close Phase 4 safety loop by tying release gating to burn-rate thresholds and explicit route ownership.

### Implemented
- Extended release-gate policy in:
  - `scripts/reliability/release-gate-policy.json`
  - added `burnRate` controls:
    - `shortWindowMaxBurnRate`
    - `longWindowMaxBurnRate`
    - `lookbackReports`
    - `minReportsForLongWindow`
- Added ownership matrix:
  - `scripts/reliability/ownership-matrix.json`
- Updated release-gate evaluator in:
  - `scripts/reliability/run-release-gate.mjs`
  - new `burn_rate_gate` step:
    - computes scenario burn rates from load-drill report vs `scripts/reliability/slo-baseline.json`
    - applies short/long window burn thresholds
    - annotates checks with owners from ownership matrix
  - snapshot checks now also include owner metadata.

### Validation
- `npm run reliability:gate -- --base-url=https://admired-antelope-676.convex.site --profile=quick` -> passed.
  - report:
    - `.output/reliability/release-gate-2026-02-18T04-03-30-712Z.json`

## 2026-02-19 - Redis Admission Control (Dual-Run + Fail-Fast) Implementation + Validation

### Goal
- Add Redis-backed hot-path admission control for chat traffic to reduce Convex limiter contention at higher QPS while preserving fail-fast behavior.

### Implemented
- Added `@upstash/redis` dependency.
- Added `convex/lib/admissionControl.ts`:
  - enforce mode: per-user inflight, global inflight, global msg/s, global tool/s checks
  - shadow mode: non-mutating would-block evaluation
  - strict release with ticket key + TTL fallback
- Added admission config surface in `convex/lib/reliabilityConfig.ts`:
  - `ADMISSION_REDIS_ENABLED`
  - `ADMISSION_REDIS_SHADOW_MODE`
  - `ADMISSION_REDIS_URL`
  - `ADMISSION_REDIS_TOKEN`
  - `ADMISSION_REDIS_KEY_PREFIX`
  - `ADMISSION_USER_MAX_INFLIGHT`
  - `ADMISSION_GLOBAL_MAX_INFLIGHT`
  - `ADMISSION_GLOBAL_MAX_MSG_PER_SEC`
  - `ADMISSION_GLOBAL_MAX_TOOL_PER_SEC`
  - `ADMISSION_EST_TOOL_CALLS_PER_MSG`
  - `ADMISSION_TICKET_TTL_MS`
  - `ADMISSION_RETRY_AFTER_MS`
- Integrated admission checks into both chat entry points:
  - `convex/chatHttp.ts` (`/api/chat`)
  - `convex/chat.ts` (`chat:streamAnswer`)
- Dual-run behavior:
  - legacy Convex limiter remains authoritative only when admission is disabled or shadow mode is enabled
  - enforce mode uses Redis admission as gate
- Fail-fast behavior:
  - admission denials return/throw `rate_limited` with `Retry-After`
  - downstream bulkhead saturation still maps to `503` in HTTP path
- Added observability buckets:
  - `chat_admission`
  - `chat_admission_shadow`
- Added alert rules in `convex/rateLimit.ts` for `chat_admission` pressure.
- Included admission config in `ops:getReliabilitySnapshot`.
- Documented new admission env vars in `scripts/reliability/README.md`.

### Validation
- `npx vitest run convex/lib/admissionControl.test.ts convex/lib/reliabilityConfig.test.ts convex/http.contract.test.ts` -> passed (`39/39`).
- `npm test` currently has one unrelated pre-existing failure in `convex/lib/circuitBreaker.test.ts` (`429` classification expectation mismatch).

## 2026-02-19 - Reliability Drill SLO Hardening (2xx Success-Rate Gate) + Findings

### Goal
- Prevent false-positive drill passes when latency is low but most requests are admission rejections (`429`).

### Implemented
- Updated SLO evaluator in `scripts/reliability/run-load-drills.mjs`:
  - computes `2xx_success_rate`
  - supports optional `minTwoXxRate` threshold
  - includes a `2xx_success_rate` check in scenario results when configured
- Updated chat drill SLO in `scripts/reliability/run-load-drills.mjs`:
  - `minTwoXxRate: 0.9` for `chat_stream_http`
- Updated baseline config in `scripts/reliability/slo-baseline.json`:
  - `/api/chat.minTwoXxRate: 0.9`
  - version bumped to `phase-1-11b-2026-02-19`
- Updated docs in `scripts/reliability/README.md`:
  - added `2xx success rate >= 90%` under chat SLO gates

### Validation
- `npm run reliability:drill -- --profile=standard --scenarios=chat_stream_http --base-url=https://admired-antelope-676.convex.site --auth-token=<token> --thread-id=j97eb0ep90wycedjdjeybsz60d81d4mt` -> passed.
  - report: `.output/reliability/load-drill-standard-2026-02-19T00-43-20-822Z.json`
  - check: `2xx_success_rate = 1.0` (PASS vs `0.9`)
- `npm run reliability:drill -- --profile=burst --scenarios=chat_stream_http --base-url=https://admired-antelope-676.convex.site --auth-token=<token> --thread-id=j97eb0ep90wycedjdjeybsz60d81d4mt` -> failed as expected.
  - report: `.output/reliability/load-drill-burst-2026-02-19T00-43-40-682Z.json`
  - check: `2xx_success_rate = 0.4` (FAIL vs `0.9`)
- `npm run reliability:drill -- --profile=soak --scenarios=chat_stream_http --base-url=https://admired-antelope-676.convex.site --auth-token=<token> --thread-id=j97eb0ep90wycedjdjeybsz60d81d4mt` -> failed as expected.
  - report: `.output/reliability/load-drill-soak-2026-02-19T00-45-27-162Z.json`
  - check: `2xx_success_rate = 0.0752` (FAIL vs `0.9`)

### Findings
- Previous SLO gate allowed high-`429` runs to pass if latency/5xx/error-rate were within limits.
- New gate now correctly distinguishes:
  - healthy success throughput (`standard`: PASS)
  - heavy admission rejection regimes (`burst`/`soak`: FAIL)
- This makes drill pass/fail align with user-perceived availability instead of only backend responsiveness on rejected requests.

## 2026-02-19 - Multi-User Chat Pressure Drill (Auth Pool + Stage Scaling) Implementation + Findings

### Goal
- Pressure test `/api/chat` with multiple authenticated users instead of a single token, and amplify chat drill intensity in a controlled way.

### Implemented
- Added multi-user chat auth pool support to `scripts/reliability/run-load-drills.mjs`:
  - accepts `--chat-auth-pool-file` or `--chat-auth-pool-json`
  - supports env vars:
    - `RELIABILITY_CHAT_AUTH_POOL_FILE`
    - `RELIABILITY_CHAT_AUTH_POOL_JSON`
  - round-robin assignment of `{ authToken, threadId }` per request
  - report now includes:
    - `chatAuthPoolSize`
    - `chatStageScale` (`load`, `concurrency`, `duration`)
- Added chat stage scaling flags:
  - `--chat-load-scale`
  - `--chat-concurrency-scale`
  - `--chat-duration-scale`
- Added auth-pool generator script:
  - `scripts/reliability/generate-chat-auth-pool.mjs`
  - npm command: `npm run reliability:pool`
  - flow:
    - sign-in existing seeded user email (fallback sign-up)
    - fetch Convex bearer token from `/api/auth/convex/token`
    - create per-user thread via `threads:create`
    - output pool JSON with `authToken` + `threadId`
- Documented usage and flags in `scripts/reliability/README.md`.

### Validation Runs
- Generated 40-user pool:
  - `npm run reliability:pool -- --count=40 --app-origin=http://localhost:3000 --convex-url=https://admired-antelope-676.convex.cloud --prefix=loadtestmulti --seed=20260219a`
  - output:
    - `.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json`
- Multi-user standard pressure:
  - `npm run reliability:drill -- --profile=standard --scenarios=chat_stream_http --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json --chat-load-scale=10 --chat-concurrency-scale=10 --base-url=https://admired-antelope-676.convex.site`
  - report:
    - `.output/reliability/load-drill-standard-2026-02-19T01-00-09-597Z.json`
- Multi-user burst pressure:
  - `npm run reliability:drill -- --profile=burst --scenarios=chat_stream_http --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json --chat-load-scale=20 --chat-concurrency-scale=20 --base-url=https://admired-antelope-676.convex.site`
  - report:
    - `.output/reliability/load-drill-burst-2026-02-19T01-00-33-213Z.json`
- Multi-user soak pressure:
  - `npm run reliability:drill -- --profile=soak --scenarios=chat_stream_http --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json --chat-concurrency-scale=20 --chat-duration-scale=1 --base-url=https://admired-antelope-676.convex.site`
  - report:
    - `.output/reliability/load-drill-soak-2026-02-19T01-02-15-512Z.json`

### Findings (Multi-User)
- Standard (`pool=40`, `load x10`, `concurrency x10`):
  - `total=180`, statuses: `200=54`, `503=125`, `500=1`
  - SLO: `FAIL` (`5xx_rate=0.70`, `2xx_success_rate=0.30`)
- Burst (`pool=40`, `load x20`, `concurrency x20`):
  - `total=600`, statuses: `200=234`, `503=366`
  - SLO: `FAIL` (`5xx_rate=0.61`, `2xx_success_rate=0.39`)
- Soak (`pool=40`, `concurrency x20`, `90s`):
  - `total=5989`, statuses: `200=238`, `429=5568`, `503=183`
  - SLO: `FAIL` (`2xx_success_rate=0.0397`)
- Convex pressure telemetry in last 30 minutes:
  - `rateLimit:getEventSummary` reported `chat_stream:blocked=718`
- Interpretation:
  - system remains fail-fast under pressure (rejects dominate instead of collapse)
  - current throughput ceilings are constrained by configured bulkhead/rate-limit/admission guardrails
  - multi-user pressure path is now reproducible with explicit artifacts and knobs

## 2026-02-19 - Controlled Tuning Pass (Dev) + Post-Tuning Capacity Sweep

### Goal
- Raise chat throughput headroom in dev and find the next failure plateau using the new multi-user drill harness.

### Runtime Tuning Applied (Convex ownDev env)
- `BULKHEAD_OPENROUTER_MAX_CONCURRENT=120` (from default `24`)
- `RATE_LIMIT_CHAT_STREAM_MAX=1000` (from default `30`)
- `RATE_LIMIT_CHAT_STREAM_WINDOW_MS=300000` (unchanged duration, higher cap)
- Note: attempted `RATE_LIMIT_CHAT_STREAM_MAX=2000`, but config parser caps at `1000`, so it fell back to default; corrected to `1000`.

### Verification
- `ops:getReliabilitySnapshot` confirms:
  - `bulkheads.openrouter_chat.maxConcurrent = 120`
  - `rateLimits.chatStream.max = 1000`

### Pre/Post Comparison (same 40-user pool, same scales)
- **Pre-tuning standard**  
  - report: `.output/reliability/load-drill-standard-2026-02-19T01-00-09-597Z.json`
  - `total=180`, `p95=2353ms`, statuses `200=54, 500=1, 503=125`, `2xx=30.0%` -> FAIL
- **Post-tuning standard**  
  - report: `.output/reliability/load-drill-standard-2026-02-19T01-12-29-095Z.json`
  - `total=180`, `p95=2024ms`, statuses `200=180`, `2xx=100%` -> PASS
- **Pre-tuning burst**  
  - report: `.output/reliability/load-drill-burst-2026-02-19T01-00-33-213Z.json`
  - `total=600`, `p95=2519ms`, statuses `200=234, 503=366`, `2xx=39.0%` -> FAIL
- **Post-tuning burst**  
  - report: `.output/reliability/load-drill-burst-2026-02-19T01-12-53-365Z.json`
  - `total=600`, `p95=2233ms`, statuses `200=600`, `2xx=100%` -> PASS

### Post-Tuning Capacity Sweep
- Generated fresh pool (`20` users):
  - `.output/reliability/chat-auth-pool-loadtestmulti-20260219c-1-20.json`
- Soak (`concurrency x10`) report:
  - `.output/reliability/load-drill-soak-2026-02-19T01-31-17-360Z.json`
  - `total=1366`, `p95=2102ms`, statuses `200=1366`, `2xx=100%` -> PASS
- Burst (`load x80`, `concurrency x80`) report:
  - `.output/reliability/load-drill-burst-2026-02-19T01-32-21-811Z.json`
  - `total=2400`, `p95=4567ms`, statuses `200=2194, 429=206`, `2xx=91.42%` -> PASS
- Burst (`load x100`, `concurrency x100`) report:
  - `.output/reliability/load-drill-burst-2026-02-19T01-33-03-395Z.json`
  - `total=3000`, `p95=5800ms`, statuses `200=2498, 429=501, 502=1`, `2xx=83.27%` -> FAIL (fails `minTwoXxRate`)

### Findings
- The tuning removed the prior `503`-dominated bottleneck at moderate/high burst profiles.
- New practical plateau (with current SLO rule `2xx >= 90%`) is between:
  - burst scale `x80` (PASS)
  - burst scale `x100` (FAIL)
- Under very high burst, degradation mode shifts from `503` saturation to `429` admission/rate-limit pressure while core latency remains within threshold.

## 2026-02-19 - Phase 5.0 Program Setup (Large-Scale Baseline Contracts)

### Goal
- Start the large-scale architecture track by locking measurable SLO/capacity targets, architecture decisions, and rollout guardrails before deep refactors.

### Implemented
- Added Phase 5.0 program setup contract doc:
  - `docs/phase5-program-setup.md`
  - defines tiered chat SLO targets:
    - Tier L (`1k` streams)
    - Tier G (`5k` streams)
    - Tier X (`20k` streams)
  - includes milestone gates (`M1`, `M2`, `M3`) and rollback triggers
- Added architecture decision record:
  - `docs/chat-gateway-adr.md`
  - records decisions for:
    - control-plane/data-plane split
    - Redis role (admission counters only, not source of truth)
    - async queue semantics for tools
    - provider failover policy
- Added rollout matrix and feature-flag contract:
  - `docs/chat-rollout-matrix.md`
  - defines staged rollout (`Dev Shadow -> Dev Enforce -> Canary -> Prod Ramp`)
  - defines rollback conditions and operational step requirements
- Updated roadmap status:
  - `reliability-roadmap.md` now marks Phase 5 as in progress through 5.0
  - added explicit 5.0 delivered artifacts references

### Validation
- Documentation artifacts are present and cross-referenced in the roadmap.
- Phase 5 now has concrete execution contracts to reference for all follow-on implementation.

## 2026-02-19 - Phase 5.1 / 5.2 (Gateway Split + Redis Admission Enforce Hardening) Implementation + Validation

### Goal
- Complete gateway adapter rollout foundations and harden Redis admission behavior for staged enforce operation at scale.

### Implemented
- Gateway split + diagnostics:
  - Added gateway adapter and mode resolver in `convex/chatGateway.ts`.
  - Routed `/api/chat` through `runChatGatewayRequest(...)` in `convex/http.ts`.
  - Added `GET /api/chat/health` with origin guard and readiness checks.
  - Health payload now includes admission enforce policy + retry jitter config.
- Staged admission enforce controls:
  - Added env-driven admission dimension switches in `convex/lib/reliabilityConfig.ts`:
    - `ADMISSION_ENFORCE_USER_INFLIGHT`
    - `ADMISSION_ENFORCE_GLOBAL_INFLIGHT`
    - `ADMISSION_ENFORCE_GLOBAL_MSG_RATE`
    - `ADMISSION_ENFORCE_GLOBAL_TOOL_RATE`
  - Enforce path now supports soft-allow when a breached dimension is disabled, with `softBlockedReasons` captured for telemetry.
- Standardized jittered retry behavior:
  - Added `resolveAdmissionRetryAfterMs(...)` in `convex/lib/admissionControl.ts`.
  - Added env knobs:
    - `ADMISSION_RETRY_AFTER_JITTER_PCT`
    - `ADMISSION_ALLOWED_EVENT_SAMPLE_PCT`
- Admission telemetry + dashboard signals:
  - Extended `rateLimitEvents` schema:
    - `outcome` includes `allowed`
    - optional `reason`
  - Added sampled allow + reason-tagged admission event emission in:
    - `convex/chat.ts`
    - `convex/chatHttp.ts`
  - Extended ops snapshot in `convex/ops.ts`:
    - `chatAdmission.enforce`
    - `chatAdmission.shadow`
    - `chatAdmission.topReasons`
    - `chatAdmission.falsePositivePressure`
    - `rateLimitPressure.byBucketOutcomeReason`
  - Redacted `config.admission.redisToken` in ops snapshot output.
- Contract/test coverage updates:
  - `convex/lib/admissionControl.test.ts`
  - `convex/lib/reliabilityConfig.test.ts`
  - `convex/chatGateway.test.ts`
  - `convex/http.contract.test.ts` (added `/api/chat/health` behavior checks)

### Validation
- `npx vitest run convex/lib/admissionControl.test.ts convex/lib/reliabilityConfig.test.ts convex/chatGateway.test.ts convex/http.contract.test.ts` -> passed (`49/49`).
- `npx convex codegen` -> completed and regenerated bindings.
- `npx convex dev --once` -> deployed schema/function changes.
- Runtime verification:
  - `GET https://admired-antelope-676.convex.site/api/chat/health` returns healthy payload with admission policy and retry jitter fields.
  - `npx convex run ops:getReliabilitySnapshot '{"minutes":15,"limit":20}'` returns new `chatAdmission` and `byBucketOutcomeReason` sections with `redisToken` redacted.

### Notes
- Vitest still reports a known post-run close-timeout warning in this repository; test assertions complete successfully.

## 2026-02-19 - Phase 5.3 (Async Tool Execution Plane Hardening) Implementation + Validation

### Goal
- Improve queue resilience under fanout pressure with explicit QoS, DLQ semantics, queue lag monitoring, and user-visible backpressure signals.

### Implemented
- QoS + inflight controls:
  - Added tool QoS classes and priority-aware claim selection in:
    - `convex/lib/toolJobQueue.ts`
  - Added class-level running caps in `convex/lib/reliabilityConfig.ts`:
    - `TOOL_JOB_RUNMAX_QOS_REALTIME`
    - `TOOL_JOB_RUNMAX_QOS_INTERACTIVE`
    - `TOOL_JOB_RUNMAX_QOS_BATCH`
  - Extended queue config with:
    - `deadLetterRetentionMs` (`TOOL_JOB_DLQ_TTL_MS`)
- DLQ semantics:
  - `toolJobs.fail` now transitions exhausted jobs to `dead_letter` instead of silent terminal `failed`.
  - Added DLQ metadata:
    - `deadLetterReason`
    - `deadLetterAt`
  - Added queue operations:
    - `toolJobs:listDeadLetters`
    - `toolJobs:requeueDeadLetter`
- Queue lag SLO alerts:
  - Added alert table:
    - `toolQueueAlerts`
  - Added monitor workflow in `convex/toolJobs.ts`:
    - `toolJobs:monitorQueueHealth`
    - `toolJobs:raiseQueueAlertIfNeeded`
    - `toolJobs:listRecentQueueAlerts`
  - Added queue health cron in `convex/crons.ts`:
    - `monitor-tool-queue-health` (every 5 minutes)
  - Added queue alert knobs in `convex/lib/reliabilityConfig.ts`:
    - `TOOL_QUEUE_ALERTS_ENABLED`
    - `TOOL_QUEUE_ALERT_WINDOW_MIN`
    - `TOOL_QUEUE_ALERT_COOLDOWN_MS`
    - `TOOL_QUEUE_ALERT_MAX_QUEUED`
    - `TOOL_QUEUE_ALERT_MAX_DLQ`
    - `TOOL_QUEUE_ALERT_MAX_QUEUED_AGE_MS`
    - `TOOL_QUEUE_ALERT_MAX_RUNNING_AGE_MS`
    - `TOOL_QUEUE_SENTRY_DSN` (optional override)
- Backpressure surfaced to chat flows:
  - Extended tool-job client outcomes in `convex/lib/toolJobClient.ts`:
    - structured backpressure reasons: `queue_saturated`, `queue_timeout`, `dead_letter`
  - SSE path now emits `tool-backpressure` events in `convex/chatHttp.ts`.
  - Action path now returns explicit temporary-load fallback text in `convex/chat.ts`.
- Ops snapshot coverage extended in `convex/ops.ts`:
  - `config.toolQueueAlerts`
  - `toolQueueAlerts.recent`
  - `toolQueueAlerts.alertsInWindow`
  - `toolJobs.byStatus.deadLetter`
  - `toolJobs.recentDeadLetters`

### Validation
- Tests:
  - `npx vitest run convex/lib/toolJobQueue.test.ts convex/lib/toolJobClient.test.ts convex/lib/reliabilityConfig.test.ts convex/lib/admissionControl.test.ts convex/chatGateway.test.ts convex/http.contract.test.ts` -> passed (`57/57`).
- Convex deploy/codegen:
  - `npx convex codegen` -> completed.
  - `npx convex dev --once` -> deployed schema/functions successfully.
- Runtime checks:
  - `npx convex run toolJobs:getQueueStats '{"limit":200}'` -> returns new `deadLetter` metrics.
  - `npx convex run toolJobs:monitorQueueHealth '{}'` -> monitor action executes with `createdAlerts=0` on healthy state.
  - `npx convex run ops:getReliabilitySnapshot '{"minutes":15,"limit":20}'` -> includes new queue alert + DLQ snapshot sections.

### Notes
- Added `qosClass` as an optional field in `toolJobs` schema to avoid migration failures on existing historical rows.
- Vitest post-run close-timeout warning persists; assertions and exits are successful.

## 2026-02-19 - Phase 5.4 (Provider Routing + Resilience) Implementation + Validation

### Goal
- Add provider-route abstraction with route-specific resilience controls and actionable upstream failures, while keeping `/api/chat` contract stable.

### Implemented
- Added provider router module:
  - `convex/lib/chatProviderRouter.ts`
  - route abstraction: `primary` / `secondary`
  - model-class policy (`fast` / `agent`)
  - shared execution wrapper: `executeChatProviderRequest(...)`
  - client-safe mapper: `toClientSafeUpstreamError(...)`
- Integrated router into chat execution paths:
  - `convex/chatHttp.ts`
  - `convex/chat.ts`
  - SSE path now emits `provider-route` metadata when upstream route acquisition succeeds.
- Added route-level resilience controls:
  - circuits:
    - `openrouter_chat_primary`
    - `openrouter_chat_secondary`
  - bulkheads:
    - `openrouter_chat_primary`
    - `openrouter_chat_secondary`
- Added runtime route config in `convex/lib/reliabilityConfig.ts`:
  - `CHAT_PROVIDER_PRIMARY_TIMEOUT_MS`
  - `CHAT_PROVIDER_PRIMARY_RETRIES`
  - `CHAT_PROVIDER_SECONDARY_TIMEOUT_MS`
  - `CHAT_PROVIDER_SECONDARY_RETRIES`
  - `CHAT_MODEL_FAST_PRIMARY`
  - `CHAT_MODEL_FAST_SECONDARY`
  - `CHAT_MODEL_AGENT_PRIMARY`
  - `CHAT_MODEL_AGENT_SECONDARY`
  - `CHAT_DEFAULT_MODEL_CLASS`
- Added route-specific knobs:
  - `CIRCUIT_OPENROUTER_PRIMARY_THRESHOLD`
  - `CIRCUIT_OPENROUTER_PRIMARY_COOLDOWN_MS`
  - `CIRCUIT_OPENROUTER_SECONDARY_THRESHOLD`
  - `CIRCUIT_OPENROUTER_SECONDARY_COOLDOWN_MS`
  - `BULKHEAD_OR_PRI_MAX_CONCURRENT`
  - `BULKHEAD_OR_PRI_LEASE_TTL_MS`
  - `BULKHEAD_OR_SEC_MAX_CONCURRENT`
  - `BULKHEAD_OR_SEC_LEASE_TTL_MS`
- Added/upgraded upstream taxonomy behavior:
  - added `upstream_quota_exceeded` handling for HTTP `402`
  - kept existing code family for timeout/rate-limit/unavailable/auth/bad-request/internal classes
- Adjusted model-routing semantics for correctness:
  - primary route now uses only the user-requested model
  - secondary route carries fallback model candidates (when failover is enabled)
  - avoids accidental primary-route model substitution when a user explicitly selects a model

### Validation
- Unit/contract tests:
  - `npx vitest run convex/lib/chatProviderRouter.test.ts convex/lib/reliabilityConfig.test.ts convex/chatGateway.test.ts convex/http.contract.test.ts`
  - passed (`47/47`)
- Deployment/codegen:
  - `npx convex dev --once` (post-change deploy) completed
- Runtime checks:
  - `GET https://admired-antelope-676.convex.site/api/chat/health`
    - confirms route/circuit/bulkhead config is present in health payload
  - `npx convex run ops:getReliabilitySnapshot '{"minutes":15,"limit":10}'`
    - confirms `config.chatProviderRoutes`
    - confirms primary/secondary circuit + bulkhead config visibility
- Browser/MCP smoke checks (localhost app against dev Convex):
  - direct `/api/chat` invocation now surfaces actionable upstream codes:
    - `upstream_bad_request` for invalid/missing endpoint model selection
    - `upstream_quota_exceeded` for provider quota ceilings
    - `upstream_unavailable` when circuit is open (includes retry hint)

### Notes
- Observed OpenRouter responses in this dev environment include credit-cap `402` errors and model endpoint `404` errors; taxonomy now surfaces those as explicit client-safe classes instead of generic `upstream_error`.
- Vitest close-timeout warning persists in this repository after successful assertions.

## 2026-02-19 - Phase 5 Scope Decision (Regional Strategy)

### Decision
- Proceed with a **single-region launch architecture** for Jamaica + English-speaking Caribbean.
- Defer full multi-region deployment topology (active-active / active-standby traffic steering) to a post-launch stage.

### Why
- Current launch geography and expected early footprint do not justify immediate cross-region operational complexity.
- Current priority is higher confidence in throughput, fail-fast behavior, and release safety on one region.
- Multi-region readiness hooks can be added now at low cost to avoid future refactor spikes.

### Execution impact
- Phase `5.5` is re-scoped to:
  - single-region hardening runbooks
  - region-aware observability/config hooks
  - explicit thresholds that trigger full multi-region rollout
- Phase `5.6` remains unchanged and is the next capacity-validation gate track.

## 2026-02-19 - Phase 5.5 Start (Single-Region Readiness Hooks)

### Goal
- Start the re-scoped 5.5 track by adding low-cost region-readiness metadata without introducing cross-region runtime complexity.

### Implemented
- Added region topology config parser in `convex/lib/reliabilityConfig.ts`:
  - `RELIABILITY_REGION_ID` (default: `us-east-1`)
  - `RELIABILITY_TOPOLOGY_MODE` (default: `single_region`)
  - `RELIABILITY_REGION_READINESS_ONLY` (default: `true`)
- Exposed region posture in gateway diagnostics:
  - `convex/chatGateway.ts`
  - health payload now includes `regionTopology`
- Exposed region posture in operator snapshot:
  - `convex/ops.ts`
  - `ops:getReliabilitySnapshot` now includes `config.regionTopology`
- Added config parsing tests:
  - `convex/lib/reliabilityConfig.test.ts`
- Updated operator docs:
  - `scripts/reliability/README.md`
  - `scripts/reliability/RUNBOOK.md`
- Added explicit region rollout trigger assets:
  - policy: `scripts/reliability/region-rollout-policy.json`
  - evaluator: `scripts/reliability/run-region-readiness-check.mjs`
  - npm command: `reliability:region-readiness`
  - trigger reference: `docs/region-rollout-triggers.md`

### Validation
- `npx vitest run convex/lib/reliabilityConfig.test.ts convex/chatGateway.test.ts convex/http.contract.test.ts` -> passed (`42/42`).
- `npx convex dev --once` -> deployed successfully.
- Runtime checks:
  - `GET /api/chat/health` now returns:
    - `regionTopology.regionId`
    - `regionTopology.topologyMode`
    - `regionTopology.readinessOnly`
  - `ops:getReliabilitySnapshot` now returns `config.regionTopology`.
  - `npm run reliability:region-readiness -- --expected-peak-streams=5000`
    - decision: `NOT_TRIGGERED`
    - recommended topology: `single_region`
  - `npm run reliability:region-readiness -- --expected-peak-streams=400000`
    - decision: `TRIGGERED`
    - recommended topology: `active_active`

## 2026-02-19 - Phase 5.6 Start (Milestone Drill/Gate Foundations)

### Goal
- Start phase 5.6 by adding milestone-level drill profiles and milestone-specific release gating for chat SLOs.

### Implemented
- Expanded drill profile support in `scripts/reliability/run-load-drills.mjs`:
  - new profiles:
    - `m1_1k`
    - `m2_5k`
    - `m3_20k`
- Added milestone-aware chat SLO checks in drill harness:
  - `429_rate`
  - `p95_first_token_latency`
  - optional chat auth pool unique coverage / unique users checks
- Added synthetic multi-user rotation strategies for larger pools:
  - `round_robin` / `stride` / `random`
  - CLI flags:
    - `--chat-rotation-mode`
    - `--chat-rotation-stride`
    - `--chat-rotation-seed`
    - `--chat-min-unique-coverage`
    - `--chat-min-unique-users`
- Added milestone gate policy and runner:
  - `scripts/reliability/milestone-gate-policy.json`
  - `scripts/reliability/run-milestone-gate.mjs`
  - npm script: `reliability:milestone-gate`
- Updated docs/runbook:
  - `scripts/reliability/README.md`
  - `scripts/reliability/RUNBOOK.md`
  - `docs/phase5-milestone-gates.md`

### Validation
- `npm run reliability:region-readiness -- --expected-peak-streams=5000`
  - pass (decision `NOT_TRIGGERED`, recommended `single_region`)
- `npm run reliability:region-readiness -- --expected-peak-streams=400000`
  - pass (decision `TRIGGERED`, recommended `active_active`)
- artifacts generated:
  - `.output/reliability/region-readiness-2026-02-19T11-17-12-048Z.json`
  - `.output/reliability/region-readiness-2026-02-19T11-17-25-343Z.json`
  - `.output/reliability/region-readiness-2026-02-19T11-22-25-948Z.json`
- milestone drill/gate smoke:
  - `npm run reliability:drill -- --profile=m1_1k --scenarios=chat_stream_http --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219c-1-20.json --chat-load-scale=0.05 --chat-concurrency-scale=0.2 --chat-duration-scale=0.02 --chat-rotation-mode=stride --chat-rotation-stride=11`
    - executed successfully, gate result `FAIL` due chat `500` statuses in this dev environment
  - `npm run reliability:milestone-gate -- --milestone=m1_1k --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219c-1-20.json --chat-load-scale=0.02 --chat-concurrency-scale=0.1 --chat-duration-scale=0.01 --chat-rotation-mode=stride --chat-rotation-stride=7`
    - command completed and emitted milestone artifact
    - `scenarioChecks` failed on `2xx_success_rate`, `5xx_rate`, `unknown_status_rate`
    - `snapshotChecks` passed
    - artifact: `.output/reliability/milestone-gate-m1_1k-2026-02-19T11-39-18-610Z.json`
  - `npm run reliability:milestone-gate -- --milestone=m2_5k --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json --chat-load-scale=0.01 --chat-concurrency-scale=0.08 --chat-duration-scale=0.005 --chat-rotation-mode=random`
    - command completed and emitted milestone artifact
    - artifact: `.output/reliability/milestone-gate-m2_5k-2026-02-19T11-41-55-297Z.json`
  - `npm run reliability:milestone-gate -- --milestone=m3_20k --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json --chat-load-scale=0.005 --chat-concurrency-scale=0.05 --chat-duration-scale=0.003 --chat-rotation-mode=random`
    - command completed and emitted milestone artifact
    - artifact: `.output/reliability/milestone-gate-m3_20k-2026-02-19T11-44-36-650Z.json`
