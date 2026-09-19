# Session handoff: ChatLLM and Codex credit accounting

## What changed

- The Usage page separates subscription models from credit-based models and formats Codex credits as numeric values.
- The Limits tab shows the Codex available-credit balance below the weekly limit.
- Codex spillover usage is stored as credits and converted at `$0.04` per credit.
- Scan-cache version 5 stores each Codex record's raw account balance. Older cache versions cold-scan so they cannot preserve incorrect credit totals.
- Forked rollout copies remain suppressed, while their balance snapshots no longer create duplicate usage.
- `codex-auto-review` contributes `$0` and `0` credits in both subscription and credit-based model buckets. Its balance snapshot does not advance the paid-credit baseline, so a concurrent paid drop is counted once on the next paid record.
- Non-spend Codex records keep `reportedCostUsd: null`; only auto-review uses an explicit reported zero. This preserves normal rate-table pricing for subscription models such as Luna and Astra.
- Duplicate `token_count` payloads still do not create usage records, but a newer balance on a duplicate payload updates the account baseline.
- The service reconciles all live and retained cached Codex rollout records together in timestamp order. Per-file balance deltas were the source of the large overcount because the balance belongs to one account, not one rollout.

## Corrected backfill

The earlier 90-day result of `3,661.50` credits was wrong. It charged `codex-auto-review` and counted account-wide balance drops independently in multiple rollout files.

A redacted scan of the local rollout corpus found 476 rollout files. The account balance moved from `2,500` to about `1,166`, and the corrected chronological reconciliation measured about `1,334` credits, or `$53.37`. That matches the expected roughly `1,300` credits from the reported `2,500` to `1,169` movement. Auto-review contributed zero.

## Verification

- 151 focused server/shared usage tests pass, including regression tests for concurrent rollouts, duplicate balance snapshots, auto-review, subscription pricing, and cache round trips.
- Server and shared package typechecks pass. The repository still emits its existing Effect suggestions.
- `git diff --check` passes.
