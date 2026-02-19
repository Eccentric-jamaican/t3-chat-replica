# Phase 1.9 Load Drills

This folder contains a repeatable reliability load harness for Sendcat HTTP entrypoints.

Operational docs:

- `scripts/reliability/RUNBOOK.md` (Phase 1.11 incident runbook)
- `scripts/reliability/slo-baseline.json` (baseline SLO thresholds by endpoint)

## Run

```bash
npm run reliability:drill
```

```bash
npm run reliability:snapshot
```

```bash
npm run reliability:probe
```

```bash
npm run reliability:gate
```

```bash
npm run reliability:milestone-gate -- --milestone=m1_1k
```

```bash
npm run reliability:canary
```

```bash
npm run reliability:gameday
```

```bash
npm run reliability:dashboard
```

Region readiness trigger check (single-region launch -> multi-region program gate):

```bash
npm run reliability:region-readiness -- --expected-peak-streams=5000
```

Policy and outputs:

- policy: `scripts/reliability/region-rollout-policy.json`
- report: `.output/reliability/region-readiness-<timestamp>.json`
- milestone gate policy: `scripts/reliability/milestone-gate-policy.json`

Generate a multi-user chat auth pool (for pressure tests):

```bash
npm run reliability:pool -- --count=40 --app-origin=http://localhost:3000 --convex-url=https://admired-antelope-676.convex.cloud --prefix=loadtestmulti --seed=20260219a
```

Quick smoke:

```bash
npm run reliability:drill -- --quick=true
```

Profiled runs:

```bash
npm run reliability:drill -- --profile=standard
npm run reliability:drill -- --profile=burst
npm run reliability:drill -- --profile=soak
npm run reliability:drill -- --profile=m1_1k --scenarios=chat_stream_http
npm run reliability:drill -- --profile=m2_5k --scenarios=chat_stream_http
npm run reliability:drill -- --profile=m3_20k --scenarios=chat_stream_http
```

Run specific scenario(s):

```bash
npm run reliability:drill -- --scenarios=chat_stream_http
npm run reliability:drill -- --scenarios=gmail_push_webhook,whatsapp_webhook
```

Multi-user chat pressure drill (round-robin token/thread pool):

```bash
npm run reliability:drill -- --profile=burst --scenarios=chat_stream_http --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json --chat-load-scale=20 --chat-concurrency-scale=20
```

Chat pool rotation modes:

```bash
npm run reliability:drill -- --profile=m1_1k --scenarios=chat_stream_http --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json --chat-rotation-mode=stride --chat-rotation-stride=11
```

Release gate (synthetic probes + load drill + live snapshot checks):

```bash
npm run reliability:gate -- --profile=quick
npm run reliability:gate -- --profile=standard --minutes=20 --limit=150
```

Milestone gates (Phase 5.6):

```bash
npm run reliability:milestone-gate -- --milestone=m1_1k --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219c-1-20.json --chat-load-scale=0.5 --chat-concurrency-scale=0.5
npm run reliability:milestone-gate -- --milestone=m2_5k --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219a-1-40.json
```

Canary comparison (control vs candidate):

```bash
npm run reliability:canary -- --control-url=https://control.convex.site --candidate-url=https://candidate.convex.site --profile=quick
```

Game-day drill bundle:

```bash
npm run reliability:gameday -- --profiles=burst,soak
```

Custom base URL:

```bash
npm run reliability:drill -- --base-url=https://admired-antelope-676.convex.site
```

## Environment Variables

