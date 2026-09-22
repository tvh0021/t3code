# Session handoff: ChatLLM, Codex, and Zed ACP investigation

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

## Zed ACP integration status

### User need

- Add Zed as a T3 Code provider whose sessions run through a headless ACP server.
- Keep Claude Sonnet 5 and GPT 5.6 Luna as the built-in Zed model choices.
- Use the user's stored Zed credentials for hosted `zed.dev` models. The ACP handshake itself does not provide authentication.

### Implementation status

- T3 Code contains a development Zed provider driver, provider snapshot and health probe, ACP session adapter, model selection, streamed content and thought events, tool lifecycle events, permission requests, elicitation, slash-command dispatch, rollback rejection, and cleanup.
- The built-in catalog contains `zed.dev/claude-sonnet-5` and `zed.dev/gpt-5.6-luna`. The adapter forwards the selected model to the headless Zed binary.
- The Zed fork adds `zed-acp-server` under `crates/eval_cli`. It reuses Zed's `NativeAgent` and `AcpThread`, communicates over JSON-RPC on standard input and output, and supports worktree, data-directory, and model arguments.
- The headless server authenticates with stored Zed credentials, waits for the selected model to become available, and sets `agent.default_model` before creating a session.
- The Zed bridge forwards context-token usage. The T3 adapter maps ACP
  `usage_update.used` and `usage_update.size` to the shared context-window
  activity.
- Zed account spend no longer appears as `$0 / $10` or as a sum of ACP session
  costs. The provider snapshot reports account spend as unavailable and directs
  the user to the Zed dashboard.
- The changelog records the verified streaming repair. The wider integration
  remains under development.

### Current verification

- Fake-ACP tests cover streaming, permission requests, elicitation, and context-token updates.
- The scoped server typecheck exits 0 with no Zed-related TypeScript errors.
- The real-binary Luna smoke test passes with network access. Sandboxed DNS
  cannot resolve `cloud.zed.dev`.
- The September 21 streaming regression came from repeated completed-tool
  snapshots, which split assistant output mid-word and flooded the activity list.
  The Zed adapter now filters identical terminal snapshots before segmentation
  and preserves changed output. An isolated Sonnet web-client turn produced one
  file-read completion and one intact answer.
- The desktop server bundle was rebuilt.
- Real Zed Luna approval and decline flows pass in an isolated web client.
  An approved synthetic command returned `LUNA-APPROVAL-OK`; a declined command
  reported permission denied and the session remained usable.
- The context-window issue is resolved. The headless bridge forwards real token
  usage, and T3 keeps billing cost separate from context usage.
- Zed adapter tests now use `@effect/vitest` instead of a manual Effect runtime.
  The test file passes lint without warnings; 14 tests and the scoped server
  typecheck pass. The hosted smoke test remains opt-in.
- `ZedProvider.test.ts` checks that account usage has no windows when billing
  data is unavailable. The focused test passes.
- The earlier unused-import lint finding has been fixed.

- September 22 follow-up: 18 focused Zed tests pass, with the opt-in hosted
  smoke test skipped. Targeted lint, server typecheck, and `git diff --check`
  pass. T3 UI verification remains pending because the required Browser panel
  tools are unavailable in this session. No app rebuild or reload was performed.

### Account-usage findings

- The usage tracker does not work because T3 has no authenticated source for
  account-wide token spend. ACP reports cumulative cost for one session, while
  the Limits view needs the account total for the current billing period.
- September 22 recheck: the stored native credential returns `200` for
  `/client/users/me`, but `401` for all four tested billing routes.
- The current organization dashboard uses
  `/frontend/organizations/{id}/billing/usage` and
  `/frontend/organizations/{id}/subscription`. The older account routes are
  `/frontend/billing/usage` and `/frontend/billing/subscriptions/current`.
- Safari showed `$5.20` used of `$10`. The public dashboard client requests
  billing routes with browser-session credentials. Organization usage exposes
  `current_usage.token_spend.spend_in_cents`, `limit_in_cents`, and `updated_at`.
- The native account response includes the subscription period, but no token
  spend. Native account-update events re-fetch that response.
- T3 must not copy a dashboard cookie into server state. Native billing support
  requires a change to Zed's hosted service. An explicit dashboard sign-in
  integration would be separate work.
- Until T3 has a supported billing read, it must show account spend as
  unavailable. It must not construct an account total from ACP session costs.
- Provider-refresh tests exposed a separate defect: a CLI probe that exited
  nonzero still marked Zed ready. The probe now reports an error and keeps
  account spend unavailable.

### Repository state

- T3 Code: branch `feat/zed-integration`.
- Zed fork: branch `integration/zed-abacus`, pushed through commit `3083c5bde9`.
- The Zed fork still has an uncommitted `README.md` review marker. Leave it untouched unless the user gives separate direction.

### Open questions and pending work

- Obtain a Zed billing API that accepts native credentials, or add an explicit
  dashboard sign-in integration.
- Read account spend and the billing-period end from the dashboard responses
  after supported authentication exists.
- Add tests for account scope, billing-period boundaries, failed reads, stale
  data, and repeated cumulative ACP session updates.
- Keep the account-usage issue in `docs/personal/ISSUE_TRACKER.md` open until
  the displayed amount and reset date come from Zed's billing responses.
- If the ACP server changes, rebuild the Zed binary and rerun the focused T3 tests against the real binary.

### Shared performance and synchronization

- The 20,000-bucket usage-merge regression test completes in about 20 ms against a 1,000 ms ceiling.
- Plain-message math preprocessing improved from about 0.107 ms to 0.008 ms per call in the focused benchmark.
- The branch merged the latest `upstream/main` without conflicts on September 22, 2026.
- Server and shared package typechecks pass. The repository still emits its existing Effect suggestions.
- `git diff --check` passes.
