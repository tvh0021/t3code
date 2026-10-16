# Changelog: Personal Fork Modifications

A chronological record of custom changes, oldest to newest. Entries describe
their date and may be superseded by later releases. Current behavior is in
[MODIFICATIONS.md](./MODIFICATIONS.md); audit verdicts and last-test scope are in
[VERIFICATION.md](./VERIFICATION.md).

---

### 2026-09-18

- **Sidebar Header**: Restructured title into a two-line layout (`T3 Code` / `personal`) with descender clearance.
- **Typography**: Increased default font sizes across UI, prompt, code, and terminal views.
- **ChatLLM Agentic Driver**: Added autonomous tool loop execution and command safety filters for ChatLLM (Abacus / RouteLLM).
- **ChatLLM Branding**: Added official vector icon and updated user-facing labels to "ChatLLM".
- **LaTeX Math Rendering**: Integrated KaTeX for inline and block mathematical typesetting in chat.
- **KaTeX Styling**: Adjusted vertical clearances for fraction denominators and square root vinculums to avoid clipping.
- **Provider Badges**: Cleaned up provider logos by omitting single-instance initials badges.
- **ChatLLM Usage Limits**: Added monthly compute points and billing reset countdown tracking.
- **Antigravity Usage Limits**: Added real-time quota tracking and reset countdowns.
- **Antigravity Quota Windows**: Simplified quota labels to "Session" and "Weekly", filtering out unsupported 3P models.
- **Antigravity Model Catalog**: Restored model picker catalog seeding for offline and newly launched states.
- **Upstream Sync**: Synchronized fork with upstream/main.
- **Token & Cost Tracking**: Added token usage and cost accounting support for Antigravity and ChatLLM.
- **Real-Time Turn Usage**: Added atomic per-turn token logging for Antigravity and ChatLLM sessions.
- **Historical Usage Ingestion**: Backfilled accurate Antigravity token counts from local conversation traces.
- **Pricing Catalog**: Updated the model API rate catalog and fallback pricing.
- **ChatLLM Point Pricing**: Verified compute point conversion rate and local disk logging behavior.
- **Table & Inline Math**: Added LaTeX rendering support inside markdown tables and bold/italic wrappers.
- **Unified Gemini 3.8 Flash Accounting**: Unified usage accounting across all Gemini 3.8 Flash tiers (`high`, `medium`, `low`, `tiered`) into a single model entry.
- **Antigravity Usage Label**: Standardized usage presentation label from "Anti Gravity" to "Antigravity" across web and mobile.

### 2026-09-19

- **Usage Model Names**: Normalized display names for Claude Opus 4.6, DeepSeek V4.1 Flash, and GLM 5.3 Flash.
- **ChatLLM Usage Accounting**: Confirmed compute-point pricing at $0.0005 per credit and fixed turn-level usage tracking.
- **Usage Breakdowns**: Separated subscription models from credit-based models and excluded credit usage from token totals and cost charts.
- **Codex Credit Accounting**: Added Codex credit balances, credit-based model reporting, and spillover billing at $0.04 per credit.
- **Codex History Backfill**: Reconciled 90 days of Codex transcript history (including forks and duplicate events) using scan-cache v5, excluding `codex-auto-review` from credit usage, for a corrected backfill of about 1,334 credits.
- **Zed ACP Provider**: Added headless Zed agent support over ACP with Claude Sonnet 5 and GPT 5.6 Luna model selection, marked as an in-development integration not yet listed as release-ready.
- **Zed Permission & Usage Fixes**: Corrected ACP permission-option selection and started forwarding Zed's context-token usage into the shared usage meter.

### 2026-09-20

- **Zed Live-Test Gating**: Gated the real-binary Zed smoke test behind an opt-in environment variable so it no longer requires network access to run by default.

### 2026-09-21