- `RELIABILITY_BASE_URL`: Convex site URL used for HTTP load drills.
- `RELIABILITY_AUTH_TOKEN`: Better Auth bearer token for `/api/chat` load scenario.
- `RELIABILITY_THREAD_ID`: existing thread id for `/api/chat`.
- `RELIABILITY_CHAT_AUTH_POOL_FILE`: optional JSON file containing `{ authToken, threadId }[]` for multi-user chat drills.
- `RELIABILITY_CHAT_AUTH_POOL_JSON`: optional JSON array (same shape) as inline alternative.
- `RELIABILITY_EXPECTED_PEAK_STREAMS`: optional business forecast used by `reliability:region-readiness`.
- `RELIABILITY_CHAT_ROTATION_MODE`: `round_robin`, `stride`, or `random` (default `round_robin`).
- `RELIABILITY_CHAT_ROTATION_STRIDE`: stride step for `stride` mode.
- `RELIABILITY_CHAT_ROTATION_SEED`: deterministic seed for `stride`/`random`.
- `RELIABILITY_CHAT_MIN_UNIQUE_COVERAGE`: optional override for pool-coverage SLO checks.
- `RELIABILITY_CHAT_MIN_UNIQUE_USERS`: optional absolute unique-user floor for chat drills.
- `GMAIL_PUBSUB_VERIFY_TOKEN`: optional; when present the Gmail push drill sends the query token.
- `WHATSAPP_APP_SECRET`: optional; when present WhatsApp drill signs payloads.

### Chat stage scaling flags (CLI)

- `--chat-load-scale=<number>`: multiplies chat stage request totals.
- `--chat-concurrency-scale=<number>`: multiplies chat stage concurrency.
- `--chat-duration-scale=<number>`: multiplies chat stage duration.
- `--chat-rotation-mode=<round_robin|stride|random>`: auth-pool selection strategy.
- `--chat-rotation-stride=<number>`: stride step for `stride` mode.
- `--chat-rotation-seed=<string>`: deterministic seed for `stride`/`random`.
- `--chat-min-unique-coverage=<0-1>`: enforce minimum pool coverage for chat scenario.
- `--chat-min-unique-users=<number>`: enforce minimum unique users touched.

## Runtime Reliability Knobs (Convex env vars)

- Rate limits:
  - `RATE_LIMIT_CHAT_STREAM_MAX`, `RATE_LIMIT_CHAT_STREAM_WINDOW_MS`
  - `RATE_LIMIT_GMAIL_PUSH_MAX`, `RATE_LIMIT_GMAIL_PUSH_WINDOW_MS`
  - `RATE_LIMIT_WHATSAPP_MAX`, `RATE_LIMIT_WHATSAPP_WINDOW_MS`
  - `RATE_LIMIT_GMAIL_OAUTH_MAX`, `RATE_LIMIT_GMAIL_OAUTH_WINDOW_MS`
  - `RATE_LIMIT_WA_LINK_CODE_MAX`, `RATE_LIMIT_WA_LINK_CODE_WINDOW_MS`
- Circuits:
  - `CIRCUIT_OPENROUTER_THRESHOLD`, `CIRCUIT_OPENROUTER_COOLDOWN_MS`
  - `CIRCUIT_OPENROUTER_PRIMARY_THRESHOLD`, `CIRCUIT_OPENROUTER_PRIMARY_COOLDOWN_MS`
  - `CIRCUIT_OPENROUTER_SECONDARY_THRESHOLD`, `CIRCUIT_OPENROUTER_SECONDARY_COOLDOWN_MS`
  - `CIRCUIT_SERPER_THRESHOLD`, `CIRCUIT_SERPER_COOLDOWN_MS`
  - `CIRCUIT_GMAIL_OAUTH_THRESHOLD`, `CIRCUIT_GMAIL_OAUTH_COOLDOWN_MS`
  - `CIRCUIT_EBAY_THRESHOLD`, `CIRCUIT_EBAY_COOLDOWN_MS`
  - `CIRCUIT_GLOBAL_SEARCH_THRESHOLD`, `CIRCUIT_GLOBAL_SEARCH_COOLDOWN_MS`
