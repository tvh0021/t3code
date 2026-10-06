# Changelog: Personal Fork Modifications

A concise, chronological record of custom changes made to this personal fork of T3 Code (oldest to newest).

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

See [the current handoff](./SESSION_HANDOFF.md) for retained evidence and remaining checks.

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
