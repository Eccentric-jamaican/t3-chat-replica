# Reliability Roadmap

As of 2026-02-17.

## Phase 1 - Baseline Hardening (Completed through 1.11)
Goal: Stop common failure modes and make reliability observable.

Delivered:
- Endpoint and chat rate limiting with contention-safe fallback behavior.
- Structured limiter telemetry + alerting into Sentry.
- Outbound timeout/retry wrappers for critical integrations.
- Replay/idempotency protection for inbound webhooks.
- Circuit breakers for OpenRouter, Serper, and Gmail OAuth.
- Bulkhead concurrency limits with graceful degradation.
- Repeatable load drills with SLO checks and JSON reports.
- Runtime reliability knobs via Convex env vars.
- Operator snapshot query: `ops:getReliabilitySnapshot`.

Delivered in 1.11:
- Operational runbook with incident playbooks and operator commands.
- Baseline endpoint SLO thresholds packaged in a machine-readable JSON file.

## Phase 2 - Data & Contract Hardening (Completed through 2.6)
Goal: Prevent bad data and inconsistent behavior at boundaries.

Planned work:
- Standardize `zod` schemas for all public HTTP and action/query payload boundaries.
- Add shared error taxonomy: validation, auth, rate-limit, upstream, internal.
- Enforce fail-closed behavior for security-critical routes, fail-open only where availability is intentional.
- Add contract tests for core endpoints (`/api/chat`, Gmail, WhatsApp).
- Add stricter auth/session checks and abuse controls on all externally reachable routes.

Exit criteria:
- Every public entrypoint has explicit input validation and typed error mapping.
- No unclassified 500s on known validation/auth failures.

Started in 2.1:
- Shared contracts in `convex/lib/httpContracts.ts`.
- Shared error taxonomy helper in `convex/lib/httpErrors.ts`.
- Taxonomy wiring on `/api/chat`, `/api/gmail/push`, and `/api/whatsapp/webhook`.

Delivered in 2.2:
- Endpoint-level contract tests in `convex/http.contract.test.ts`.
- Taxonomy coverage for unhandled `/api/chat` wrapper exceptions (`internal_error` mapping).

Delivered in 2.3:
- Remaining public HTTP contract coverage added for:
  - `/api/gmail/auth/callback`
  - `/api/whatsapp/webhook` `GET` verification
  - `/api/chat` `OPTIONS`
- `/api/gmail/push` malformed JSON now maps to `invalid_json` taxonomy response.

Delivered in 2.4:
- Shared function-boundary validation helpers in `convex/lib/functionBoundaries.ts`.
- Boundary enforcement added to:
  - `integrations.gmail.oauth.storeGmailConnection`
  - `integrations.gmail.sync.syncGmail`
  - `integrations.gmail.sync.incrementalSync`
  - `integrations.whatsapp.processWebhook`
- Function boundary contract tests in `convex/lib/functionBoundaries.test.ts`.

Delivered in 2.5:
- Abuse controls added for externally reachable routes:
  - strict JSON content-type enforcement
  - payload-size limits (`/api/chat`, webhook routes)
  - browser-origin enforcement on `/api/chat` POST
  - oversized OAuth callback query guard
- Taxonomy expanded with:
  - `unsupported_media_type`
  - `payload_too_large`

Delivered in 2.6:
- Shared function-level auth/error utilities:
  - `convex/lib/functionErrors.ts`
  - `convex/lib/authGuards.ts`
  - `convex/lib/functionRateLimit.ts`
- Public function auth/authz guards standardized across:
  - `threads.ts`
  - `messages.ts`
  - `streamSessions.ts`
  - `favorites.ts`
  - `packages.ts`
  - `integrations/preferences.ts`
  - `integrations/evidence.ts`
  - `integrations/gmail/connection.ts`
  - `integrations/whatsapp.ts`
- Added per-user abuse limiter for WhatsApp linking code requests:
  - defaults: `5 / 10 min`
  - env knobs:
    - `RATE_LIMIT_WA_LINK_CODE_MAX`
    - `RATE_LIMIT_WA_LINK_CODE_WINDOW_MS`