- Bulkheads:
  - `BULKHEAD_OPENROUTER_MAX_CONCURRENT`, `BULKHEAD_OPENROUTER_LEASE_TTL_MS`
  - `BULKHEAD_OR_PRI_MAX_CONCURRENT`, `BULKHEAD_OR_PRI_LEASE_TTL_MS`
  - `BULKHEAD_OR_SEC_MAX_CONCURRENT`, `BULKHEAD_OR_SEC_LEASE_TTL_MS`
  - `BULKHEAD_SERPER_MAX_CONCURRENT`, `BULKHEAD_SERPER_LEASE_TTL_MS`
  - `BULKHEAD_GMAIL_OAUTH_MAX_CONCURRENT`, `BULKHEAD_GMAIL_OAUTH_LEASE_TTL_MS`
  - `BULKHEAD_EBAY_MAX_CONCURRENT`, `BULKHEAD_EBAY_LEASE_TTL_MS`
  - `BULKHEAD_GLOBAL_SEARCH_MAX_CONCURRENT`, `BULKHEAD_GLOBAL_SEARCH_LEASE_TTL_MS`
  - `BULKHEAD_SENTRY_COOLDOWN_MS`
- Chat provider routing:
  - `CHAT_PROVIDER_PRIMARY_TIMEOUT_MS`
  - `CHAT_PROVIDER_PRIMARY_RETRIES`
  - `CHAT_PROVIDER_SECONDARY_TIMEOUT_MS`
  - `CHAT_PROVIDER_SECONDARY_RETRIES`
  - `CHAT_MODEL_FAST_PRIMARY`
  - `CHAT_MODEL_FAST_SECONDARY`
  - `CHAT_MODEL_AGENT_PRIMARY`
  - `CHAT_MODEL_AGENT_SECONDARY`
  - `CHAT_DEFAULT_MODEL_CLASS`
- Regional readiness (single-region launch mode):
  - `RELIABILITY_REGION_ID`
  - `RELIABILITY_TOPOLOGY_MODE` (`single_region`, `active_standby`, `active_active`)
  - `RELIABILITY_REGION_READINESS_ONLY`
- Redis admission control:
  - `ADMISSION_REDIS_ENABLED`
  - `ADMISSION_REDIS_SHADOW_MODE`
  - `ADMISSION_REDIS_URL`
  - `ADMISSION_REDIS_TOKEN`
  - `ADMISSION_REDIS_KEY_PREFIX`
  - `ADMISSION_ENFORCE_USER_INFLIGHT`
  - `ADMISSION_ENFORCE_GLOBAL_INFLIGHT`
  - `ADMISSION_ENFORCE_GLOBAL_MSG_RATE`
  - `ADMISSION_ENFORCE_GLOBAL_TOOL_RATE`
  - `ADMISSION_USER_MAX_INFLIGHT`
  - `ADMISSION_GLOBAL_MAX_INFLIGHT`
  - `ADMISSION_GLOBAL_MAX_MSG_PER_SEC`
  - `ADMISSION_GLOBAL_MAX_TOOL_PER_SEC`
  - `ADMISSION_EST_TOOL_CALLS_PER_MSG`
  - `ADMISSION_TICKET_TTL_MS`
  - `ADMISSION_RETRY_AFTER_MS`
  - `ADMISSION_RETRY_AFTER_JITTER_PCT`
  - `ADMISSION_ALLOWED_EVENT_SAMPLE_PCT`
- Chat gateway rollout flags:
  - `FF_CHAT_GATEWAY_ENABLED`
  - `FF_CHAT_GATEWAY_SHADOW`
  - `FF_ADMISSION_ENFORCE`
  - `FF_TOOL_QUEUE_ENFORCE`
  - `FF_PROVIDER_FAILOVER_ENABLED`
  - `FF_FAIL_CLOSED_ON_REDIS_ERROR`
  - `FF_CHAT_GATEWAY_HEALTH_ENABLED`
- Snapshot defaults:
  - `OPS_DEFAULT_WINDOW_MINUTES`, `OPS_MAX_ROWS_PER_SECTION`
- Tool cache:
  - `TOOL_CACHE_WEB_SEARCH_TTL_MS`
  - `TOOL_CACHE_PRODUCT_SEARCH_TTL_MS`
  - `TOOL_CACHE_WEB_SEARCH_NAMESPACE_VERSION`
  - `TOOL_CACHE_PRODUCTS_NS_VER`
