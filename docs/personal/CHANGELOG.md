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