- Added Phase 2 surface coverage matrix:
  - `scripts/reliability/phase-2-surface-matrix.md`

## Phase 3 - Scale Architecture (In Progress, through 3.6)
Goal: Sustain higher load with predictable latency and lower incident risk.

Planned work:
- Introduce distributed cache/counter primitives (Redis/Upstash) only where Convex hot paths become bottlenecks.
- Add cache tiers + TTL/invalidation for expensive reads/tool results.
- Move long-running or bursty work to queued/background processing.
- Add workload partitioning and backpressure controls per provider/integration.
- Expand load drills to concurrency, soak, and burst profiles.

Technology decisions:
- `zod`: keep and expand (core boundary validation).
- `Redis/Upstash`: adopt selectively in hot paths (not blanket usage).
- `zustand`: frontend state tool only; not a backend reliability primitive.

Exit criteria:
- Defined capacity targets met under sustained load.
- P95 and error-rate targets hold during burst and soak drills.

Delivered in 3.1:
- Added persistent tool-response cache table:
  - `toolResultCache` (`namespace`, `key`, `value`, `expiresAt`)
- Added cache primitives:
  - `toolCache:get`
  - `toolCache:set`
  - `toolCache:cleanupExpired`
- Added hourly cache cleanup cron:
  - `cleanup-tool-cache`
- Wired read-through web-search caching into both chat execution paths:
  - `convex/chat.ts`
  - `convex/chatHttp.ts`
- Added runtime knob:
  - `TOOL_CACHE_WEB_SEARCH_TTL_MS` (default `5m`)

Delivered in 3.2:
- Expanded cache tier to product tool results:
  - shared cache key builder: `convex/lib/toolCacheKeys.ts`
  - read-through product cache integration in:
    - `convex/chat.ts`
    - `convex/chatHttp.ts`
  - shared product cache namespace:
    - `search_products_v1`
- Added runtime knob:
  - `TOOL_CACHE_PRODUCT_SEARCH_TTL_MS` (default `10m`)

Delivered in 3.3:
- Added cache namespace versioning controls:
  - `TOOL_CACHE_WEB_SEARCH_NAMESPACE_VERSION`
  - `TOOL_CACHE_PRODUCTS_NS_VER`
- Replaced hardcoded cache namespace strings in chat paths with env-driven namespace resolution:
  - `convex/chat.ts`
  - `convex/chatHttp.ts`
- Added operator cache controls in `convex/toolCache.ts`:
  - `toolCache:listNamespaceStats`
  - `toolCache:clearNamespace`
- Added tool cache visibility into `ops:getReliabilitySnapshot`:
  - `config.toolCacheNamespaces`
  - `toolCache.byNamespace`

Delivered in 3.4:
- Expanded load drill harness to support concurrency profiles:
  - `quick`
  - `standard`
  - `burst`
  - `soak`
- Added scenario filtering for targeted drills:
  - `--scenarios=gmail_push_webhook,whatsapp_webhook`
- Added duration-based stage execution support for soak profiles.
- Updated report naming to profile-aware outputs:
  - `.output/reliability/load-drill-<profile>-<timestamp>.json`

Delivered in 3.5:
- Added queued/background tool execution primitives:
  - `toolJobs` table in `convex/schema.ts`
  - `convex/toolJobs.ts` queue APIs (`enqueue`, `claimNext`, `complete`, `fail`, `processQueue`, `cleanupExpired`)
  - `convex/lib/toolJobClient.ts` enqueue-and-wait helper for chat paths
- Refactored chat tool execution to use the queue on cache misses:
  - `convex/chat.ts` (`search_web`, `search_products`, `search_global`)
  - `convex/chatHttp.ts` (`search_web`, `search_products`, `search_global`)
- Added queue operational visibility:
  - `ops:getReliabilitySnapshot` now includes `toolJobs` status/age metrics and `toolJobs` config block
- Added queue lifecycle maintenance:
  - hourly cron `cleanup-tool-jobs`
