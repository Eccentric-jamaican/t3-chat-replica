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
npm run reliability:canary
```

```bash
npm run reliability:gameday
```

```bash
npm run reliability:dashboard
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
```

Run specific scenario(s):

```bash
npm run reliability:drill -- --scenarios=chat_stream_http
npm run reliability:drill -- --scenarios=gmail_push_webhook,whatsapp_webhook
```

Release gate (synthetic probes + load drill + live snapshot checks):

```bash
npm run reliability:gate -- --profile=quick
npm run reliability:gate -- --profile=standard --minutes=20 --limit=150
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
- `GMAIL_PUBSUB_VERIFY_TOKEN`: optional; when present the Gmail push drill sends the query token.
- `WHATSAPP_APP_SECRET`: optional; when present WhatsApp drill signs payloads.

## Runtime Reliability Knobs (Convex env vars)

- Rate limits:
  - `RATE_LIMIT_CHAT_STREAM_MAX`, `RATE_LIMIT_CHAT_STREAM_WINDOW_MS`
  - `RATE_LIMIT_GMAIL_PUSH_MAX`, `RATE_LIMIT_GMAIL_PUSH_WINDOW_MS`
  - `RATE_LIMIT_WHATSAPP_MAX`, `RATE_LIMIT_WHATSAPP_WINDOW_MS`
  - `RATE_LIMIT_GMAIL_OAUTH_MAX`, `RATE_LIMIT_GMAIL_OAUTH_WINDOW_MS`
  - `RATE_LIMIT_WA_LINK_CODE_MAX`, `RATE_LIMIT_WA_LINK_CODE_WINDOW_MS`
- Circuits:
  - `CIRCUIT_OPENROUTER_THRESHOLD`, `CIRCUIT_OPENROUTER_COOLDOWN_MS`
  - `CIRCUIT_SERPER_THRESHOLD`, `CIRCUIT_SERPER_COOLDOWN_MS`
  - `CIRCUIT_GMAIL_OAUTH_THRESHOLD`, `CIRCUIT_GMAIL_OAUTH_COOLDOWN_MS`
- Bulkheads:
  - `BULKHEAD_OPENROUTER_MAX_CONCURRENT`, `BULKHEAD_OPENROUTER_LEASE_TTL_MS`
  - `BULKHEAD_SERPER_MAX_CONCURRENT`, `BULKHEAD_SERPER_LEASE_TTL_MS`
  - `BULKHEAD_GMAIL_OAUTH_MAX_CONCURRENT`, `BULKHEAD_GMAIL_OAUTH_LEASE_TTL_MS`
  - `BULKHEAD_SENTRY_COOLDOWN_MS`
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
  - `TOOL_JOB_QMAX_WEB`
  - `TOOL_JOB_QMAX_PROD`
  - `TOOL_JOB_QMAX_GLOB`

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
