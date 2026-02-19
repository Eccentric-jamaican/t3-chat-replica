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

## Phase 5 - Large-Scale Chat Architecture (In Progress, through 5.6 start)
Goal: Move from current reliability baseline to a large-scale, fail-fast, horizontally scalable chat platform.

Scope note:
- This phase builds on Redis admission + drill tooling already implemented on branch `feat/reliability-multiuser-pressure`.
- Work will be tracked here and in `reliability-phase-log.md` after each deliverable.

### 5.0 Program Setup (Start Here)
Goal: lock architecture contracts and rollout guardrails before refactor.

Deliverables:
- Define target SLOs for chat streaming by tier:
  - availability
  - p95 first-token latency
  - p95 stream completion latency
  - 429 budget
- Define capacity milestones:
  - M1: 1k concurrent streams
  - M2: 5k concurrent streams
  - M3: 20k concurrent streams
- Add architecture decision record (`docs/scale-caribbean.md` extension or new ADR file) covering:
  - control plane vs data plane separation
  - Redis role
  - queue semantics
  - provider failover policy
- Add feature flags and rollout matrix for every major path switch.

Exit criteria:
- Written target metrics + milestones approved.
- Rollback strategy documented per milestone.

### 5.1 Chat Gateway Split
Goal: isolate hot streaming path from app route/runtime constraints.

Deliverables:
- Introduce dedicated chat gateway module/service boundary:
  - auth verification
  - admission check
  - provider stream orchestration
  - stream lifecycle metrics
- Keep existing `/api/chat` contract stable; route requests through gateway adapter.
- Add health/ready diagnostics for gateway path.

Exit criteria:
- Functional parity with current `/api/chat`.
- Contract tests unchanged or expanded, no regressions.

### 5.2 Redis Admission Enforce Mode
Goal: make Redis admission authoritative for high-QPS protection.

Deliverables:
- Move from shadow to staged enforce rollout:
  - per-user inflight
  - global inflight
  - global msg/sec
  - global tool-call/sec
- Add jittered retry semantics and standardized `Retry-After`.
- Add dead-man safety behavior for Redis errors:
  - configurable fail-open/fail-closed by environment
- Add dashboards for:
  - allowed vs blocked
  - rejection reason distribution
  - false-positive pressure indicators

Exit criteria:
- Enforce mode active in dev/candidate with stable behavior under burst + soak.

### 5.3 Async Tool Execution Plane
Goal: keep chat stream fast by decoupling tool latency from stream lifecycle.

Deliverables:
- Harden tool-job queue path for high fanout:
  - explicit QoS per tool class
  - max inflight per class
  - bounded retries + DLQ semantics
- Add backpressure status surfaced to chat responses (graceful degradation).
- Add queue lag SLOs and alerts:
  - queue depth
  - oldest job age
  - worker saturation

Exit criteria:
- Tool spikes do not collapse chat stream success-rate SLO.

### 5.4 Provider Routing + Resilience
Goal: survive provider-side latency and outage variance.

Deliverables:
- Implement provider routing policy abstraction:
  - primary/secondary fallback
  - model class mapping (`fast`, `agent`, etc.)
- Add per-provider circuit + bulkhead + timeout policy sets.
- Add upstream failure taxonomy with actionable client-safe errors.

Exit criteria:
- Controlled failover works in canary drills with measurable recovery behavior.

### 5.5 Regional Readiness (Single-Region Launch)
Goal: harden a single-region launch footprint while keeping a low-cost path to multi-region later.

Decision (2026-02-19):
- Launch strategy remains single-region for Jamaica + English-speaking Caribbean.
- Full active-active/active-standby rollout is deferred post-launch.

Deliverables:
- Add region-aware config and observability without cross-region cutover:
  - region identity in reliability snapshots and logs
  - region-aware key prefix strategy for future partitioning
  - runbook updates for single-region fail-fast recovery
- Define explicit trigger conditions to activate full multi-region work:
  - sustained concurrency threshold
  - latency/regional SLA pressure
  - outage exposure threshold
- Keep failover policy and deployment topology ADR-ready for later activation.

Exit criteria:
- Single-region production runbook is complete and tested.
- Region-readiness hooks are in place with no contract regressions.
- Clear, documented thresholds exist for entering full multi-region implementation.

### 5.6 Scale Validation & Launch Gates
Goal: prove capacity with repeatable evidence before launch.

Deliverables:
- Expand drill harness profiles to milestone-level suites:
  - `m1_1k`, `m2_5k`, `m3_20k` target profiles
- Add synthetic multi-user auth pool rotation at larger pool sizes.
- Add release gates per milestone:
  - 2xx success-rate floor
  - p95 bounds
  - 5xx ceiling
  - 429 budget ceiling
- Capture all runs in `.output/reliability` + summarized in `reliability-phase-log.md`.

Exit criteria:
- Milestone gate passes for the target tier before promotion.

