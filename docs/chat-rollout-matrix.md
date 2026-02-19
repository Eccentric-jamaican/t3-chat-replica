# Chat Gateway Rollout Matrix

As of 2026-02-19.

This matrix defines rollout switches, stage policy, and rollback conditions for
large-scale chat changes.

## 1) Feature Flags

Flags are environment-driven and default to safest behavior.

- `FF_CHAT_GATEWAY_ENABLED`
  - `false`: legacy `/api/chat` execution path.
  - `true`: route `/api/chat` via gateway adapter.
- `FF_CHAT_GATEWAY_SHADOW`
  - `true`: run gateway checks/metrics without making gateway authoritative.
  - `false`: gateway path is authoritative.
- `FF_ADMISSION_ENFORCE`
  - `false`: shadow-only admission (observe would-block).
  - `true`: admission decisions enforce allow/deny with `429`.
- `ADMISSION_ENFORCE_USER_INFLIGHT`
- `ADMISSION_ENFORCE_GLOBAL_INFLIGHT`
- `ADMISSION_ENFORCE_GLOBAL_MSG_RATE`
- `ADMISSION_ENFORCE_GLOBAL_TOOL_RATE`
  - stage the Redis admission dimensions independently during rollout.
- `FF_TOOL_QUEUE_ENFORCE`
  - `false`: tool queue advisory mode.
  - `true`: queue caps/timeouts enforced.
- `FF_PROVIDER_FAILOVER_ENABLED`
  - `false`: primary route only.
  - `true`: fallback route available per policy.
- `FF_FAIL_CLOSED_ON_REDIS_ERROR`
  - `false`: fail-open for Redis outages (availability preference).
  - `true`: fail-closed for Redis outages (protection preference).

## 2) Rollout Stages

### Stage A: Dev Shadow

- Target: `ownDev`.
- Flags:
  - `FF_CHAT_GATEWAY_ENABLED=true`
  - `FF_CHAT_GATEWAY_SHADOW=true`
  - `FF_ADMISSION_ENFORCE=false`
- Objective:
  - validate parity and telemetry without behavior change.

### Stage B: Dev Enforce

- Target: `ownDev`.
- Flags:
  - `FF_CHAT_GATEWAY_ENABLED=true`
  - `FF_CHAT_GATEWAY_SHADOW=false`
  - `FF_ADMISSION_ENFORCE=true`
- Admission enforce rollout order:
  - `ADMISSION_ENFORCE_USER_INFLIGHT=true`
  - `ADMISSION_ENFORCE_GLOBAL_INFLIGHT=true`
  - `ADMISSION_ENFORCE_GLOBAL_MSG_RATE=true`
  - `ADMISSION_ENFORCE_GLOBAL_TOOL_RATE=true`
- Objective:
  - validate enforce behavior under burst/soak load.

### Stage C: Candidate Canary

- Target: candidate deployment.
- Traffic: `1% -> 5% -> 20%`.
- Objective:
  - prove no regression against control in canary checks.

### Stage D: Production Ramp

- Target: production.
- Traffic: `10% -> 25% -> 50% -> 100%`.
- Gate between steps:
  - milestone SLO pass
  - no critical alerts
  - no rollback trigger active

## 3) Rollback Matrix

Rollback to previous stage if any condition is true:

- `5xx` exceeds stage threshold for `5` continuous minutes.
- `2xx` success-rate drops below threshold for `10` continuous minutes.
- first-token p95 exceeds threshold for `10` continuous minutes.
- queue oldest age breaches stage limit for `> 10` minutes.
- provider circuit remains open for `> 2` minutes on primary route.
- auth/admission errors spike from baseline by `> 2x` for `10` minutes.

## 4) Operational Notes

- Every rollout step must attach:
  - drill report paths
  - snapshot output
  - decision (`promote` or `rollback`) with reason
- Do not raise limits and enable new authoritative flags in the same step.
- Keep at least one full soak run before promoting from canary to production.
