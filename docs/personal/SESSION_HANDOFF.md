# Session Handoff: T3 Code Personal Fork Development

**Date**: September 18, 2026  
**Repository**: [`tvh0021/t3code`](file:///Users/tvh0021/git_repos/t3code-dev) (Personal fork of `pingdotgg/t3code`)  
**Active Harness**: Antigravity harness running in T3 Code

---

## Executive Summary

During this session, we established, implemented, and verified customizations for the user's personal fork of T3 Code:

1. **Visual Branding & Layout**: Polished the sidebar header into a two-line layout (`T3 Code` / `personal`) with descender clearance (`pb-0.5`).
2. **Font & Ergonomic Defaults**: Upgraded default typography settings in contracts for a comfortable out-of-the-box appearance (UI 17px, message 20px, input 18px, terminal 17px).
3. **Autonomous "ChatLLM" (Abacus / RouteLLM) Agentic Driver**: Added a full-featured built-in provider driver supporting autonomous tool executions (`read_file`, `write_file`, `edit_file`, `list_directory`, `execute_command`), command safety filters, workspace sandboxing, streaming SSE, and a 20-step loop ceiling with user continuation prompts.
4. **Monthly Usage Limits & Billing Reset Schedule**: Integrated dual API queries (`_getOrganizationComputePoints` and `_getBillingInfo`) to display remaining monthly compute points and accurate billing reset countdowns (`resetsAt`) in the native Usage Limits panel.
5. **Official Vector SVG Brand Asset**: Replaced fallback "AB" text initials with the official Abacus AI vector icon (`AbacusIcon`) across all UI surfaces (Usage panel, model picker, provider settings, sidebar).
6. **Cosmetic Display Rebranding to "ChatLLM" & Legacy Snapshot Migration**: Rebranded all user-facing presentation labels to "ChatLLM" matching T3 Code conventions (such as "Codex" for OpenAI) while maintaining internal compatibility. Added runtime normalization in `resolveProviderInstanceDisplayName` and server driver sanitization in `AbacusDriver.ts` so legacy persisted snapshots reading `"Abacus"` automatically normalize to `"ChatLLM"` in the model picker, subtitles, and tooltips.
7. **LaTeX Math Rendering & Markdown Sanitization**: Integrated `remark-math` and `rehype-katex` in `ChatMarkdown.tsx` with math preprocessing for `\\[ ... \\]`, `\\( ... \\)`, and disambiguated `$math$`. Structured the rehype pipeline to sanitize user HTML while safely preserving KaTeX MathML and styled markup.
8. **KaTeX Fraction Denominator Clipping Fix & Stylesheet Integrity**:
   - Added targeted CSS transform in `apps/web/src/index.css` (`.katex .mfrac:has(.frac-line) > .vlist-t > .vlist-r:first-child > .vlist > span:first-child { transform: translateY(0.18em); }`) to shift fraction denominators down by ~3.5px, providing clear breathing room beneath the fraction line without affecting line-less fractions or non-fraction formulas.
   - Fully restored all 2,224 lines of `apps/web/src/index.css` (window controls overlay, traffic light geometry, sidebar borders, and theme variables), resolving the temporary visual corruption where borders and window proportions were misplaced.
9. **Personal Fork Documentation**: Cataloged all changes and upstream synchronization procedures under `docs/personal/`.

---

## Key Files & Implementation Details

### 1. UI & Branding

- [`apps/web/src/components/sidebar/SidebarChrome.tsx`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/sidebar/SidebarChrome.tsx):
  - Two-line layout for header title: `T3 Code` on line 1, italic `personal` on line 2 with `pb-0.5` bottom padding and `leading-none` to eliminate letter descender clipping (e.g. the letter `p`).
- [`apps/web/src/components/Icons.tsx`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/Icons.tsx):
  - Added vector `AbacusIcon` (dark `#011322` background, cyan, blue, purple, magenta beads).
- [`apps/web/src/components/chat/providerIconUtils.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/chat/providerIconUtils.ts):
  - Mapped `[ProviderDriverKind.make("abacus")]: AbacusIcon` in `PROVIDER_ICON_BY_PROVIDER`.
- [`apps/web/src/components/settings/providerDriverMeta.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/settings/providerDriverMeta.ts):
  - Configured driver metadata with `label: "ChatLLM"` and `icon: AbacusIcon`.

### 2. Client Settings & Font Defaults

- [`packages/contracts/src/settings.ts`](file:///Users/tvh0021/git_repos/t3code-dev/packages/contracts/src/settings.ts):
  - `DEFAULT_INTERFACE_FONT_SIZE = 20` (Message font)
  - `DEFAULT_PROMPT_FONT_SIZE = 18` (Input font)
  - `DEFAULT_CODE_FONT_SIZE = 18` (Code font)
  - `DEFAULT_TERMINAL_FONT_SIZE = 17` (Terminal & UI font)
  - `AbacusSettings`: Added `sessionCookie` field for monthly compute credits lookup.

### 3. ChatLLM / Abacus Provider Backend

- [`apps/server/src/provider/builtInDrivers.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/builtInDrivers.ts):
  - Registered `AbacusDriver` into `BUILT_IN_DRIVERS`.
- [`apps/server/src/provider/Drivers/AbacusDriver.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Drivers/AbacusDriver.ts):
  - Driver factory handling startup snapshots, model definitions, credential resolution (`ABACUS_API_KEY`, `ABACUS_SESSION_COOKIE`), and probe execution. Advertises `displayName: "ChatLLM"` and sanitizes legacy snapshots.
- [`apps/server/src/provider/Layers/AbacusAdapter.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Layers/AbacusAdapter.ts):
  - Autonomous agent loop with full toolset (`read_file`, `write_file`, `edit_file`, `list_directory`, `execute_command`).
  - Safety filter rejecting dangerous patterns (`sudo`, `rm -rf /`, `git push --force`, etc.).
  - Workspace sandbox restricting write/edit operations to workspace root while permitting read operations.
  - Streaming SSE parser handling fragmented chunks.
  - 20-step loop ceiling asking user whether to continue.
  - Runtime metadata prompt: `through the ChatLLM harness, as ${model}`.
- [`apps/server/src/provider/Layers/abacusUsageLimits.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Layers/abacusUsageLimits.ts):
  - Concurrently queries `POST https://apps.abacus.ai/api/_getOrganizationComputePoints` and `POST https://apps.abacus.ai/api/_getBillingInfo` via `Promise.allSettled`.
  - Calculates `usedPercent` and extracts `nextBillingDate` into `resetsAt`, with fallback to the 1st of the next UTC month.
  - Powers both the credit usage progress bar and the reset countdown badge (`↺ Xd Yh`) in the UI.

### 4. LaTeX Math & Fraction Clearance

- [`apps/web/src/components/ChatMarkdown.tsx`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/ChatMarkdown.tsx):
  - Preprocesses `\\[ ... \\]`, `\\( ... \\)`, and disambiguates `$math$` from currency and skill tags.
  - Configures `rehypeKatex` after `rehypeSanitize` to ensure rendered math elements are preserved.
- [`apps/web/src/index.css`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/index.css):
  - Retains all 2,224 original theme, window layout, drag region, and border styles.
  - Appends targeted KaTeX rules shifting the denominator span down by `0.18em` to prevent clipping beneath `.frac-line`.

### 5. Personal Fork Documentation

- [`docs/personal/README.md`](file:///Users/tvh0021/git_repos/t3code-dev/docs/personal/README.md): Fork overview, architecture, and developer quickstart.
- [`docs/personal/MODIFICATIONS.md`](file:///Users/tvh0021/git_repos/t3code-dev/docs/personal/MODIFICATIONS.md): Comprehensive catalog of all changed/added files, rationale, and cosmetic rebranding details.
- [`docs/personal/UPSTREAM_SYNC.md`](file:///Users/tvh0021/git_repos/t3code-dev/docs/personal/UPSTREAM_SYNC.md): Step-by-step guide for rebasing or merging upstream `pingdotgg/t3code` changes without conflicts.

---

## Testing & Verification Summary

| Test Suite / Command                           | Status  | Details                                                                                          |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `pnpm --filter @t3tools/web test`              | ✅ PASS | 5,203/5,203 web unit tests passing (390/390 test files, including 53/53 `ChatMarkdown.test.tsx`) |
| `pnpm --filter @t3tools/web exec tsc --noEmit` | ✅ PASS | 0 TypeScript errors                                                                              |
| `pnpm --filter t3 test Abacus`                 | ✅ PASS | 21/21 tests passing (AbacusAdapter, AbacusDriver, abacusUsageLimits)                             |
| `pnpm --filter t3 exec tsc --noEmit`           | ✅ PASS | 0 TypeScript errors                                                                              |
| `pnpm --filter @t3tools/client-runtime test`   | ✅ PASS | 1,524/1,524 tests passing (77/77 test files, including provider instance display & badges)       |

### KaTeX Math & UI Refinements (Latest Update)

- **Square Root Height Clearance**: Added vertical clearance (`transform: translateY(-0.22em)` with `padding-top: 0.22em`) to `.katex .sqrt` so horizontal vinculum overlines cleanly clear powers and superscripts (e.g. $\sqrt{x^2}$).
- **Fraction Denominator Power Clearance**: Increased clearance for fraction denominators, with extra spacing (`transform: translateY(0.38em)`) on denominators containing superscripts/powers (`:has(.msupsub)`) so exponents never touch or clip the fraction bar (e.g. $\Delta = r^2 - \frac{2GMr}{c^2} + a^2$).
- **Service Logo Clean Appearance**: Restored `shouldShowInstanceBadge` in `packages/client-runtime/src/state/providerInstanceDisplay.ts` to only show initials badges when multiple instances of the same driver kind exist or when a custom accent color is set. Clean vector icons appear in the chat sidebar and model dropdown menu without overlay badges ("CH", "CO", "AN").
