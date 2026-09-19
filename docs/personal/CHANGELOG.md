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
- **Usage Model Display Names**: Normalized displayed model names in the usage accounting and breakdown views (`claude-opus-4-6-thinking` -> `claude-opus-4.6`, `deepseek-ai/DeepSeek-V4.1-Flash` -> `deepseek-v4.1-flash`, `zai-org/GLM-5.3-Flash` -> `glm-5.3-flash`).
- **ChatLLM Billing Reconciliation**: Proved exact RouteLLM credit valuation constant (1 credit = $0.0005) and diagnosed agentic loop token under-reporting in `AbacusAdapter.ts`.
- **ChatLLM Credit vs Subscription Separation**: Separated ChatLLM from subscription token counts and costs on the Usage page. ChatLLM compute points delta is captured once at the end of each turn (caching the balance to avoid redundant probes or loop accumulation overhead). ChatLLM is filtered out of the daily/hourly cost chart and all token displays. The Model Breakdown is structured into two dedicated tables: Subscription Models (Model, Cost, Share % of subscription, Tokens) and ChatLLM Models (Model, Cost converted from credits at $0.0005/credit, Share % of ChatLLM credits, Credits count with zero token metrics).
- **Codex & Credit-Based Model Accounting**: Added Codex available credits to the Limits tab underneath the weekly quota card. Added spillover turn tracking where Codex requests consuming credits are billed at $0.04/credit ($100 = 2,500 credits) and dynamically routed to the Credit-Based Models breakdown alongside ChatLLM. Standardized table headings to "Subscription Models" and "Credit-Based Models", and omitted the word "credits" from credit count columns.
- **Codex 90-Day Credit Backfill & Scan Cache v5**: Implemented parsing of Codex rate limit credit balances (`payload.rate_limits.credits.balance`) in `usageTranscripts.ts`, then reconciled the account-wide balance chronologically across live and retained rollout files. Duplicate token payloads update the balance baseline without creating usage records, and fork copies remain suppressed. `codex-auto-review` is forced to $0 and does not advance the paid-credit baseline. Bumped the scan cache schema to version 5 to persist raw balances and turn credits. The corrected local backfill is about 1,334 credits, not the earlier 3,661.50-credit overcount.
