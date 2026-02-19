# Scale Plan (Caribbean-Ready) + Path to 1M Users

This document is a practical scaling roadmap for Sendcat.

It is intentionally written around measurable capacity targets (concurrency, RPS, token spend) because “1M users” is ambiguous for an AI chat app.

## Definitions (What We Actually Scale)

- **Registered users**: total accounts.
- **MAU/DAU**: monthly/daily active users.
- **Peak concurrent chat streams**: number of simultaneous `/api/chat` streams (this is usually the first hard ceiling).
- **RPS**: requests per second (webhooks + app traffic).
- **Tokens/min**: LLM budget rate; drives cost and provider throttles.

## Current State (What We Already Have)

- Convex-based backend with reliability controls:
  - rate limiting with stable `429` fallback under contention
  - bulkheads and circuit breakers for upstream protection
  - tool cache (persistent) + tool job queue (background) + backpressure errors
  - SLO drill scripts + release gates + runbook
- Default bulkhead caps (from `convex/lib/reliabilityConfig.ts`):
  - `openrouter_chat`: `24` concurrent
  - tool job worker: `6` concurrent

## Key Finding

For an AI chat app, scale is dominated by:

1. **LLM provider capacity and cost controls** (OpenRouter/model throttles).
2. **Concurrent streaming connection capacity** (`/api/chat`).
3. **High-QPS counters/caches** (rate limits, quotas, dedupe keys, tool cache).

Redis helps strongly with (3), and partially with (2) via backpressure signals and queue coordination, but it does not replace (1) and does not automatically lift streaming ceilings.

## Target Milestones (Tunable)

These are conservative engineering milestones to make scaling decision-driven:

- **M1**: 500 concurrent chat streams
- **M2**: 5,000 concurrent chat streams
- **M3**: 20,000 concurrent chat streams

Each milestone should include:

- max allowed LLM spend per day (hard budget)
- expected peak RPS and webhook volume
- minimum SLOs for `/api/chat` p95 and error rates

## What We Need (Capabilities Checklist)

1. **Cost + abuse controls**
   - per-user message limits + token budgets (daily + rolling window)
   - plan-aware limits (free vs paid)
   - bot mitigation (signup + chat send)
2. **Backpressure + isolation**
   - provider bulkheads and circuit breakers tuned to budget
   - queue saturation UX (explicit “try again shortly” behavior)
3. **Distributed counters and caches**
   - atomic counters for rate limits/quotas at high QPS
   - short-TTL caches for tool results/product lookups
   - single-flight / stampede protection
4. **Streaming strategy**
   - decide how to scale concurrent streams (Convex only vs proxy vs dedicated)
5. **Data + retention**
   - retention tiers (free keeps less history; paid keeps more)
   - pagination everywhere, no “collect everything” patterns
6. **Release safety + observability**
   - SLO drills and release gates stay mandatory
   - dashboards for 429/503 rates, queue depth, token spend, provider errors

## Where Redis Comes In (And Where It Doesn’t)

Redis is recommended when:

- rate-limit windows create write contention or high DB load
- you need cheap atomic counters for quotas and burst limits
- you want ultra-fast short TTL caches for tool results
- you need distributed locks (single-flight) and queue coordination signals

Redis is not:

- your source of truth for threads/messages/users
- a substitute for LLM provider throughput constraints

Recommended option for this app:

- **Upstash Redis** (serverless friendly, pay-per-request) + `@upstash/ratelimit` for quota/rate-limit enforcement.

## Proposed Engineering Phases

### Phase 0 — Capacity Model (1–2 days)

- Add a one-page capacity model:
  - `peak_concurrent_streams`
  - `tokens/day` budget + cost model
  - per-tier limits (free vs paid)
- Make “milestone triggers” explicit (when to move to the next phase).

### Phase 1 — Quotas That Match AI Costs (3–7 days)

- Server-enforce:
  - daily message quota
  - daily token budget
  - rolling window throttles (already partially present via rate limits)
- UX:
  - “quota exceeded” screen with retry-after and upgrade path
- Add tests + drill scenarios that confirm quotas behave under load.

### Phase 2 — Move Hot Counters to Redis (3–7 days)

- Introduce Upstash Redis and move:
  - chat rate limiting
  - webhook rate limiting
  - quota counters (daily totals) where appropriate
- Keep Convex event logging for observability (lower volume), but avoid DB writes for every increment when traffic is high.

### Phase 3 — Tool Cache in Redis + Stampede Protection (5–10 days)

- Short-TTL caching for:
  - `search_web`
  - product/global search lookups
- Add single-flight locks per cache key.

### Phase 4 — Streaming Strategy (Milestone-triggered)

Choose one path per milestone and commit to it:

1. **Convex-only streaming** (M1)
2. **Proxy streaming via Vercel edge** (M2, enables WAF at same origin)
3. **Dedicated streaming service** (M3)

### Phase 5 — Retention + Archival (Milestone-triggered)

- Free tier retention caps to control storage costs.
- Optional archival for paid tiers.

## Open Decisions (Need Product Input)

1. What “serve Jamaica” means in rough DAU (10k vs 100k vs 500k).
2. Target peak concurrent chat streams for the next 12 months.
3. Anonymous usage at scale vs sign-in required for chat.
4. Allowed daily LLM spend ceiling (hard budget).

## Market Baseline (Sizing Input)

For a data-backed starting point (proxy-based), see:

- `docs/jamaica-ecommerce-sizing.md`
- `docs/english-caribbean-ecommerce-sizing.md`
