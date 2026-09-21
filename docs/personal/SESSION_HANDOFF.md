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
- The enabled context meter failed the real Luna check: no meter appeared and
  no context-usage events arrived. The headless Zed bridge does not forward
  `usage_update`.
- Zed adapter tests now use `@effect/vitest` instead of a manual Effect runtime.
  The test file passes lint without warnings; 14 tests and the scoped server
  typecheck pass. The hosted smoke test remains opt-in.

### Repository state

- T3 Code: branch `feat/zed-integration`.
- Zed fork: branch `integration/zed-abacus`, pushed through commit `3083c5bde9`.
- The Zed fork still has an uncommitted `README.md` review marker. Leave it untouched unless the user gives separate direction.

### Open questions and pending work

- Find a supported Zed billing endpoint before showing account spend in Limits.
- Forward context usage from the headless Zed bridge, rebuild, and retest the meter.
- Track these items in `docs/personal/ISSUE_TRACKER.md`.
- If the ACP server changes, rebuild the Zed binary and rerun the focused T3 tests against the real binary.
