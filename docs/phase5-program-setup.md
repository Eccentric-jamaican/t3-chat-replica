# Phase 5.0 Program Setup

As of 2026-02-19.

This document locks the scale contracts for the large-scale chat architecture
work in Phase 5.

## 1) Target Tiers

- `Tier L` (Launch): sustain `1,000` concurrent chat streams.
- `Tier G` (Growth): sustain `5,000` concurrent chat streams.
- `Tier X` (Large): sustain `20,000` concurrent chat streams.

## 2) Chat SLOs

All SLOs are measured at peak-hour windows.

### Tier L (1,000 streams)

- Availability: `>= 99.5%`
- `2xx` success rate: `>= 95%`
- `5xx` rate: `<= 1.0%`
- `429` rate budget: `<= 4.0%`
- p95 first-token latency: `<= 3,000ms`
- p95 completion latency: `<= 20,000ms`

### Tier G (5,000 streams)

- Availability: `>= 99.9%`
- `2xx` success rate: `>= 95%`
- `5xx` rate: `<= 0.5%`
- `429` rate budget: `<= 4.0%`
- p95 first-token latency: `<= 2,500ms`
- p95 completion latency: `<= 18,000ms`

### Tier X (20,000 streams)

- Availability: `>= 99.95%`
- `2xx` success rate: `>= 95%`
- `5xx` rate: `<= 0.3%`
- `429` rate budget: `<= 5.0%`
- p95 first-token latency: `<= 2,000ms`
- p95 completion latency: `<= 15,000ms`

## 3) Capacity Milestones

Milestones are pass/fail gates.

### M1 gate (Tier L)

- Profile target: `m1_1k`
- Minimum soak duration: `30m`
- Gate pass requirements:
  - all Tier L SLOs pass
  - no sustained provider circuit open state longer than `2m`
  - no queue backlog age over `60s`

### M2 gate (Tier G)

- Profile target: `m2_5k`
- Minimum soak duration: `60m`
- Gate pass requirements:
  - all Tier G SLOs pass
  - no regional failover action required during baseline run
  - no queue backlog age over `45s`

### M3 gate (Tier X)

- Profile target: `m3_20k`
- Minimum soak duration: `120m`
- Gate pass requirements:
  - all Tier X SLOs pass
  - controlled regional failover drill still passes Tier G SLOs
  - no queue backlog age over `30s`

## 4) Rollback Triggers

A deployment promotion is blocked or rolled back if any condition is met:

- `5xx` exceeds threshold for `5` consecutive minutes.
- `2xx` success rate remains below threshold for `10` consecutive minutes.
- provider circuit for primary route remains open for `> 2` minutes.
- queue oldest-job age exceeds milestone limit for `> 10` minutes.
- auth or admission path has unresolved hard failures (`redis_unavailable`,
  token validation failures, or gateway health failures).

## 5) Measurement Contract

- First-token latency is measured from request accepted to first stream byte.
- Completion latency is measured from request accepted to stream close.
- `429` budget is intentional load shedding; it is tracked separately from `5xx`.
- Success-rate checks always include a minimum `2xx` threshold to avoid false
  passes from fast rejects.

