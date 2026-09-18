# Changelog: Personal Fork Modifications

A concise, chronological record of custom code changes made to this personal fork of T3 Code (oldest to newest).

---

### 2026-09-18

- **Sidebar Header Layout**: Restructured sidebar title in `SidebarChrome.tsx` into a two-line layout (`T3 Code` / `personal`) with descender padding to prevent letter clipping.
- **Appearance & Font Defaults**: Raised default typography sizes in `packages/contracts/src/settings.ts` (UI 20px, Prompt 18px, Code 18px, Terminal 17px) for comfortable readability out of the box.
- **Autonomous Agentic Driver for Abacus / RouteLLM**: Implemented `AbacusAdapter.ts` and `AbacusDriver.ts` supporting autonomous tool loops (`read_file`, `write_file`, `edit_file`, `list_directory`, `execute_command`), command safety checks, and a 20-step loop ceiling.
- **Abacus AI Vector Brand Asset**: Added official multi-colored vector SVG `AbacusIcon` in `Icons.tsx` and mapped it across all provider UI surfaces.
- **Cosmetic Rebranding to "ChatLLM"**: Rebranded all user-facing Abacus display instances to `"ChatLLM"` across contracts, server metadata, and client migration utilities.
- **LaTeX Math Support**: Integrated `remark-math` and `rehype-katex` with math delimiter preprocessing in `ChatMarkdown.tsx` for inline and display mathematical typesetting.
- **KaTeX Fraction & Radical Clearances**: Styled fraction denominators (`translateY(0.22em)` / `translateY(0.38em)` on exponents) and radical overlines (`translateY(-0.22em)`) in `apps/web/src/index.css` to prevent exponents from clipping horizontal bars.
- **Provider Initials Badging Cleanup**: Updated `shouldShowInstanceBadge` in `providerInstanceDisplay.ts` to omit overlay badges ("CH", "CO", "AN") unless multiple instances of the same provider driver exist or custom accent colors are set.
- **ChatLLM (Abacus) Usage Limits Wiring**: Connected `readAbacusUsageLimits` to `AbacusDriver.ts` snapshots and refresh cycles, restoring monthly compute points and billing reset countdowns in the Usage panel.
- **Antigravity Real-Time Quota Tracking**: Integrated Google Cloud Code Private API (`fetchCurrentTier`) in `antigravityUsageLimits.ts` to surface live usage percentages and reset countdowns in Google blue (`#4285f4`).
- **Antigravity 3P Model Filtering**: Filtered out unsupported Claude and GPT quota buckets from Antigravity's usage limit display since Google's `agy_acp_server` binary rejects non-Gemini requests.
- **Antigravity Usage Labeling**: Simplified Antigravity quota window labels to `"Session"` (5-hour) and `"Weekly"` in `antigravityUsageLimits.ts`, matching Codex/Claude UI conventions.
- **Antigravity Model Catalog Restoration**: Added catalog seeding in `AntigravityDriver.ts` so Gemini models display immediately in the picker without waiting for an active ACP session.
- **Upstream Sync**: Merged 52 commits from `upstream/main` (`d4d5d12e8..eadeaf228`), resolving lockfile dependencies while retaining all custom LaTeX packages and configuration.