### Execution Rules For This Phase
- Do not remove existing guardrails; tune them with evidence.
- Every change must include:
  - code/config delta
  - drill result delta
  - rollback note
- Any failed drill blocks promotion until a follow-up fix is validated.

Delivered in 5.0:
- Program-level SLO and milestone contracts documented in:
  - `docs/phase5-program-setup.md`
- Architecture decision record documented in:
  - `docs/chat-gateway-adr.md`
- Feature-flag and rollout/rollback matrix documented in:
  - `docs/chat-rollout-matrix.md`

Delivered in 5.1:
- Added gateway adapter module:
  - `convex/chatGateway.ts`
  - mode resolution (`legacy`, `shadow`, `authoritative`)
  - gateway wrapper for `/api/chat` preserving contract while forwarding runtime options
- Routed `/api/chat` through gateway adapter in:
  - `convex/http.ts`
- Added gateway health diagnostics:
  - `GET /api/chat/health`
  - origin guard + optional health endpoint disable flag
  - readiness checks include OpenRouter key + Redis fail-closed requirements
- Added gateway-related contract/unit coverage:
  - `convex/chatGateway.test.ts`
  - expanded `convex/http.contract.test.ts` coverage for health route behavior

Delivered in 5.2:
- Added staged admission enforcement controls in Redis admission config:
  - `ADMISSION_ENFORCE_USER_INFLIGHT`
  - `ADMISSION_ENFORCE_GLOBAL_INFLIGHT`
  - `ADMISSION_ENFORCE_GLOBAL_MSG_RATE`
  - `ADMISSION_ENFORCE_GLOBAL_TOOL_RATE`
- Added standardized jittered admission retry behavior:
  - `ADMISSION_RETRY_AFTER_JITTER_PCT`
  - helper: `resolveAdmissionRetryAfterMs(...)` in `convex/lib/admissionControl.ts`
- Added sampled allow telemetry + reason tagging for chat admission:
  - `ADMISSION_ALLOWED_EVENT_SAMPLE_PCT`
  - `rateLimitEvents.outcome` now supports `allowed`
  - `rateLimitEvents.reason` now recorded for reason distribution
- Added chat admission observability in ops snapshot:
  - `chatAdmission.enforce`
  - `chatAdmission.shadow`
  - `chatAdmission.topReasons`
  - `chatAdmission.falsePositivePressure`
  - `rateLimitPressure.byBucketOutcomeReason`
- Hardened ops snapshot secret handling:
  - `config.admission.redisToken` now redacted.

Delivered in 5.3:
- Hardened async tool execution path with explicit QoS + DLQ semantics:
  - added QoS classes and priority-aware claim logic in:
    - `convex/lib/toolJobQueue.ts`
  - added class-level inflight controls:
    - `TOOL_JOB_RUNMAX_QOS_REALTIME`
    - `TOOL_JOB_RUNMAX_QOS_INTERACTIVE`
    - `TOOL_JOB_RUNMAX_QOS_BATCH`
  - bounded retry exhaustion now transitions jobs to `dead_letter`:
    - `toolJobs.status = dead_letter`
    - dead-letter metadata: `deadLetterReason`, `deadLetterAt`
  - added dead-letter operations:
    - `toolJobs:listDeadLetters`
    - `toolJobs:requeueDeadLetter`
- Added queue lag SLO alerting + cron monitoring:
  - new monitor action:
    - `toolJobs:monitorQueueHealth`
  - new alert table:
    - `toolQueueAlerts`
  - new alert knobs:
    - `TOOL_QUEUE_ALERTS_ENABLED`
    - `TOOL_QUEUE_ALERT_WINDOW_MIN`
    - `TOOL_QUEUE_ALERT_COOLDOWN_MS`
    - `TOOL_QUEUE_ALERT_MAX_QUEUED`
    - `TOOL_QUEUE_ALERT_MAX_DLQ`
    - `TOOL_QUEUE_ALERT_MAX_QUEUED_AGE_MS`
    - `TOOL_QUEUE_ALERT_MAX_RUNNING_AGE_MS`
    - `TOOL_QUEUE_SENTRY_DSN`
  - cron:
    - `monitor-tool-queue-health`
- Surfaced backpressure status into chat paths:
  - structured backpressure outcomes from `enqueueToolJobAndWait(...)` in:
    - `convex/lib/toolJobClient.ts`
  - HTTP SSE emits `tool-backpressure` events when queue is saturated/timeout/dead-lettered:
    - `convex/chatHttp.ts`
  - action path returns explicit temporary-load fallback messages:
    - `convex/chat.ts`
- Expanded reliability snapshot visibility:
  - `config.toolQueueAlerts`
  - `toolQueueAlerts` recent/in-window
  - `toolJobs.byStatus.deadLetter`
  - `toolJobs.recentDeadLetters`

Delivered in 5.4:
- Added provider routing abstraction for chat upstream calls:
  - `convex/lib/chatProviderRouter.ts`
  - model-class-aware route policy (`fast` / `agent`)
  - primary/secondary route composition gated by `FF_PROVIDER_FAILOVER_ENABLED`
