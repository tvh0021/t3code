# Changelog: Personal Fork

User-visible changes per release, newest first. Current behavior is in
[MODIFICATIONS.md](./MODIFICATIONS.md); open problems are in
[ISSUE_TRACKER.md](./ISSUE_TRACKER.md).

---

### 0.6.5 (2026-10-17)

- New feature: upstream sync through 2026-10-17
- Change: a delegated review (`reviewRef`) now runs in an upstream-managed worktree at that commit, with the project's setup script, instead of a fork clone. Old clones in `<T3 home>/worktrees/coordination-reviews` are no longer cleaned up and can be deleted by hand
- Issue: Claude Fast turned on partway through a thread got no notice when Claude Code declined it → Fix: the notice follows the thread's current selection

### 0.6.4 (2026-10-16)

- Issue: Antigravity tokens counted about three times → Fix: repeated id-less usage within a database counts once (USAGE-005)
- Issue: Codex credits counted twice → Fix: sessions and archived sessions share one balance timeline per Codex home (USAGE-006)
- Issue: ChatLLM file writes could follow symlinks outside the project → Fix: writes and edits check the resolved path (CHATLLM-WRITE-001)

### 0.6.3 (2026-10-16)

- Issue: Phone Usage tab empty on App Store 2.0.0 → Fix: host drops ChatLLM entries for newer mobile apps (MOBILE-002)

### 0.6.2 (2026-10-16)

- Issue: Antigravity Limits missing the Gemini pool → Fix: quota probe merges both Google endpoints (AG-QUOTA-001)

### 0.6.1 (2026-10-15)

- Issue: Claude Fast selected but requests run at standard speed with no explanation → Fix: thread notice when Claude Code turns fast mode off, with its reason (USAGE-004)
- Issue: ChatLLM turns stop silently after 20 tool calls → Fix: limit raised to 200 on Flash models and 50 on others, with a visible message when reached (CHATLLM-STEPS-001)

### 0.6.0 (2026-10-15)

- Issue: Usage missing older Codex costs → Fix: scanner reads compressed and archived Codex sessions
- New feature: All time period in desktop and web Usage, with `Cmd/Ctrl+Shift+5` and a saved period preference
- New feature: saved transcript usage no longer expires after 92 days
- New feature: Zed Limits reads `$X of $Y spent`, or `$X spent, no limit`

### 0.5.1 (2026-10-14)

- Issue: Zed turns fail after the October 13 upstream sync → Fix: selected model and effort reach the Zed bridge before the session starts

### 0.5.0 (2026-10-14)

- New feature: Limits shows Zed account spend against the monthly limit, connected from Zed provider settings (ZED-001)
- Issue: Antigravity cannot create files in new directories under a symlinked path → Fix: symlinked workspace paths resolve correctly

### 0.4.0 (2026-10-14)

- Upstream sync: merged upstream `42160f2925` (orchestration-v2)
- New feature: upstream `delegate_task` replaces T3 orchestration layers, keeping per-model turn budgets and read-only review snapshots
- New feature: quota handoff resumes a limited thread on the first mapped fallback model with fresh quota
- New feature: Antigravity uses upstream's quota probe, shared "Claude & GPT" bucket and usage scanner
- Issue: clearing delegated task limit overrides keeps the old values → Fix: cleared overrides are removed
- New feature: removed Antigravity's Full-access lock, the four-thread provider command queue and ChatLLM's read-only review tools; upstream behavior applies

### 0.3.3 (2026-10-13)

- Code cleanup: no behavior change. Deleted dead fork code, shared duplicated usage and coordination logic, moved fork code out of upstream files, and reverted cosmetic edits to upstream files

### 0.3.2 (2026-10-11)

- Issue: effort variants split one model into several Usage rows → Fix: Usage combines a model's effort and thinking variants (USAGE-001)
- New feature: API-equivalent pricing updated from official OpenAI, Anthropic and Google rates, including Claude Opus 5.5 and Sonnet 5.5