- Added runtime knobs:
  - `TOOL_JOB_MAX_PER_RUN`
  - `TOOL_JOB_LEASE_MS`
  - `TOOL_JOB_WAIT_MS`
  - `TOOL_JOB_POLL_MS`
  - `TOOL_JOB_MAX_ATTEMPTS`
  - `TOOL_JOB_RETRY_BASE_MS`
  - `TOOL_JOB_TTL_MS`
  - `BULKHEAD_TOOL_JOB_MAX`
  - `BULKHEAD_TOOL_JOB_LEASE_MS`

Delivered in 3.6:
- Added per-tool workload partitioning and queue backpressure controls:
  - runtime knobs:
    - `TOOL_JOB_CLAIM_SCAN`
    - `TOOL_JOB_RUNMAX_WEB`, `TOOL_JOB_RUNMAX_PROD`, `TOOL_JOB_RUNMAX_GLOB`
    - `TOOL_JOB_QMAX_WEB`, `TOOL_JOB_QMAX_PROD`, `TOOL_JOB_QMAX_GLOB`
- Added queue backpressure enforcement on enqueue:
  - saturating per-tool queue now returns explicit queue-saturated error.
- Added fairer claim behavior:
  - `claimNext` now honors per-tool running caps while scanning ready jobs.
- Added per-tool queue observability in queue stats and ops snapshot:
  - `toolJobs.byTool`
  - `toolJobs.pressureByTool`

## Phase 4 - SLO Automation & Release Safety (In Progress, through 4.5)
Goal: Make reliability enforceable during operations and deployment.

Planned work:
- SLO/error-budget dashboards and burn-rate alerts.
- Synthetic probes for critical user flows.
- Reliability deployment gates (canary checks, rollback criteria).
- Incident playbooks tied to real metrics and ownership.
- Scheduled game days/drills with recorded outcomes.

Delivered in 4.1:
- Added synthetic probe runner:
  - `scripts/reliability/run-synthetic-probes.mjs`
  - command: `npm run reliability:probe`
- Probe coverage:
  - `/api/chat` CORS preflight
  - `/api/chat` auth guard
  - `/api/gmail/push` guard behavior
  - `/api/whatsapp/webhook` verification + signature guard behavior
- Probe artifacts:
  - `.output/reliability/synthetic-probes-<timestamp>.json`

Delivered in 4.2:
- Added release gate automation:
  - `scripts/reliability/run-release-gate.mjs`
  - command: `npm run reliability:gate`
- Gate workflow combines:
  - synthetic probes
  - load drill execution
  - live `ops:getReliabilitySnapshot` checks
- Added release gate policy file:
  - `scripts/reliability/release-gate-policy.json`
- Gate artifacts:
  - `.output/reliability/release-gate-<timestamp>.json`

Delivered in 4.3:
- Added canary comparison automation:
  - `scripts/reliability/run-canary-checks.mjs`
  - command: `npm run reliability:canary`
- Canary regression policy file:
  - `scripts/reliability/canary-policy.json`
- Canary compares control vs candidate across:
  - synthetic probe pass/fail
  - load-drill scenario deltas (p95/5xx/network/unknown rates)
  - explicit rollback criteria in report
- Canary artifacts:
  - `.output/reliability/canary-check-<timestamp>.json`

Delivered in 4.4:
- Added game-day automation runner:
  - `scripts/reliability/run-game-day.mjs`
  - command: `npm run reliability:gameday`
- Added SLO dashboard generator from recent reliability artifacts:
  - `scripts/reliability/build-slo-dashboard.mjs`
  - command: `npm run reliability:dashboard`
- Dashboard/game-day artifacts:
  - `.output/reliability/game-day-<timestamp>.json`
  - `.output/reliability/slo-dashboard.md`
  - `.output/reliability/slo-dashboard.json`

Delivered in 4.5:
- Added burn-rate gating into release promotion:
  - release gate now computes scenario burn rates from load-drill metrics vs `slo-baseline.json`
  - short-window + long-window burn thresholds configured in `scripts/reliability/release-gate-policy.json`
- Added explicit reliability ownership mapping:
  - `scripts/reliability/ownership-matrix.json`
  - release-gate checks now include owner metadata for faster escalation.

Exit criteria:
- Releases are gated by live reliability signals.
- Runbooks and rollback actions are tested, not just documented.
