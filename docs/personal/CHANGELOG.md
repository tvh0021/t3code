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
