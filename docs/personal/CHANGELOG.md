# Changelog: Personal Fork

User-visible changes per release, newest first. Current behavior is in
[MODIFICATIONS.md](./MODIFICATIONS.md); open problems are in
[ISSUE_TRACKER.md](./ISSUE_TRACKER.md).

---

### 0.8.0 (2026-10-19)

- Upstream sync: merged upstream ab6be13d43
- Issue: session import could offer T3-managed workspaces reached through symlinks → Fix: resolve managed roots before listing or importing sessions

### 0.7.5 (2026-10-18)

- Issue: on Usage → Day, provider columns included Codex credit spend that Total left out → Fix: day and hour columns, Total and charts all use subscription cost, matching the headline; credit spend stays in provider and model totals (USAGE-002)

- Issue: ChatLLM credits in Usage diverged from the Abacus dashboard (13,558 vs 4,857 credits for Argon on October 17) → Fix: credits now come from Abacus's billing ledger by UTC day and include use outside T3; hourly views and days without ledger data estimate credits from tokens (CHATLLM-USAGE-002)

- Issue: Usage listed an unpriced `<synthetic>` Claude model → Fix: Claude Code's locally generated messages (errors, interruptions) are no longer counted as usage (USAGE-008)

### 0.7.4 (2026-10-18)

- Issue: Antigravity Usage showed unknown models, split Gemini tiers and unpriced Argon usage → Fix: recover model names, combine access tiers and apply Argon's introductory API rate for Antigravity and ChatLLM (USAGE-007)

- Issue: ChatLLM estimated the first turn's credits and counted only the last request's tokens in tool loops → Fix: read a shared starting balance and accumulate tokens across requests (CHATLLM-USAGE-001)

### 0.7.3 (2026-10-18)

- Issue: Antigravity's Gemini 5-hour and weekly limits showed an unused quota pool (`100%` / `98%`) and missed Gemini 4 Argon → Fix: the quota probe reports the Antigravity 2.24.0 client version to Google's daily quota endpoint and hides reset countdowns on unused 100% windows (AG-QUOTA-002)

- Issue: delegated task limits capped every child a thread started on a model, so a second unrelated Sol task was refused → Fix: limits count resubmissions of the same task only, and older generations of a model (such as 6 Sol for 6.1 Sol) share its limit

- Issue: Zed prompts that ran out of credits showed only "Provider turn failed." → Fix: Zed's reason is shown, and out-of-credit errors show as "Usage limit reached" (ZED-CREDITS-001)

### 0.7.2 (2026-10-17)

- Issue: Zed threads failed to continue after restarting T3 → Fix: T3 starts a fresh provider session with saved conversation context (ZED-RESUME-001)

- Issue: after Zed's monthly reset, the Zed limit bar showed "resets now" with last period's date → Fix: it shows the next reset date and rereads spend once the period ends (ZED-RESET-001)

### 0.7.1 (2026-10-17)

- Issue: Zed's provider entry always showed version 0.1.0 → Fix: it shows the bridge's real version; needs bridge 0.2.1 or later (ZED-VERSION-001)

### 0.7.0 (2026-10-17)

- New feature: Zed offers every hosted model on the account, labeled by provider, instead of only the newest Sonnet and Luna; labels and the account default need bridge `aa2e090c03`
- Issue: a restart after failed Zed model discovery restored retired models → Fix: failed discovery shows a warning and keeps the last model list (ZED-CATALOG-001)
- Issue: hidden Zed custom models weren't wired to the picker → Fix: every hosted model is listed, so custom models aren't needed (ZED-MODELS-001)

### 0.6.5 (2026-10-17)

- Upstream sync: merged upstream a7025639c0
- New feature: delegated reviews (`reviewRef`) run in an upstream-managed worktree at that commit, with the project's setup script, instead of a fork clone
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