- Wired route execution into both chat paths:
  - `convex/chatHttp.ts`
  - `convex/chat.ts`
  - HTTP SSE now emits `provider-route` metadata when upstream routing succeeds.
- Added per-route circuit/bulkhead policy sets:
  - circuit providers:
    - `openrouter_chat_primary`
    - `openrouter_chat_secondary`
  - bulkhead providers:
    - `openrouter_chat_primary`
    - `openrouter_chat_secondary`
- Added chat provider route runtime config in `convex/lib/reliabilityConfig.ts`:
  - `CHAT_PROVIDER_PRIMARY_TIMEOUT_MS`
  - `CHAT_PROVIDER_PRIMARY_RETRIES`
  - `CHAT_PROVIDER_SECONDARY_TIMEOUT_MS`
  - `CHAT_PROVIDER_SECONDARY_RETRIES`
  - `CHAT_MODEL_FAST_PRIMARY`
  - `CHAT_MODEL_FAST_SECONDARY`
  - `CHAT_MODEL_AGENT_PRIMARY`
  - `CHAT_MODEL_AGENT_SECONDARY`
  - `CHAT_DEFAULT_MODEL_CLASS`
- Added route-specific circuit and bulkhead env knobs:
  - `CIRCUIT_OPENROUTER_PRIMARY_THRESHOLD`
  - `CIRCUIT_OPENROUTER_PRIMARY_COOLDOWN_MS`
  - `CIRCUIT_OPENROUTER_SECONDARY_THRESHOLD`
  - `CIRCUIT_OPENROUTER_SECONDARY_COOLDOWN_MS`
  - `BULKHEAD_OR_PRI_MAX_CONCURRENT`
  - `BULKHEAD_OR_PRI_LEASE_TTL_MS`
  - `BULKHEAD_OR_SEC_MAX_CONCURRENT`
  - `BULKHEAD_OR_SEC_LEASE_TTL_MS`
- Expanded upstream error taxonomy with actionable client-safe codes:
  - `upstream_timeout`
  - `upstream_rate_limited`
  - `upstream_quota_exceeded`
  - `upstream_unavailable`
  - `upstream_bad_request`
  - `upstream_auth`
  - `upstream_error`
- Updated routing behavior to preserve model-selection intent:
  - primary route now sends only the explicitly requested model.
  - secondary route owns fallback model candidates when failover is enabled.
- Added/expanded verification coverage:
  - `convex/lib/chatProviderRouter.test.ts`
  - `convex/lib/reliabilityConfig.test.ts`
  - `convex/chatGateway.test.ts`
  - `convex/http.contract.test.ts`

Decision logged for 5.5 (2026-02-19):
- For launch, prioritize single-region hardening + multi-region readiness hooks.
- Defer full multi-region traffic steering/failover implementation until post-launch thresholds are met.

Started in 5.5:
- Added region-readiness runtime config in `convex/lib/reliabilityConfig.ts`:
  - `RELIABILITY_REGION_ID`
  - `RELIABILITY_TOPOLOGY_MODE`
  - `RELIABILITY_REGION_READINESS_ONLY`
- Surfaced region-readiness metadata in:
  - gateway health response (`convex/chatGateway.ts`)
  - reliability snapshot config (`convex/ops.ts`, `config.regionTopology`)
- Added coverage for region-readiness config parsing in:
  - `convex/lib/reliabilityConfig.test.ts`
- Added explicit rollout-trigger policy and evaluator:
  - policy file: `scripts/reliability/region-rollout-policy.json`
  - checker: `scripts/reliability/run-region-readiness-check.mjs`
  - npm command: `npm run reliability:region-readiness`
- Added regional trigger reference doc:
  - `docs/region-rollout-triggers.md`
- Updated operator docs:
  - `scripts/reliability/README.md`
  - `scripts/reliability/RUNBOOK.md`

Started in 5.6:
- Expanded load drill profiles for milestone tracks in:
  - `scripts/reliability/run-load-drills.mjs`
  - added profiles:
    - `m1_1k`
    - `m2_5k`
    - `m3_20k`
- Added chat milestone SLO checks in drill evaluation:
  - `429_rate`
  - `p95_first_token_latency`
  - chat auth pool unique-coverage checks
- Added larger-pool rotation strategies for synthetic multi-user chat drills:
  - `round_robin`
  - `stride`
  - `random`
  - configurable via `--chat-rotation-*` flags / `RELIABILITY_CHAT_ROTATION_*` envs
- Added milestone release gate tooling:
  - policy file: `scripts/reliability/milestone-gate-policy.json`
  - gate runner: `scripts/reliability/run-milestone-gate.mjs`
  - npm command: `npm run reliability:milestone-gate`
- Added phase-5.6 operator docs updates:
  - `scripts/reliability/README.md`
  - `scripts/reliability/RUNBOOK.md`
- Added milestone gate reference:
  - `docs/phase5-milestone-gates.md`
