# Issue tracker

Open issues, known limitations, and a short record of resolved issues to check
before diagnosing a new bug. Release history is in [CHANGELOG.md](./CHANGELOG.md).

## Open issues

### CHATLLM-CANCEL-001: ChatLLM turns can't be stopped or steered and never show as finished

Open since 2026-10-26.
Problem: A ChatLLM thread, including a delegated subagent, ignores Stop from the
user and `t3_thread_interrupt` from the orchestrator agent until the turn ends on
its own or the server restarts, and queued steers wait just as long. After the
turn does end, the thread still shows as running, so it can't be steered then
either.
Cause: Two defects in `AbacusAdapterV2`. (1) `startTurn` runs the whole tool loop
inline instead of forking it into the session scope the way `ClaudeAdapterV2`
does, so the `provider-turn.start` outbox effect stays `running` for the entire
turn. The outbox claims one effect per thread at a time, so
`provider-turn.interrupt` and later effects sit unclaimed behind it. (2) The
adapter emits `provider_turn.updated` with status `running` at the start and
`turn.terminal` at the end, but never a `provider_turn.updated` with
`completed`, so the provider-turn projection row stays `running` forever.
Done when: Stop and `t3_thread_interrupt` end a ChatLLM turn within seconds while
a tool call is in flight, a steer queued mid-turn is delivered, and finished
ChatLLM turns show `completed` in the provider-turn projection.
History: On 2026-10-26 the "12-month flight-time sample (GLM 5.3 Flash)" subagent
collected 47 unclaimed interrupt effects between 17:03 and 17:52 UTC with
attempt count 0; all were cancelled by the server shutdown at 17:52:40, which is
what finally ended the turn. Its sibling "Flight-time cross-check" finished at
15:25 UTC yet still shows a running provider turn. Every ChatLLM provider turn
since the projection began on 2026-10-15 is `running` (27 of 28; the other is
the shutdown cancellation). Claude, Codex, Antigravity and Zed turns complete
normally, and their interrupts run within a second. Interrupt itself is wired
correctly (`interruptTurn` sets the cancel flag, kills the current command and
aborts the request); it just never gets called in time.

### ZED-CONTEXT-001: Zed context meter gets no token usage

Open since 2026-10-12.
Problem: The context meter stays empty for Zed threads.
Cause: The companion Zed bridge never sends ACP `usage_update`; T3's adapter handles it when present.
Done when: the bridge reports context use and capacity for new and resumed sessions, and the meter shows it.
History: Native Zed session storage holds nonzero input and output token counts, but the captured ACP stream has no usage updates.

## Known limitations

- **ChatLLM ledger days are UTC**: Abacus bills by UTC day, so ChatLLM credits land on the UTC date even when Usage uses another time zone; turn tokens use local days.
- **App Store 1.2 and 1.3 Usage** (MOBILE-001): these phone apps show only Claude, Codex and Grok usage. The host sends them the older Usage format.
- **ChatLLM on the phone**: newer phone apps don't know the ChatLLM provider, so the host leaves ChatLLM out of their Usage tab (MOBILE-002). Desktop and web show it.
- **app.t3.codes Usage**: the hosted web app probably fails Usage against this host the way the phone did, because it receives ChatLLM entries. Untested.
- **Antigravity on eduroam** (WORKFLOW-003): Antigravity sign-in times out because eduroam's IPv6 path stalls and the native client has no IPv4 fallback. Hotspot and other networks work.
- **Zed organization billing**: Zed Limits reads personal billing only. Organization billing is not supported.
- **Malformed Zed updates** (ZED-UPDATES-001): since the 2026-10-17 sync, the shared ACP adapter drops session updates it can't decode instead of failing the turn. Watch for Zed turns that end with missing text or tool output.
- **Zed effort tests** (ZED-TEST-001): the legacy Zed tests that checked per-model effort lists and rejected unsupported effort values were removed with the pre-v2 adapter. `ZedAdapterV2.test.ts` covers only model-then-effort ordering.

## Resolved

- **CHATLLM-USAGE-002** (0.7.5): ChatLLM credits diverged from Abacus's dashboard. Cause: balance changes missed delayed charges and mixed concurrent turns. Fix: use daily ledger credits.

- **USAGE-008** (0.7.5): Usage listed an unpriced `<synthetic>` Claude model. Cause: local errors and interruptions entered usage scans. Fix: aggregation skips synthetic messages, including cached records.

- **USAGE-002** (0.7.5): Day provider costs exceeded Total. Cause: provider columns included credit spend excluded from totals. Fix: periods consistently count subscription costs.

- **CHATLLM-USAGE-001** (0.7.4): ChatLLM undercounted first-turn credits and tool-loop tokens. Cause: missing starting balance and overwritten usage. Fix: share an initial baseline and sum requests.

- **USAGE-007** (0.7.4): Antigravity usage had unknown models and missing prices. Cause: incomplete model attribution and pricing. Fix: recover names, normalize aliases and price Argon.

- **AG-QUOTA-002** (0.7.3): Gemini quotas showed incorrect balances and omitted Argon. Cause: an outdated client version selected incomplete quotas. Fix: request current quotas and hide unused-window countdowns.

- **ZED-CREDITS-001** (0.7.3): Zed failures hid credit errors. Cause: the adapter discarded bridge error text. Fix: preserve the reason and classify exhausted credits as usage limits.

- **ZED-RESUME-001** (0.7.2): Zed continuation failed after restart. Cause: the unsupported-resume error bypassed recovery. Fix: identify the failed method so context recovery runs.

- **ZED-RESET-001** (0.7.2): Zed showed "resets now" after rollover. Cause: stale billing period and cached spend. Fix: advance the period and reread spend once.
- **ZED-VERSION-001** (0.7.1): Zed always showed version 0.1.0. Cause: T3 and the bridge both hardcoded it. Fix: T3 reads the bridge's `--version`, which comes from its Cargo version.
- **ZED-CATALOG-001** (0.7.0): A restart after failed Zed discovery restored retired models. Cause: failed discovery reported ready. Fix: it reports a warning, and the registry keeps the last catalog.
- **ZED-MODELS-001** (0.7.0): Hidden Zed `customModels` weren't wired to the picker. Cause: discovery kept only two hosted models. Fix: refresh lists every hosted model, so custom entries aren't needed.
- **USAGE-005** (0.6.4): Antigravity tokens counted about 3×. Cause: id-less Gemini usage repeated in step, generation and retry records. Fix: identical id-less totals within a database count once.
- **USAGE-006** (0.6.4): Codex credits counted twice. Cause: `sessions` and `archived_sessions` reconciled separately. Fix: each Codex home reconciles as one balance timeline.
- **CHATLLM-WRITE-001** (0.6.4): ChatLLM `write_file`/`edit_file` followed symlinks outside the project. Cause: writes compared path text. Fix: writes check the real path, as Antigravity's file tools do.
- **ZED-001** (0.5.0): Zed Limits needed real account spend. Cause: native credential can't read billing. Fix: dashboard cookie session; user confirmed spend matches the dashboard.
- **CODEX-CREDIT-001** (closed 2026-10-16, no fix): Parser skips a repeated `token_count` payload with a newer credit balance. Never observed; totals unaffected.
- **MOBILE-002** (0.6.3): Phone Usage empty on App Store 2.0.0. Cause: unknown abacus provider fails the whole RPC decode. Fix: host drops ChatLLM entries for mobile.
- **AG-QUOTA-001** (0.6.2): Antigravity Limits missing the Gemini pool. Cause: `antigravity/hub/1.0.0` made the daily endpoint omit Gemini. Superseded by AG-QUOTA-002.
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
