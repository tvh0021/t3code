# Session Handoff: T3 Code Personal Fork Development

**Date**: September 18, 2026  
**Repository**: [`tvh0021/t3code`](file:///Users/tvh0021/git_repos/t3code-dev) (Personal fork of `pingdotgg/t3code`)  
**Branch**: `integration/zed-abacus`  
**Latest Checkpoint Commit**: [`69bbd365f`](https://github.com/tvh0021/t3code/commit/69bbd365f) (pushed to `origin/integration/zed-abacus`)  
**Active Harness**: Antigravity harness running in T3 Code

---

## Executive Summary

During this session, we established, implemented, and verified customizations for the user's personal fork of T3 Code:

1. **Visual Branding & Layout**: Polished the sidebar header into a two-line layout (`T3 Code` / `personal`) with descender clearance (`pb-0.5` and `leading-none`) to prevent clipping on letters with descenders like `p`.
2. **Font & Ergonomic Defaults**: Upgraded default typography settings in contracts for a comfortable out-of-the-box appearance (UI 20px, prompt 18px, code 18px, terminal 17px).
3. **Autonomous "ChatLLM" (Abacus / RouteLLM) Agentic Driver**: Added a full-featured built-in provider driver supporting autonomous tool executions (`read_file`, `write_file`, `edit_file`, `list_directory`, `execute_command`), command safety filters, workspace sandboxing, streaming SSE, and a 20-step loop ceiling with user continuation prompts.
4. **Monthly Usage Limits & Billing Reset Schedule**: Integrated dual API queries (`_getOrganizationComputePoints` and `_getBillingInfo`) to display remaining monthly compute points and accurate billing reset countdowns (`resetsAt`) in the native Usage Limits panel.
5. **Official Vector SVG Brand Asset**: Replaced fallback "AB" text initials with the official Abacus AI vector icon (`AbacusIcon`) across all UI surfaces (Usage panel, model picker, provider settings, sidebar).
6. **Cosmetic Display Rebranding to "ChatLLM" & Legacy Snapshot Migration**: Rebranded all user-facing presentation labels to "ChatLLM" matching T3 Code conventions (such as "Codex" for OpenAI) while maintaining internal compatibility. Added runtime normalization in `resolveProviderInstanceDisplayName` and server driver sanitization in `AbacusDriver.ts` so legacy persisted snapshots reading `"Abacus"` automatically normalize to `"ChatLLM"` in the model picker, subtitles, and tooltips.
7. **LaTeX Math Rendering & Markdown Sanitization**: Integrated `remark-math` and `rehype-katex` in `ChatMarkdown.tsx` with math preprocessing for `\[ ... \]`, `\( ... \)`, and disambiguated `$math$`. Structured the rehype pipeline to sanitize user HTML while safely preserving KaTeX MathML and styled markup.
8. **KaTeX Square Root & Fraction Clearance**:
   - **Square Root Height**: Raised radical vinculum overlines (`transform: translateY(-0.22em)` + `padding-top: 0.22em`) so exponents like $\sqrt{x^2}$ and $\sqrt{a^2 + b^2}$ never get cut through.
   - **Fraction Denominator Powers**: Increased clearance for fraction denominators (`transform: translateY(0.22em)` default), with extra spacing (`transform: translateY(0.38em)`) on denominators containing superscripts/powers (`:has(.msupsub)`) so exponents never touch or clip the fraction bar (e.g. $\Delta = r^2 - \frac{2GMr}{c^2} + a^2$).
9. **Clean Service Logos (Initials Badges Removed)**: Restored `shouldShowInstanceBadge` in `packages/client-runtime/src/state/providerInstanceDisplay.ts` to only show initials badges when multiple instances of the same driver kind exist or when a custom accent color is set. Clean vector icons appear in the chat sidebar and model dropdown menu without overlay badges ("CH", "CO", "AN").
10. **Full Stylesheet & Layout Integrity**: Restored all 2,245 lines of `apps/web/src/index.css` (window controls overlay, traffic light geometry, sidebar borders, drag regions, and theme variables), resolving window proportion and border issues.
11. **Personal Fork Documentation & Checkpoint**: Cataloged all changes, maintainer workflows, and upstream synchronization procedures under `docs/personal/`. All work committed and pushed to `origin/integration/zed-abacus`.
12. **Antigravity Real-Time Quota Usage Limits**: Queried Google's Cloud Code Private API (`https://cloudcode-pa.googleapis.com/v1alpha:fetchCurrentTier`) using the authenticated user's OAuth credentials to surface active quota windows, remaining usage percentages, and reset countdowns in the native Usage Limits panel. Styled Antigravity usage bars with Google blue (`#4285f4`).
13. **ChatLLM (Abacus) Usage Limits Restoration**: Connected `readAbacusUsageLimits` to `AbacusDriver.ts` draft snapshot creation and live refresh cycles, restoring ChatLLM's compute points and reset countdown display.
14. **Antigravity 3P Model Analysis & Quota Window Polish**:
    - Investigated feasibility of Claude and GPT OSS models in Antigravity. While supported by CCPA backend, Google's `agy_acp_server` binary explicitly filters models with `if not ccpa_id.startswith("gemini"): continue`, rejecting them with RPC error `-32602`.
    - Filtered out third-party quota buckets (`3p-weekly`, `3p-5h`, Claude, and GPT) in `antigravityUsageLimits.ts` so non-functional models do not clutter the Usage tab.
    - Simplified window labels to `"Session"` (5-hour) and `"Weekly"` (weekly), matching Codex and Claude conventions, and sorted windows duration-ascending.
15. **Antigravity Model Catalog Restoration & Server Bundle Rebuild**:
    - Reverse-engineered empty model picker symptom where Antigravity was ready and authenticated with usage limits visible, but displayed "No models found" / "No models are available for this provider. Open provider setup" in the model picker.
    - Seeded catalog models from `ModelManifest.resolveProviderCatalog` inside `AntigravityDriver.ts`'s `classifyModels` whenever `draft.installed !== false && draft.status !== "error" && draft.auth.status !== "unauthenticated" && draft.models.length === 0`, mapping `"antigravity-default"` to `gemini-3.8-flash-high`.
    - Rebuilt `apps/server/dist/bin.mjs` via `pnpm --filter t3 build:bundle`. The desktop runner (`dev-electron.mjs`) watches `dist/bin.mjs` and automatically reloads the backend server upon rebuild.
16. **Upstream Synchronization (`upstream/main`)**:
    - Successfully merged 52 upstream commits (`d4d5d12e8..eadeaf228`).
    - Handled lockfile conflict via `pnpm install`, preserving all LaTeX equation packages (`katex`, `rehype-katex`, `remark-math`, `@types/katex`) alongside upstream's Effect rc.115 and Electron 44.4.2 upgrades.
    - Ran all test suites (53/53 math tests, 33/33 Antigravity tests, 21/21 Abacus tests).
    - Built the 8.49 MB server bundle and triggered Electron restart.

---

## Verification & Test Results

| Test Suite / Command                                                   | Status  | Details                                                                     |
| ---------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `pnpm --filter @t3tools/web test src/components/ChatMarkdown.test.tsx` | ✅ PASS | 53/53 math rendering and LaTeX formatting tests passing                     |
| `pnpm --filter t3 test Abacus`                                         | ✅ PASS | 21/21 tests passing (AbacusAdapter, AbacusDriver, abacusUsageLimits)        |
| `pnpm --filter t3 test antigravityUsageLimits`                         | ✅ PASS | 7/7 tests passing (quota ingestion, 3P filtration, Session/Weekly labels)   |
| `pnpm --filter t3 test AntigravityProvider`                            | ✅ PASS | 21/21 tests passing (provider lifecycle, snapshots, usage limit attachment) |
| `pnpm --filter t3 test AntigravityDriver`                              | ✅ PASS | 12/12 tests passing (model refresh, catalog fallback, auth handling)        |
| `pnpm --filter t3 build:bundle`                                        | ✅ PASS | Built 8.49 MB `dist/bin.mjs` cleanly in 738ms                               |
| `pnpm --filter t3 exec tsc --noEmit`                                   | ✅ PASS | 0 TypeScript errors                                                         |

---

## Git & Checkpoint Status

- **Branch**: `integration/zed-abacus`
- **Origin**: `https://github.com/tvh0021/t3code.git`
- **Upstream**: `https://github.com/pingdotgg/t3code.git`
- **Working Tree**: Clean (all changes committed and pushed to `origin/integration/zed-abacus`).
- **Latest Commit**: `69bbd365f` (`Merge branch 'upstream/main' into integration/zed-abacus`)

---

## Quickstart for Resuming in a New Session

1. **Verify Environment**:
   ```bash
   git status
   git branch --show-current  # Should be integration/zed-abacus
   ```
2. **Run Tests**:
   ```bash
   pnpm --filter @t3tools/web test src/components/ChatMarkdown.test.tsx
   pnpm --filter t3 test Abacus
   pnpm --filter t3 test AntigravityDriver
   ```
3. **Launch Dev Client**:
   ```bash
   pnpm dev:desktop
   ```