- Tool job queue:
  - `TOOL_JOB_MAX_PER_RUN`
  - `TOOL_JOB_LEASE_MS`
  - `TOOL_JOB_WAIT_MS`
  - `TOOL_JOB_POLL_MS`
  - `TOOL_JOB_MAX_ATTEMPTS`
  - `TOOL_JOB_RETRY_BASE_MS`
  - `TOOL_JOB_TTL_MS`
  - `TOOL_JOB_CLAIM_SCAN`
  - `BULKHEAD_TOOL_JOB_MAX`
  - `BULKHEAD_TOOL_JOB_LEASE_MS`
  - `TOOL_JOB_RUNMAX_WEB`
  - `TOOL_JOB_RUNMAX_PROD`
  - `TOOL_JOB_RUNMAX_GLOB`
  - `TOOL_JOB_RUNMAX_QOS_REALTIME`
  - `TOOL_JOB_RUNMAX_QOS_INTERACTIVE`
  - `TOOL_JOB_RUNMAX_QOS_BATCH`
  - `TOOL_JOB_QMAX_WEB`
  - `TOOL_JOB_QMAX_PROD`
  - `TOOL_JOB_QMAX_GLOB`
  - `TOOL_JOB_DLQ_TTL_MS`
- Tool queue alerting:
  - `TOOL_QUEUE_ALERTS_ENABLED`
  - `TOOL_QUEUE_ALERT_WINDOW_MIN`
  - `TOOL_QUEUE_ALERT_COOLDOWN_MS`
  - `TOOL_QUEUE_ALERT_MAX_QUEUED`
  - `TOOL_QUEUE_ALERT_MAX_DLQ`
  - `TOOL_QUEUE_ALERT_MAX_QUEUED_AGE_MS`
  - `TOOL_QUEUE_ALERT_MAX_RUNNING_AGE_MS`
  - `TOOL_QUEUE_SENTRY_DSN` (optional, defaults to `SENTRY_DSN`)

Use Convex CLI to inspect effective runtime values:

```bash
npx convex run ops:getReliabilitySnapshot
npx convex run ops:getReliabilitySnapshot '{"minutes":30,"limit":100}'
```

Tool cache operations:

```bash
npx convex run toolCache:listNamespaceStats '{"limit":5000}'
npx convex run toolCache:clearNamespace '{"namespace":"search_web_v1"}'
```

Release gate policy:

```bash
cat scripts/reliability/release-gate-policy.json
```

Surface ownership matrix:

```bash
cat scripts/reliability/ownership-matrix.json
```

Canary regression policy:

```bash
cat scripts/reliability/canary-policy.json
```

## Output

JSON report files are written to:

- `.output/reliability/load-drill-<profile>-<timestamp>.json`
- `.output/reliability/chat-auth-pool-<prefix>-<seed>-<start>-<count>.json`
- `.output/reliability/synthetic-probes-<timestamp>.json`
- `.output/reliability/release-gate-<timestamp>.json`
- `.output/reliability/canary-check-<timestamp>.json`
- `.output/reliability/game-day-<timestamp>.json`
- `.output/reliability/slo-dashboard.md`
- `.output/reliability/slo-dashboard.json`

Release-gate reports include:

- snapshot checks with explicit owner assignment
- burn-rate checks per scenario (`burn_rate_gate`) using `slo-baseline.json`

Each report includes:

- per-stage throughput + latency
- status code distributions
- network error counts
- SLO gate pass/fail by scenario

## Current SLO Gates

- Webhook scenarios (`/api/gmail/push`, `/api/whatsapp/webhook`):
  - `p95 <= 1500ms`
  - `5xx rate <= 1%`
  - `network error rate <= 2%`
  - `unknown status rate <= 5%`
- Chat HTTP scenario (`/api/chat`):
  - `p95 <= 12000ms`
  - `5xx rate <= 5%`
  - `network error rate <= 5%`
  - `unknown status rate <= 10%`
  - `2xx success rate >= 90%`
