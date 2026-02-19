# Region Rollout Triggers

As of 2026-02-19.

## Scope

- Launch mode is `single_region`.
- This document defines when to start a full multi-region implementation program.
- Source policy file: `scripts/reliability/region-rollout-policy.json`.

## Trigger Conditions

Any one of the conditions below is sufficient to trigger a multi-region program:

1. Demand trigger
- `expected_peak_streams >= 20000` -> target `active_standby`.
- `expected_peak_streams >= 60000` -> target `active_active`.

2. Load-pressure trigger
- Evaluate latest `6` load-drill artifacts.
- Trigger if at least `3` reports breach any of:
  - chat `p95 > 5000 ms`
  - chat `429 rate > 15%`
  - chat `5xx rate > 2%`

3. Snapshot-health trigger
- Trigger if any is breached in ops snapshot window:
  - `open circuits > 1`
  - `rate-limit alerts in window > 5`
  - `queued tool jobs > 100`

## Operator Command

```bash
npm run reliability:region-readiness -- --expected-peak-streams=5000
```

Output artifact:

- `.output/reliability/region-readiness-<timestamp>.json`

## Decision Policy

- If no trigger is crossed:
  - remain in single-region launch mode
  - continue phase 5.6 scale gates
- If any trigger is crossed:
  - open multi-region execution workstream
  - attach region-readiness report, release-gate report, and latest load-drill reports
