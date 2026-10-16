# Issue tracker

Open issues, known limitations, and a short record of resolved issues to check
before diagnosing a new bug. Release history is in [CHANGELOG.md](./CHANGELOG.md).

## Open issues

### USAGE-002: Day provider costs don't add up to Total

Open since 2026-10-11.
Problem: On Usage → Day, provider costs include credit-based Codex usage but Total doesn't (e.g. Codex $5.78, Total $5.43).
Cause: `mergeUsage` leaves credit buckets out of the day and hour totals but adds their API-equivalent cost to provider totals.
Done when: provider columns, Total and charts use the same cost basis, or show subscription and credit values separately.
History: Reproduced on installed 0.3.2 and through the shared merge with a $1 subscription bucket and a 25-credit bucket carrying $3: Codex $4, Total $1.

### ZED-CATALOG-001: Failed discovery after restart restores retired Zed models

Open since 2026-10-12.
Problem: After a restart where Zed model discovery fails, the picker shows the retired Sonnet 5 and GPT-5.6 Luna instead of the last discovered Sonnet 5.5 and GPT-6 Luna.
Cause: The provider reports ready and authenticated when discovery fails, so the registry's keep-last-catalog branch never runs, and the seed list is still the old models.
Done when: the last discovered models survive pending and failed startup discovery, and retired models are replaced only after a successful discovery.
History: Reproduced twice in isolated servers. A failed refresh without a restart keeps the current catalog.

### ZED-CONTEXT-001: Zed context meter gets no token usage

Open since 2026-10-12.
Problem: The context meter stays empty for Zed threads.
Cause: The companion Zed bridge never sends ACP `usage_update`; T3's adapter handles it when present.
Done when: the bridge reports context use and capacity for new and resumed sessions, and the meter shows it.
History: Native Zed session storage holds nonzero input and output token counts, but the captured ACP stream has no usage updates.

### CHATLLM-USAGE-001: First ChatLLM turn logs an estimate instead of its charge

Open since 2026-10-12.
Problem: The first charged turn logs an estimated credit count instead of the measured charge (3.36 instead of 40 credits).
Cause: The account balance is first read after the first charge, so that turn falls back to an unmarked token estimate.
Done when: a baseline is read before the first charged turn, or estimates are marked as estimates. Baselines stay per instance.
History: With controlled account responses, two 40-credit turns logged 43.36 credits ($0.022) instead of 80 ($0.04). Later turns measure correctly.

## Known limitations

- **App Store 1.2 and 1.3 Usage** (MOBILE-001): these phone apps show only Claude, Codex and Grok usage. The host sends them the older Usage format.
- **ChatLLM on the phone**: newer phone apps don't know the ChatLLM provider, so the host leaves ChatLLM out of their Usage tab (MOBILE-002). Desktop and web show it.
- **app.t3.codes Usage**: the hosted web app probably fails Usage against this host the way the phone did, because it receives ChatLLM entries. Untested.
- **Antigravity on eduroam** (WORKFLOW-003): Antigravity sign-in times out because eduroam's IPv6 path stalls and the native client has no IPv4 fallback. Hotspot and other networks work.
- **Zed organization billing**: Zed Limits reads personal billing only. Organization billing is not supported.

## Resolved

- **USAGE-005** (after 0.6.3): Antigravity tokens counted about 3×. Cause: id-less Gemini usage repeated in step, generation and retry records. Fix: identical id-less totals within a database count once.
- **USAGE-006** (after 0.6.3): Codex credits counted twice. Cause: `sessions` and `archived_sessions` reconciled separately. Fix: each Codex home reconciles as one balance timeline.
- **CHATLLM-WRITE-001** (after 0.6.3): ChatLLM `write_file`/`edit_file` followed symlinks outside the project. Fix: writes check the real path, as Antigravity's file tools do.
- **ZED-001** (0.5.0): Zed Limits needed real account spend. Cause: native credential can't read billing. Fix: dashboard cookie session; user confirmed spend matches the dashboard.
- **CODEX-CREDIT-001** (closed 2026-10-16, no fix): Parser skips a repeated `token_count` payload with a newer credit balance. Never observed; totals unaffected.
- **MOBILE-002** (0.6.3): Phone Usage empty on App Store 2.0.0. Cause: unknown abacus provider fails the whole RPC decode. Fix: host drops ChatLLM entries for mobile.
- **AG-QUOTA-001** (0.6.2): Antigravity Limits missing the Gemini pool. Cause: probe stopped at the daily endpoint, which omits Gemini. Fix: query both endpoints and merge windows.
- **CHATLLM-STEPS-001** (0.6.1): Delegated ChatLLM runs ended silently after 20 tool calls. Cause: hidden cap message. Fix: 200/50 per-model cap, visible stop message, per-request timeout.
- **USAGE-004** (0.6.1): Claude Fast spend never appeared in Usage. Cause: extra usage off, so Claude Code silently ran standard speed. Fix: thread notice with the reason.
- **USAGE-003** (0.6.0): Older Codex costs missing from Usage. Cause: scanner skipped compressed `.jsonl.zst` rollouts and `archived_sessions`. Fix: read both, dedupe sessions, keep saved usage.
- **USAGE-001** (0.3.2): Effort variants showed as separate unpriced Usage rows. Cause: no model normalization or official rates. Fix: combine variants and add verified rates.
- **QUALITY-001** (`1bdb2510a7`): Abacus driver-registry test failed. Cause: expectation listed seven drivers and missed Zed. Fix: test expects the full registry.
- **ZED-003** (0.3.1): Zed Full access still asked approval for `pwd`. Fix: Full access runs commands without a prompt; Supervised shows an approval card.
- **PERMISSION-001** (Oct 13 sync): macOS asked for Downloads, Documents, Desktop and Music access during orchestration. Cause unknown. Obsolete: not seen since orchestration-v2 replaced the layers.
- **ACP-REVIEW-001** (Oct 13 sync): Read-only Antigravity review children could write through ACP `fs/write_text_file`. Obsolete: roles removed; delegated reviews run in throwaway snapshot clones.
- **DOC-PERMISSIONS-001** (Oct 13 sync): Docs said model-name permission overrides were gone while a helper still chose GPT and Claude modes. Obsolete: helper deleted.
- **AG-TURN-001** (Oct 13 sync): Native Antigravity turns wrote no per-turn usage logs because ACP responses carry no usage. Obsolete: usage comes from the native database scan.
- **QUOTA-RESET-001** (Oct 13 sync): An automatic interrupt cancelled reset-based continuation. Obsolete: fork reactor removed; upstream usage-limit recovery handles reset retries.
- **COORD-001** (Oct 13 sync): Reparenting, settle and worktree-reuse edge cases in the fork's coordination planner. Obsolete: planner removed with the orchestration layers.
- **WORKFLOW-001, WORKFLOW-002** (Oct 13 sync): Orchestration-layer verification gaps and strict Antigravity workflows. Obsolete: layer tools replaced by upstream `delegate_task`.
- **AG-QUOTA-001, earlier** (Oct 13 sync): The fork's quota converter dropped Antigravity Claude windows. Obsolete: upstream's probe reports one shared Claude & GPT bucket.