- **Zed Streaming Repair**: Suppressed repeated completed-tool snapshots that split answers mid-word and flooded the activity list.
- **Zed Streaming Verification**: Verified one intact Markdown answer after a real Sonnet file-read turn in an isolated client, though the wider Zed integration remains under development.
- **Zed Approval Flow Verification**: Tested Zed Luna approval and decline flows in the browser without a crash.
- **Zed Context Meter**: Resolved context-window reporting for the headless Zed bridge.
- **Zed Account Usage**: Reports account spend as unavailable because Zed's billing routes reject the native credential and require a dashboard browser session. The Limits view no longer shows a zeroed or session-derived account bar.
- **Zed Test Suite Migration**: Converted the adapter tests to the standard Effect test runner and cleared their lint warnings.

### 2026-09-22

- **Performance Guardrail**: Added a timed 20,000-bucket usage-merge regression test and removed an extra aggregation pass.
- **Markdown Fast Path**: Skipped math preprocessing and plugins for messages without math delimiters.
- **Upstream Sync**: Merged the latest `upstream/main` without conflicts.

### 2026-09-24

- **Mobile Usage Compatibility**: The personal host sends Usage contract v5 to App Store mobile 1.2.x and 1.3.x clients. This restores supported Claude, Codex, and Grok usage without changing the signed iOS app; newer clients still receive v6.
- **Mobile Usage Scope**: Codex usage billing is working on the phone. Antigravity and ChatLLM usage remain absent from the 1.3.0 Usage tab because that app release has no provider entries for them. Their Limits data is separate.

### 2026-09-27: Personal 0.0.42.2

- Added thread MCP tools for cross-model and cross-provider handoffs. Corrected GPT-6 current/legacy grouping.
- Added persisted flat workflows with child queues, durable reports, shared model budgets, parent wakeups, and lifecycle controls across web and mobile.
- Added named limits, price-band defaults, monthly model/pricing maintenance, and per-model overrides. Active workflows retain captured budgets.
- Added provider worker restrictions and a companion Zed `--worker-mode` implementation. Added ChatLLM parent MCP access and Zed forwarding with explicit worker tool allowlists. At this point, Antigravity could serve only as a child.
- Fixed review approval policy, write-tool enforcement, turn correlation, startup ordering, active-member lifecycle guards, terminal-parent capability restoration, and interrupted-turn approval cleanup. Added completion-before-acceptance and restart reconciliation tests, detached review snapshots, cleanup recovery, and read containment for ChatLLM.
- Verified ordinary desktop threads and a four-child Sol workflow with two Luna and two Gemini children. All four children reported substantive findings; the parent applied them and the fixture passed 10/10 tests. A shared child-start command ID was fixed after the first runtime attempt started only one child.
- Corrected completed workflow report labels in web and mobile. Focused coordination tests passed 13/13, targeted lint and formatting passed, and server/client-runtime/mobile typechecks passed. Web typechecking still has unrelated HAST type errors. Zed native MCP discovery and remote/mobile UI flows remain unverified.

Audit reviews now use GPT 6 Sol at low reasoning, as requested.

### 2026-09-28: Personal 0.1.0

- Added opt-in quota handoff for T3 orchestration layers with a 95% default threshold, ordered environment fallbacks, one automatic provider switch, and reset-based continuation when no fallback qualifies.
- Simulated Luna XHigh at 95% and observed a linked Gemini child, source settlement, summary turn, and continuation prompt. Simulated an elapsed reset with a fresh 12% Luna reading. Fixed lost XHigh options and stale reset details found by the probe. Real quota exhaustion and provider continuation remain unverified.
- Allowed Antigravity to parent a layer after the managed Gemini 3.8 Flash High runtime called T3's `read_thread` and `start_orchestration_layer` tools in an isolated dev thread. The server persisted an active Gemini parent with quota handoff enabled. A complete Gemini parent and child report cycle remains unverified.

See [the historical handoff](./SESSION_HANDOFF.md) for retained evidence and
[the issue tracker](./ISSUE_TRACKER.md) for current remaining checks.

### 2026-09-28: Personal 0.1.1

