# Phase 5.6 Milestone Gates

As of 2026-02-19.

## Profiles

- `m1_1k`
- `m2_5k`
- `m3_20k`

Use with:

```bash
npm run reliability:drill -- --profile=m1_1k --scenarios=chat_stream_http
```

## Milestone Gate Command

```bash
npm run reliability:milestone-gate -- --milestone=m1_1k --chat-auth-pool-file=.output/reliability/<pool>.json
```

Policy source:

- `scripts/reliability/milestone-gate-policy.json`

Output artifact:

- `.output/reliability/milestone-gate-<milestone>-<timestamp>.json`

## What Is Enforced

- chat 2xx success-rate floor
- chat 5xx ceiling
- chat 429 budget ceiling
- chat p95 completion latency bound
- chat p95 first-token latency bound
- chat network/unknown error ceilings
- auth pool size and unique-coverage floor
- snapshot checks for sustained open circuits and queue age limits
