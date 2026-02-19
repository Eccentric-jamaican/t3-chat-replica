# Reliability Runbook

As of 2026-02-18.

## Scope

This runbook covers Sendcat reliability operations for:

- `/api/chat`
- `/api/gmail/push`
- `/api/whatsapp/webhook`

## Baseline SLOs (Phase 1)

These thresholds are the operational baseline for incident detection and release checks.

| Endpoint                | p95 latency  | 5xx rate | network error rate | unknown status rate | Allowed statuses     |
| ----------------------- | ------------ | -------- | ------------------ | ------------------- | -------------------- |
| `/api/chat`             | `<= 12000ms` | `<= 5%`  | `<= 5%`            | `<= 10%`            | `200, 401, 429, 503` |
| `/api/gmail/push`       | `<= 1500ms`  | `<= 1%`  | `<= 2%`            | `<= 5%`             | `200, 400, 403, 429` |
| `/api/whatsapp/webhook` | `<= 1500ms`  | `<= 1%`  | `<= 2%`            | `<= 5%`             | `200, 400, 403, 429` |

Machine-readable copy: `scripts/reliability/slo-baseline.json`.

## First 5 Minutes (Triage)

1. Confirm current reliability posture:
   - `npm run reliability:snapshot`
2. Run a quick synthetic check:
   - `npm run reliability:probe`
   - `npm run reliability:drill -- --quick=true`
3. Determine if issue is inbound pressure or outbound provider:
   - rate limiting / replay pressure
   - circuit breaker state
   - bulkhead saturation
   - region posture (`config.regionTopology` in reliability snapshot)

## Core Operator Commands

Snapshot and drills:

```bash
npm run reliability:snapshot
npm run reliability:probe
npm run reliability:drill -- --quick=true
npm run reliability:drill -- --profile=burst
npm run reliability:drill -- --profile=soak --scenarios=gmail_push_webhook,whatsapp_webhook
npm run reliability:gate -- --profile=quick
npm run reliability:canary -- --control-url=https://control.convex.site --candidate-url=https://candidate.convex.site --profile=quick
npm run reliability:gameday -- --profiles=burst,soak
npm run reliability:dashboard
npm run reliability:region-readiness -- --expected-peak-streams=5000
npm run reliability:milestone-gate -- --milestone=m1_1k --chat-auth-pool-file=.output/reliability/chat-auth-pool-loadtestmulti-20260219c-1-20.json --chat-load-scale=0.5 --chat-concurrency-scale=0.5
```

Ownership reference:

```bash
cat scripts/reliability/ownership-matrix.json
```

Rate-limit pressure:

```bash
npx convex run rateLimit:getEventSummary '{"minutes":15}'
npx convex run rateLimit:listRecentAlerts '{"limit":20}'
npx convex run rateLimit:listRecentEvents '{"limit":50}'
```

Circuit state:

```bash
npx convex run circuitBreaker:listStatuses '{"limit":20}'
```

Bulkhead in-flight pressure:

```bash
npx convex run bulkhead:listInFlightByProvider '{"provider":"openrouter_chat_primary","limit":100}'
npx convex run bulkhead:listInFlightByProvider '{"provider":"openrouter_chat_secondary","limit":100}'
npx convex run bulkhead:listInFlightByProvider '{"provider":"serper_search","limit":100}'
npx convex run bulkhead:listInFlightByProvider '{"provider":"gmail_oauth","limit":100}'
```

Replay/idempotency pressure:

```bash
npx convex run idempotency:listRecentByScope '{"scope":"gmail_push_history","limit":50}'
npx convex run idempotency:listRecentByScope '{"scope":"whatsapp_message","limit":50}'
```

Tool cache visibility / invalidation:

```bash
npx convex run toolCache:listNamespaceStats '{"limit":5000}'
npx convex run toolCache:clearNamespace '{"namespace":"search_web_v1"}'
npx convex run toolCache:clearNamespace '{"namespace":"search_products_v1"}'
```