- Prevented a parent from continuing coordination tool calls in the same turn after `wait_for_children`.
- Allowed Antigravity review and edit children to call the scoped T3 report and read tools without an approval prompt. Other tool requests still require approval.
- Updated the Zed ACP worker tool names and permissions. Rebuilt the worker binary and verified a Zed review child report.
- Verified a live quota handoff from a Codex Luna child at 95% to a Gemini Flash High child. The Gemini child reported, and the parent resumed and completed the layer.
- Set the web, desktop, and server package versions to 0.1.1 so About shows the release version.

### 2026-10-05: Personal 0.1.2

- Antigravity starts every model with full access on new sessions and resumes. Existing turns keep running. Web, desktop, and mobile permission selectors show only Full access for Antigravity. The saved thread or draft preference returns when users switch providers. Provider policy compares effective session modes to avoid redundant restarts. GPT review and edit children inherit their parent's mode.
- Removed model-name permission overrides from coordination policy. The provider boundary now owns that decision.
- Two real Zed and Sonnet 5 probes created files in isolated workspaces with zero approval requests under both Supervised and Full access. This covers file creation only, not terminal permissions. No Zed code changed.
- Kept the current Zed bridge after reviewing Delta's official docs. Delta documents its CLI for app launch and authentication. Its planned ACP work brings external agents into Delta. Its safety docs say Delta has no permission system or sandbox. These sources do not establish an agent-side ACP path for T3. See the [CLI docs](https://delta.dev/docs/installation), [roadmap](https://delta.dev/roadmap), and [agentic safety docs](https://delta.dev/docs/privacy-and-security/agentic-safety).
- Focused verification passed 257 tests and scoped contracts, server, and mobile typechecks. An Antigravity subprocess probe covered all four saved permission preferences on initial start and three resumes. Web typechecking still reports 11 pre-existing HAST errors in untouched files. No authenticated Google inference or browser/native-mobile UI pass was run.

### 2026-10-05

- Zed discovers its hosted catalog through the companion bridge's `--list-models`
  command using existing sign-in. Manual and periodic refreshes select one newest
  Sonnet and one newest Luna, preserve custom models, and retain the previous
  catalog on failure. Live discovery selected Sonnet 5.5 and GPT-6 Luna.
- Verified 27 focused tests, with one hosted smoke test skipped, server
  typechecking, targeted lint, bridge compilation, and Rust formatting. The old
  direct-binary streaming harness fails with `no language model configured`; it
  does not use the changed provider discovery path.
- Rebuilt Personal 0.1.2 for macOS arm64 in an isolated checkout. The DMG and ZIP
  are under `release/zed-catalog-20261005/`. The installed app and running server
  remain unchanged.

### 2026-10-06: Personal 0.1.3

- Fixed the companion Zed bridge crash when native tools call `search_web` by initializing the headless web-search registry and providers.
- Forwarded native subagent tool updates and approvals, including approvals already waiting when a child or nested child is attached. Permission answers reach the requesting child. Child tool IDs are distinct, and child text does not replace the parent answer.
- Kept tool titles, inputs, output, content, and locations current as calls stream. Identical snapshots are suppressed. Prompt failures return an ACP error instead of a successful completion.
- Seven bridge tests passed, including the startup, permission, nested-child, and streamed-tool regressions. A real Sonnet 5.5 turn completed a child web search and parent file read, including one child approval; all 31 captured messages passed T3's ACP schemas.
- Requires companion Zed commit `317b394ae4` on `integration/zed-abacus`. The macOS arm64 desktop release excludes unrelated pending Antigravity edits. Website `403 Access Denied` responses remain upstream website restrictions.

- Published the macOS arm64 DMG and ZIP, reinstalled Personal, and confirmed About reports `0.1.3 (39dac3cbf8f9)`. In the installed app, a supervised Sonnet 5.5 parent read and native child search completed with one resolved child approval. A second turn read the fixture successfully. The session returned to ready with no error. Initial startup exceeded the desktop readiness timeout; reopening restored the window, and cold-start timing remains tracked as DESKTOP-001.

### 2026-10-06: Personal 0.1.4