### 0.3.1 (2026-10-08)

- New feature: HTML file links open in the system browser, with the integrated browser in the context menu
- Issue: KaTeX vector accents overlap their letters → Fix: KaTeX markup and styles aligned at 0.18.7
- Issue: one slow provider sign-in blocks every thread at startup → Fix: provider commands run up to four threads at once
- New feature: ACP errors include the native operation and error text, and failed sign-ins can be retried
- Issue: Antigravity hangs on an incomplete task notification → Fix: removed the regex backtracking

### 0.3.0 (2026-10-08)

- New feature: Claude Opus 5.5 and Sonnet 5.5 low, medium and high variants in Antigravity, when the Google account allows them

### 0.2.0 (2026-10-06)

- New feature: Zed thinking effort uses native values and survives thread reloads

### 0.1.5 (2026-10-06)

- New feature: Antigravity task results appear in the work trace without ending the prompt
- Issue: Zed catalog refresh keeps retired models → Fix: refresh removes them, though a restart after failed discovery still restores them (ZED-CATALOG-001)
- New feature: ACP provider errors include transport details

### 0.1.4 (2026-10-06)

- Issue: macOS asks for Documents access after every Personal update → Fix: builds keep one local signing identity
- Issue: Keychain password dialogs at launch → Fix: automatic Keychain requests no longer prompt

### 0.1.3 (2026-10-06)

- Issue: Zed bridge crashes when a tool calls `search_web` → Fix: headless web search initialized
- New feature: Zed subagent tool updates and approvals appear in the thread
- New feature: Zed tool calls update live as they stream

### 0.1.2 (2026-10-05)

- New feature: Antigravity always runs with full access
- New feature: Zed model catalog discovery. Zed lists its hosted models using the existing sign-in, and refresh picks the newest Sonnet and Luna (shipped in a 0.1.2 rebuild on 2026-10-05)

### 0.1.1 (2026-09-28)

- Issue: parent keeps calling coordination tools after `wait_for_children` → Fix: the turn stops there
- Issue: Antigravity children prompt for approval on T3 report tools → Fix: scoped report and read tools run without a prompt
- New feature: About shows the release version

### 0.1.0 (2026-09-28)

- New feature: quota handoff to a fallback provider at 95% usage, or continuation after reset
- New feature: Antigravity can lead an orchestration layer

### 0.0.42.2 (2026-09-27)

- New feature: thread MCP tools for cross-model and cross-provider handoffs
- New feature: orchestration workflows with child queues, reports, shared model budgets and lifecycle controls
- New feature: named limits, price-band defaults and per-model overrides for workflows
- New feature: provider worker restrictions, with Zed worker mode and ChatLLM parent access

### Before 0.0.42 (2026-09-18 to 2026-09-24)

- Upstream sync: merged upstream/main (2026-09-18)
- Upstream sync: merged upstream/main (2026-09-22)
- New feature: ChatLLM (Abacus / RouteLLM) provider with an autonomous tool loop and command safety filters
- New feature: Zed provider over ACP, with Claude Sonnet 5 and GPT 5.6 Luna
- New feature: Antigravity and ChatLLM Limits with reset countdowns
- New feature: token and cost tracking for Antigravity and ChatLLM, including Antigravity history
- New feature: Codex credit balances and credit-based cost at $0.04 per credit
- New feature: LaTeX math in chat, including tables and bold or italic text
- New feature: larger default font sizes and a two-line `T3 Code / personal` sidebar title
- New feature: Gemini 3.8 Flash tiers combined into one Usage model
- Issue: App Store 1.3.0 Usage tab fails on new providers → Fix: host sends the older Usage format to mobile 1.2 and 1.3 (MOBILE-001)
- Issue: Zed answers split mid-word and flood the activity list → Fix: repeated tool snapshots suppressed
- Issue: Zed context meter empty → Fix: adapter reads Zed context usage, though the bridge still sends none (ZED-CONTEXT-001)
