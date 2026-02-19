# ADR: Large-Scale Chat Gateway Architecture

Status: Accepted (Phase 5.0 baseline)  
Date: 2026-02-19

## Context

The current system has strong reliability guardrails, but high-concurrency chat
load is still constrained by the existing hot path. We need an architecture
that can scale to large concurrent stream counts while degrading gracefully.

## Decision

Adopt a control-plane/data-plane split for chat streaming:

- Control plane:
  - auth/session validation
  - admission and quotas
  - routing decisions
  - policy/config distribution
- Data plane:
  - streaming orchestration
  - provider request/response lifecycle
  - stream metrics and backpressure

Keep the external `/api/chat` contract stable while progressively routing through
the new gateway path behind feature flags.

## Decision Details

### 1) Control plane vs data plane separation

- `/api/chat` remains the public contract.
- Request pre-checks (auth, admission, quota, request validation) run before
  stream execution.
- Stream execution runs in a gateway path that is isolated from UI/app concerns.
- Chat messages and thread state remain in Convex as system-of-record.

### 2) Redis role

Redis is authoritative for hot-path admission counters:

- per-user inflight
- global inflight
- global msg/sec
- global tool-call/sec

Redis is not the source of truth for chat data. Convex remains the canonical
data store for threads/messages/profiles.

### 3) Queue semantics for tool work

- Tool execution is asynchronous queue-backed on cache miss.
- Queue semantics:
  - bounded retries
  - per-tool concurrency caps
  - per-tool queue caps
  - explicit timeout/expiry
  - deterministic fail status when saturated
- Chat stream receives graceful degradation signals instead of blocking
  indefinitely on tool backlog.

### 4) Provider failover policy

- Primary provider/model route is configured by model class.
- Fallback route is preconfigured and exercised in canary drills.
- Circuit-breakers and bulkheads apply per provider.
- Failover policy must preserve user-visible error taxonomy and never leak
  provider internals.

## Consequences

Positive:

- Better isolation of stream hot path.
- Predictable load shedding via admission and queue backpressure.
- Safer rollout with stable external API contract.

Tradeoffs:

- More moving parts (gateway, routing policy, flags, extra metrics).
- Stronger operational discipline required (SLO gates, canary, rollback drills).

## Rollout Strategy

- Phase 5.1: gateway split with contract parity.
- Phase 5.2: Redis admission enforce rollout.
- Phase 5.3+: queue and provider resilience hardening.
- Promotion only through milestone gates (M1 -> M2 -> M3).