- Fixed repeated macOS Documents permission requests after installing a new Personal build. Builds now retain a local signing identity instead of tying permissions to a changing executable hash.
- Automatic Keychain requests no longer interrupt launch with password dialogs when an old or locked credential is inaccessible. Encryption stays enabled; explicit browser-cookie imports can still request Keychain approval.
- Installed the repaired app and verified two normal launches with existing projects and threads. macOS logs showed no Documents or Keychain prompts. Passed 107 focused tests, desktop typechecking, targeted lint, and signature verification.
- This patch excludes pending Antigravity changes. The previously recorded cold-start timeout remains a separate issue.

### 2026-10-06: Personal 0.1.5

- Antigravity native task results now appear in the work trace without ending the active prompt. Ordinary text, quoted or incomplete markup, and foreign-session notifications remain chat content.
- Zed catalog refresh removes retired built-in models while preserving custom settings. Fixed a restart gap found during runtime verification: a pending or failed startup probe now preserves the cached discovered inventory instead of restoring old seed models.
- ACP provider errors include transport details, including the explanation when an agent ignores cancellation and its process is stopped.
- Verified seven probes through a real isolated server and WebSocket client using controlled ACP executables. Task reporting, ordinary replies, foreign-session content, cancellation errors, successful and failed catalog refreshes, and restart hydration passed. All 155 focused tests, server typechecking, and targeted lint passed. Live Google inference, mobile UI, and remote connections were not exercised.
- Recorded the separate open issue for orchestration requesting access to unrelated macOS folders. Corrected its placement in the issue notes; this release does not resolve that issue.

### 2026-10-06: Personal 0.2.0

- **Zed thinking effort**: Model controls use native supported effort values and defaults. Selections reach the ACP bridge before prompts and survive thread reloads. Model switches retain only compatible values. Requires companion Zed bridge commit `11708bd472` or later.
- **Verification**: Two hosted Luna turns completed through the browser at Low and High effort, including a replacement provider session. Focused T3 and native bridge tests, scoped typechecks, and targeted lint passed. Native mobile and remote/relay runtime verification remain pending.

### 2026-10-08: Personal 0.3.0

- Added account-discovered Claude Opus 5.5 and Sonnet 5.5 low, medium and high variants alongside Gemini in Antigravity. The shared ACP boundary uses the recognized Zed client identity and managed ACP 1.3.0. Availability depends on the Google account and Google's undocumented client allowlist.
- Kept the six Claude variants current after upstream catalog refreshes without adding models absent from account discovery.
- The isolated release snapshot passed 167 focused tests, server typechecking, scoped lint and formatting. The shared checkout previously passed 168 tests including a pre-existing test outside this release. Earlier live checks covered Claude turns, resume, cancellation and Sonnet branch generation. An October 8 full-adapter Gemini turn passed on the new network.
- Installed Personal 0.3.0 and updated its managed runtime through Settings. About, retained projects and threads, provider refresh and model selection passed. One thread completed exact-response turns with Opus Medium, Sonnet Medium and Gemini High, then reopened with all replies and the Gemini selection retained. Deep signature verification passed with the existing Personal certificate in a temporary keychain. Remote, tunnel and native mobile paths remain untested.

### 2026-10-08: Personal 0.3.1

- HTML file links open in the system browser by default. Their context menu offers both system and integrated browsers where supported. Files are served from their owning environment, including files outside the workspace. PDF behavior remains unchanged.
- Aligned KaTeX markup and styles at 0.18.7 to fix overlapping vector accents. Aligned HAST types used by the markdown and syntax renderers.
- Provider commands process up to four threads concurrently while preserving command order within each thread. A slow authentication attempt no longer blocks startup for every other thread.
- ACP errors retain the native operation and bounded, sanitized text details. Authentication failures include the actionable native error and allow a subsequent retry after cleanup.
- Fixed excessive regex backtracking when Antigravity emits an incomplete task notification followed by whitespace.
- All 297 focused tests passed. Server, shared and web typechecks and scoped lint passed. Installed 0.3.1 passed About, retained projects and threads, Settings navigation, two Codex turns and thread reopen. HTML primary click loaded the served test document in Safari Work; the integrated browser alternative loaded the same document. Inline and display vector arrows cleared their base letters. The candidate DMG and deep signature passed verification with the existing Personal identity. Native mobile, remote/relay/tunnel and full parent/child orchestration were not exercised. An extra Gemini turn could not be completed because computer use returned stale picker controls. Network-specific Gemini onboarding failures remain outside these repairs.