## Incident Playbooks

### A) Rate-limit pressure spike

Signal:

- high `blocked` or `contention_fallback` in `rateLimit:getEventSummary`
- Sentry warnings from `convex.rateLimit.monitor`

Actions:

1. Confirm endpoint and bucket with highest pressure.
2. If traffic is abusive, keep limits in place and monitor.
3. If traffic is legitimate and sustained, tune env knobs by small increments:
   - `RATE_LIMIT_*_MAX` by <= 25% per change.
4. Re-run:
   - `npm run reliability:drill -- --quick=true`
5. Verify no regression in `5xx` and `unknown_status_rate`.

### B) Circuit opens (upstream instability)

Signal:

- open state in `circuitBreaker:listStatuses`
- increased fallback responses in chat/tool paths

Actions:

1. Identify provider (`openrouter_chat_primary`, `openrouter_chat_secondary`, `serper_search`, `gmail_oauth`, `ebay_search`, `global_search`).
2. Check provider status and token/quota validity.
3. Keep circuit protection enabled; do not bypass.
4. If flapping, increase `CIRCUIT_*_COOLDOWN_MS` first, then retest.
5. If primary route is degraded, confirm `FF_PROVIDER_FAILOVER_ENABLED=true` and validate secondary route health before tuning thresholds.

### C) Bulkhead saturation

Signal:

- high active leases in `bulkhead:listInFlightByProvider`
- `503` with `Retry-After` or degraded tool responses

Actions:

1. Confirm saturation is real and sustained (not a short spike).
2. Increase `BULKHEAD_*_MAX_CONCURRENT` conservatively (<= 20% per change).
3. Keep `BULKHEAD_*_LEASE_TTL_MS` aligned to realistic call durations.
4. Validate with quick drill and snapshot before/after.

### D) Webhook replay surge

Signal:

- rising duplicate hits in snapshot replay section
- high `hitCount` in `idempotency:listRecentByScope`

Actions:

1. Confirm source scope (`gmail_push_history` or `whatsapp_message`).
2. Keep idempotency enabled; do not disable dedupe.
3. Verify provider retries are expected (ack timing, auth failures, upstream errors).
4. If needed, increase webhook capacity via rate-limit/bulkhead knobs with caution.

### E) Stale/incorrect cached tool results

Signal:

- repeated stale search/product outputs despite successful upstream recovery
- snapshot `toolCache.byNamespace` shows sustained active entries in impacted namespace

Actions:

1. Invalidate the impacted namespace:
   - `toolCache:clearNamespace`
2. If this should persist across deploys, bump namespace versions:
   - `TOOL_CACHE_WEB_SEARCH_NAMESPACE_VERSION`
   - `TOOL_CACHE_PRODUCTS_NS_VER`
3. Re-run quick drill and confirm fresh outputs are being generated.

### F) Tool queue backlog / worker starvation

Signal:

- snapshot `toolJobs.byStatus.queued` rising and not draining
- `toolJobs.oldestQueuedAgeMs` increasing across snapshots
- chat tool responses degraded to queued/timeout text

Actions:

1. Confirm worker saturation vs upstream failure:
   - check `bulkheads.inFlightByProvider.tool_job_worker`
   - check circuit states for `serper_search`, `openrouter_chat_primary`, and `openrouter_chat_secondary` if related
2. Increase worker capacity conservatively:
   - `BULKHEAD_TOOL_JOB_MAX` (<= 20% per change)
   - `TOOL_JOB_MAX_PER_RUN`
   - per-tool running caps:
     - `TOOL_JOB_RUNMAX_WEB`
     - `TOOL_JOB_RUNMAX_PROD`
     - `TOOL_JOB_RUNMAX_GLOB`
   - per-QoS running caps:
     - `TOOL_JOB_RUNMAX_QOS_REALTIME`
     - `TOOL_JOB_RUNMAX_QOS_INTERACTIVE`
     - `TOOL_JOB_RUNMAX_QOS_BATCH`