### 2026-10-11: Personal 0.3.2

- The Usage breakdown combines reasoning-effort and thinking variants of each model. Antigravity's `gemini-pro-agent` is grouped with Gemini 3.1 Pro, matching the provider's Pro High model label.
- Updated the API-equivalent pricing reference from official OpenAI, Anthropic and Google sources, including Claude Opus 5.5 and Sonnet 5.5. Verified rates take precedence over the public catalog; custom prices and provider-reported costs retain their priority. Estimates use standard base-context rates and exclude Gemini cache storage fees.
- Effort-specific custom prices apply before rows combine, preserving their individual costs. Codex auto-review keeps its existing zero-cost accounting without a guessed API token rate.
- All 85 focused tests, contracts/shared/server typechecks, scoped lint and formatting passed. The installed 0.3.2 candidate passed About, retained project loading, Settings, Usage refresh and Model/Day switching. Sonnet 5.5 combines 193K tokens in one priced row, Opus 5.5 combines 3.96M tokens, and Gemini 3.1 Pro replaces the old alias. Two Codex Luna turns completed in a disposable project; reloading retained both replies and the model. DMG/ZIP integrity and deep signature checks passed with the existing Personal identity. Diagnostics showed optional-tool/configuration misses and backend startup probes, with no Usage or smoke-turn failure. Native mobile and remote/relay/tunnel runtime paths remain untested.

### 2026-10-11: Changelog quality audit

Reviewed all 93 preceding bullets against current source and available runtime
interfaces. Recorded per-item verdicts, evidence and coverage gaps in
[VERIFICATION.md](./VERIFICATION.md), and new quality failures in
[ISSUE_TRACKER.md](./ISSUE_TRACKER.md). Reconciled the personal notes without
changing implementation code. This audit does not establish a full-app PASS.

### 2026-10-13: Fork code cleanup

Cleaned up fork-added code without intending any behavior change. Checkpoint
before the cleanup: tag `pre-cleanup-2026-10-13` (commit `1bdb2510a`). Each
change is its own commit and can be reverted alone.

- Deleted dead code, unused exports and stale comments in the provider adapters, usage parsing, web, contracts and build scripts.
- Reverted cosmetic edits to upstream files, including upstream's provider badge helpers that an earlier sync had silently reverted.
- Shared duplicated logic: coordination decider pauses and quota checks, coordination ids and completion commands, provider role checks, usage source registration and pricing lookups, web/mobile coordination controls, and mobile usage labels.
- Moved provider-specific coordination worker rules from contracts to the server's provider boundary.
- Simplified the web Usage page. Its five existing render fixtures produce byte-identical markup.
- Condensed the personal notes. VERIFICATION keeps all 93 audit rows; local evidence paths are marked as not preserved in the repo.
- Excluded behavior changes found during the audit. They remain open for a separate decision: the Abacus tool description, Codex usage-limit window mapping, provider label casing, web/mobile copy, Antigravity database caching, duplicate startup quota probes, and the hidden ChatLLM column count.

Verification ran focused tests and typechecks only. Every focused test file
for the changed code passed, as did the server, contracts, shared,
client-runtime, web and mobile typechecks. Mobile was typechecked but not run. `build-desktop-artifact`'s Windows
cross-architecture test fails both before and after the cleanup. No runtime
check of the app was done at the time; the 0.3.3 entry records the later
runtime check.

### 2026-10-13: Personal 0.3.3

Maintenance release of the fork code cleanup, with no intended behavior change.

- Includes the cleanup above and five follow-ups. GitManager's PR-lookup failure handling is back in upstream's shape. The never-emitted `coordination` field is gone from thread meta-update payloads. `planCoordination` delegates to one function per action. Antigravity turn usage, the Antigravity model seed and markdown math preprocessing moved into fork-owned modules.
- Removed the per-file Codex credit delta. Cross-rollout reconciliation already replaced it for every record with a balance, so reported credits and costs are unchanged. Old usage scan caches still load.
- Recorded edge cases found during the cleanup as COORD-001 and CODEX-CREDIT-001 in the issue tracker. Neither is fixed here.
- Verification: 1,117 focused tests passed across 57 files, plus affected package typechecks. The release lint fix uses `it.effect` in `coordinationIds.test.ts`; its two tests passed again before installation. Scoped lint retains two pre-existing errors in `antigravityUsageLimits.ts`. Installed macOS arm64 0.3.3 passed About, retained project/thread loading, Settings, model selection, two Codex Luna turns, thread reopen, Usage refresh and inline/display math rendering. Native mobile and remote/relay/tunnel paths were not exercised. Full coordination workflows and fresh Antigravity inference were not replayed.

### 2026-10-13: Upstream sync to orchestration-v2

Merged upstream `42160f2925`. Upstream had replaced the server orchestration
with orchestration-v2 and moved providers into `packages/provider-*`.

- Replaced T3 orchestration layers with upstream's `delegate_task`, adding the fork's per-model turn budgets and read-only review snapshots as guards.
- Rebuilt quota handoff on upstream's usage-limit recovery worker. A limited thread resumes on the first mapped fallback model whose quota is fresh and below the threshold.
- Adopted upstream's Antigravity quota probe, its shared "Claude & GPT" bucket and its SQLite usage scanner. ChatLLM keeps the live turn-usage writer.
- Ported the Zed and ChatLLM providers to orchestration-v2 adapters and drivers. Kept upstream's usage scan cache and added the Codex credit balance to its v6 rows.
- Verification: server, contracts, client-runtime, provider-core, web and desktop typechecks passed. 700+ focused tests passed across the touched areas. Migrations ran cleanly on a read-only copy of the personal V1 database. Two upstream Antigravity client-file tests fail on macOS: new files under not-yet-created directories in a symlinked temp path are rejected. That code is upstream's and unchanged here. Mobile, the installed app and live delegation and quota handoff were not exercised.

### 2026-10-14: Personal 0.4.0

Feature release of the upstream orchestration-v2 sync above.

- Clearing the delegated task limit overrides now removes them. The server had deep-merged the empty map, so a cleared field reported success but kept the old entries. This bug predates the sync.
- Removed `coordinationWorkerPolicy.ts`, which only the removed orchestration-layer code used.
- Dev desktop verification, October 14: two GPT-6.1 Sol High workers drove an isolated `vp run dev:desktop` with this worktree's migrated September dev state (14 projects, 322 threads). Passed: migrated history, Settings, Usage, personal header and fonts, Zed/ChatLLM/Antigravity listing, two Codex Luna turns with thread reopen, a `delegate_task` Luna child shown under Previous agents, and saving then clearing a delegated limit override. Not exercised: a live quota fallback and a `reviewRef` review snapshot. Evidence: `/private/tmp/t3-sync-verification/` (local, not preserved).
- Installed-app verification, October 14: native About reports 0.4.0 at `a97e3bb66ef8`. Retained conversations, Settings, provider listing, Usage limits, Luna model selection, two ordinary turns with thread reopen, and saving then clearing a delegated limit override across reloads passed. Deep signature verification and all four artifact checksums passed. Evidence: `/private/tmp/t3-personal-0.4.0-release/verify/`. Live quota fallback and `reviewRef` review snapshots remain untested. Mobile verification is outside this fork's scope.

### 2026-10-14: Personal 0.5.0

- Limits shows Zed account spend against the monthly limit, with the billing-period reset, from Zed's dashboard billing routes. Desktop users connect with **Connect** in Zed provider settings; other clients paste the dashboard Cookie header into **Dashboard session**. The session is stored in the host's secret store.
- Spend is read when the provider starts and after each Zed turn, never on a timer. A missing, expired or failing session shows an explicit notice instead of a bar. See ZED-001.
- Verification: focused tests for the billing read, the Zed snapshot states and `replaceUsageLimits` pass. Server, web, desktop, contracts and provider-core typechecks pass. No live signed-in read has been done yet.