3. If backlog is dominated by one tool type, tune per-tool queued caps:
   - `TOOL_JOB_QMAX_WEB`
   - `TOOL_JOB_QMAX_PROD`
   - `TOOL_JOB_QMAX_GLOB`
4. Monitor queue lag alerts:
   - `toolJobs:monitorQueueHealth`
   - inspect `toolQueueAlerts` in snapshot.
5. Tune lease/poll windows if jobs are frequently timing out:
   - `TOOL_JOB_LEASE_MS`
   - `TOOL_JOB_WAIT_MS`
   - `TOOL_JOB_POLL_MS`
6. If dead-letter backlog grows:
   - inspect `toolJobs.recentDeadLetters`
   - use `toolJobs:requeueDeadLetter` after upstream mitigation.
7. Re-run quick drill and compare snapshots before/after.

### G) Region rollout trigger evaluation (single-region launch)

Signal:

- business forecast or launch telemetry indicates sustained higher concurrent chat demand
- repeated load-pressure breaches despite tuning and queue/admission controls

Actions:

1. Run trigger check:
   - `npm run reliability:region-readiness -- --expected-peak-streams=<forecast>`
2. Inspect generated report in `.output/reliability/region-readiness-*.json`.
3. If `activateMultiRegionProgram=true`, open a multi-region execution ticket and attach:
   - latest region-readiness report
   - latest release-gate report
   - latest load-drill artifacts
4. If not triggered, keep single-region posture and continue capacity tuning on current phase gates.

### H) Phase 5.6 milestone gate execution

Signal:

- release candidate needs milestone evidence (`m1_1k`, `m2_5k`, `m3_20k`)

Actions:

1. Ensure a valid chat auth pool file exists for the run.
2. Execute milestone gate:
   - `npm run reliability:milestone-gate -- --milestone=m1_1k --chat-auth-pool-file=<pool-file>`
3. Review artifact:
   - `.output/reliability/milestone-gate-<milestone>-<timestamp>.json`
4. If failed, tune relevant reliability knobs and rerun before promotion.

## Release Gate Procedure

Before promoting a release:

1. Run:
   - `npm run reliability:gate -- --profile=quick`
2. For high-risk releases, run:
   - `npm run reliability:gate -- --profile=standard --minutes=20 --limit=150`
3. If gate fails:
   - block deploy
   - inspect `.output/reliability/release-gate-*.json`
   - use the relevant incident playbook above
   - rerun gate after mitigation

## Canary Promotion Procedure

1. Run canary comparison:
   - `npm run reliability:canary -- --control-url=<control> --candidate-url=<candidate> --profile=quick`
2. Review:
   - `.output/reliability/canary-check-*.json`
3. If canary fails:
   - rollback/hold candidate traffic
   - inspect scenario deltas (p95, 5xx, network, unknown status)
   - tune and rerun before promotion.

## Game-Day Procedure

1. Execute:
   - `npm run reliability:gameday -- --profiles=burst,soak`
2. Review:
   - `.output/reliability/game-day-*.json`
3. Regenerate dashboard:
   - `npm run reliability:dashboard`
4. Track actions for any flagged findings before next game day.

## Tuning Rules

- Apply one change set at a time.
- Record before/after snapshots.
- Prefer cooldown and concurrency tuning before relaxing validation or auth controls.
- Never disable circuit breakers, bulkheads, or idempotency in production.

## Post-Incident Checklist

1. Capture timeline and affected endpoint(s).
2. Save supporting artifacts:
   - reliability snapshot output
   - load drill report path
   - Sentry issue links
3. Add a short entry to `reliability-phase-log.md` if new mitigations were introduced.
4. If thresholds were tuned, update `scripts/reliability/slo-baseline.json` and this runbook.