- Fixed Antigravity file creation in new directories when the workspace path passes through a symlink, including macOS `/var`. Added a regression test for this case.
- The earlier installed 0.4.0 verification confirmed a `reviewRef` child uses a separate checkout at `HEAD~2`, preserves the parent worktree, and rejects an invalid ref. Live quota fallback remains untested.
- Release checks passed: 278 focused tests, five affected package typechecks, formatting and scoped lint with existing warnings only. Installed 0.5.0 passed native About, retained history, Settings, model selection, two Codex Luna turns with thread reopen, the missing-session Limits notice, and Zed Connect opening GitHub sign-in and cancelling cleanly. Deep signature and DMG integrity checks passed.
- Live Zed billing and session lifetime remain unverified; organization billing is unsupported. Remote/web runtime checks were not run. Mobile verification is outside this fork's scope. The separate ChatLLM cookie-storage issue is unchanged.

### 2026-10-14: Personal 0.5.1

- Fixed Zed turns failing after the October 13 upstream sync. The adapter now sends the selected model even when the bridge does not advertise a model setting, then reads that model's thinking-effort options before applying the requested effort.
- The thread's selected model also reaches the bridge's startup `--model` argument, which initializes authenticated model discovery before session creation. A native no-inference probe reproduced `Model not available` without that argument and passed with it.
- Added regressions for Sonnet 5.5 with Low effort against a bridge that advertises no model setting, and for passing the thread model instead of a different provider default at startup.
- A signed-in 0.5.0 check confirmed Limits reads account spend, showing $9.43 of $10.00. That billing connection is separate from the turn-start failure.
- Verification passed: 94 focused tests, server and provider-acp typechecks, scoped lint and formatting. Installed 0.5.1 completed two real Zed Sonnet 5.5 Low turns in a new thread, with a reopen between turns. Native logs confirm successful model and effort configuration and both prompts. Retained history, Settings and account spend in Limits loaded. Signature and DMG integrity checks passed.
- Mid-thread model switching still follows the shared ACP adapter's capability check and may restart the session. Remote runtime checks were not run; mobile verification is outside this fork's scope. Session lifetime and direct dashboard comparison remain unverified.

### 2026-10-15: Personal 0.6.0

- Restored older Codex cost estimates. Codex compresses old rollouts to `.jsonl.zst`, which the scanner previously skipped. The scanner now decompresses those files and also reads `archived_sessions`, counting duplicate sessions once.
- Added All time to desktop and web Usage, with `Cmd/Ctrl+Shift+5` and a saved period preference. The chart and date label start at the first recorded day.
- Saved transcript usage no longer expires after 92 days, so it survives provider cleanup. Cursor's account-API cache still retains 92 days. The scan cache grows with history but stores usage records, not transcripts. Usage deleted before its first scan cannot be recovered.
- Changed Zed Limits wording to `$X of $Y spent`, or `$X spent, no limit`. The billing source and refresh behavior are unchanged.
- The handoff's read-only audit parsed all 1,013 Codex rollouts without failures. Of those files, 558 of 640 active and 354 of 373 archived rollouts were compressed. Antigravity already reads all of its conversation databases without an age cutoff and needed no change.
- Verification passed: 521 focused tests, followed by 55 tests covering additional All time date/persistence checks and a year-old saved-usage restart. Server, web, shared and contracts typechecks pass. Formatting and scoped lint pass with the existing unused `layerTest` warning.
- Installed arm64 0.6.0 passed native About, retained thread content, Settings, Luna model selection, two Codex turns with a reopen, 90-day and All time history, both period-control layouts, all five period shortcuts, preference reload and the signed-in Zed spend label. All time begins May 27 and shows a higher Codex total than 90 days.
- The first 90-day scan took 3.46 seconds in the server trace. The first All time scan, after that warm-up, took 1.24 seconds and appeared within 1.9 seconds; warm scans took 0.07 to 0.17 seconds. No rate-table or partial-source notice remained. Existing unpriced model records remain visible. Logs show startup readiness retries and unrelated source-control discovery failures, with no UsageService failure. Deep signature, DMG integrity and ZIP checks pass. Local evidence is under `/private/tmp/t3-personal-0.6.0-release/verify/`.
- USAGE-002 remains open. Cursor is not configured in the tested Usage view, so its live account path was not exercised. Mobile has no All time option and is outside this fork's verification scope. Remote and standalone web runtime checks were not run.

### 2026-10-15: Personal 0.6.1

- Claude threads now show a notice when Claude Code turns fast mode off, with the reason it gives, such as extra usage being off for the account. Previously the composer kept showing Fast while every request ran at standard speed, so Usage correctly showed no Claude Fast spend. See USAGE-004.
- ChatLLM turns now allow 200 tool calls on Flash models and 50 on other models, up from 20 for every model. Reaching the limit ends the turn with a visible message naming it, instead of a silent `completed` with no answer. The skipped batch no longer leaves unanswered tool calls in history, and the request timeout applies per request rather than per turn. See CHATLLM-STEPS-001.

- Release checks passed 264 provider tests and the server typecheck. Scoped lint has two existing Abacus `process.platform` errors and unused-code warnings, reproduced on the unchanged baseline. The Abacus file has existing formatting drift; the release preserves its surrounding style. The other ten changed files pass formatting.
- Installed arm64 0.6.1 passed native About, retained conversation content, Settings, model selection, two Claude turns with a reopen, and the Fast fallback notice for `extra_usage_disabled`. A GLM-5.3-Flash turn read 24 fixture files with separate tool calls and returned every token, passing the former 20-call ceiling. Its follow-up after reopen also passed. Deep signature, DMG integrity and ZIP checks pass. Evidence is under `/private/tmp/t3-personal-0.6.1-release/verify/`.
- The 50/200 ceilings and clean history after a skipped batch are covered by adapter tests. A full delegated review and a live ceiling-length run were not repeated. Trace failures were startup readiness retries, source-control discovery in the temporary repository and missing workspace metadata files. Remote and standalone web runtime checks were not run; mobile verification is outside this fork's scope.

### 2026-10-16: Personal 0.6.2

- Antigravity Limits show the Gemini pool again. The quota probe stopped at Google's daily endpoint, which returned only the Claude and GPT group; it now merges both endpoints. See AG-QUOTA-001.
- Verification: all eight Antigravity limit tests, the server typecheck, scoped lint and formatting pass. A live read-only query confirmed the two endpoints' different answers.
- Installed arm64 0.6.2 passed native About, retained conversation content, Settings, Luna model selection, two Codex turns with a reopen, and Limits refresh. Antigravity shows both Gemini windows and both Claude & GPT windows. Deep signature, DMG integrity and ZIP checks pass with the existing Personal identity. Local build artifacts and backup are under `/private/tmp/t3-personal-0.6.2-release/`.
- Standalone web and remote/relay/tunnel runtime checks were not run. Mobile verification is outside this fork's scope. The possible ChatLLM Usage incompatibility with 2.x phones remains unverified.

### 2026-10-16: Personal 0.6.3

- The App Store 2.0.0 Usage tab works with this host again. It rejected every Usage response because ChatLLM entries are unknown to upstream's provider list, and forward-compatible arrays do not drop unknown entries inside RPC replies. The host now removes ChatLLM entries for mobile releases after 1.3.x. See MOBILE-002.
- Verification: six projection tests, the server typecheck, scoped lint and formatting pass. Upstream contracts with effect 4.0.5 decode the projected 24h, 7d and 30d payloads and reject the unprojected ones. Deep signature and DMG integrity pass with the existing Personal identity.
- Installed arm64 0.6.3 relaunched with retained state, and the user confirmed the App Store 2.0.0 Usage tab now shows activity over the learned LAN route. Native desktop UI was not exercised by the agent because no computer-use tool was available. app.t3.codes clients are not projected and remain untested. Local artifacts and the 0.6.2 backup are under `/private/tmp/t3-personal-0.6.3-release/`.
