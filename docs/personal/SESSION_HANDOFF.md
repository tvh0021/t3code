# Session Handoff: T3 Code Personal Fork Development

**Date**: September 18, 2026  
**Repository**: [`tvh0021/t3code`](file:///Users/tvh0021/git_repos/t3code-dev) (Personal fork of `pingdotgg/t3code`)  
**Branch**: `integration/zed-abacus`  
**Latest Checkpoint Commit**: [`dc12a6a1e`](https://github.com/tvh0021/t3code/commit/dc12a6a1e) (pushed to `origin/integration/zed-abacus`)  
**Active Harness**: Antigravity harness running in T3 Code

---

## Executive Summary

During this session, we established, implemented, and verified customizations for the user's personal fork of T3 Code:

1. **Visual Branding & Layout**: Polished the sidebar header into a two-line layout (`T3 Code` / `personal`) with descender clearance (`pb-0.5` and `leading-none`) to prevent clipping on letters with descenders like `p`.
2. **Font & Ergonomic Defaults**: Upgraded default typography settings in contracts for a comfortable out-of-the-box appearance (UI 17px, message 20px, input 18px, terminal 17px).
3. **Autonomous "ChatLLM" (Abacus / RouteLLM) Agentic Driver**: Added a full-featured built-in provider driver supporting autonomous tool executions (`read_file`, `write_file`, `edit_file`, `list_directory`, `execute_command`), command safety filters, workspace sandboxing, streaming SSE, and a 20-step loop ceiling with user continuation prompts.
4. **Monthly Usage Limits & Billing Reset Schedule**: Integrated dual API queries (`_getOrganizationComputePoints` and `_getBillingInfo`) to display remaining monthly compute points and accurate billing reset countdowns (`resetsAt`) in the native Usage Limits panel.
5. **Official Vector SVG Brand Asset**: Replaced fallback "AB" text initials with the official Abacus AI vector icon (`AbacusIcon`) across all UI surfaces (Usage panel, model picker, provider settings, sidebar).
6. **Cosmetic Display Rebranding to "ChatLLM" & Legacy Snapshot Migration**: Rebranded all user-facing presentation labels to "ChatLLM" matching T3 Code conventions (such as "Codex" for OpenAI) while maintaining internal compatibility. Added runtime normalization in `resolveProviderInstanceDisplayName` and server driver sanitization in `AbacusDriver.ts` so legacy persisted snapshots reading `"Abacus"` automatically normalize to `"ChatLLM"` in the model picker, subtitles, and tooltips.
7. **LaTeX Math Rendering & Markdown Sanitization**: Integrated `remark-math` and `rehype-katex` in `ChatMarkdown.tsx` with math preprocessing for `\\[ ... \\]`, `\\( ... \\)`, and disambiguated `$math$`. Structured the rehype pipeline to sanitize user HTML while safely preserving KaTeX MathML and styled markup.
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
    - Upstream `model-manifest.json` already defines the 3 Gemini models (`gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`).
    - Seeded catalog models from `ModelManifest.resolveProviderCatalog` inside `AntigravityDriver.ts`'s `classifyModels` whenever `draft.installed !== false && draft.status !== "error" && draft.auth.status !== "unauthenticated" && draft.models.length === 0`, mapping `"antigravity-default"` to `gemini-3.8-flash-high`. Live ACP session models continue to take precedence when a session runs.
    - Rebuilt `apps/server/dist/bin.mjs` via `pnpm --filter t3 build:bundle`. The desktop runner (`dev-electron.mjs`) watches `dist/bin.mjs` and automatically reloads the backend server upon rebuild.

---

## Key Files & Implementation Details

### 1. UI & Branding

- [`apps/web/src/components/sidebar/SidebarChrome.tsx`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/sidebar/SidebarChrome.tsx):
  - Two-line layout for header title: `T3 Code` on line 1, italic `personal` on line 2 with `pb-0.5` bottom padding and `leading-none` to eliminate letter descender clipping.
- [`apps/web/src/components/Icons.tsx`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/Icons.tsx):
  - Added official vector `AbacusIcon` (dark `#011322` background, cyan, blue, purple, magenta beads).
- [`apps/web/src/components/chat/providerIconUtils.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/chat/providerIconUtils.ts):
  - Mapped `[ProviderDriverKind.make("abacus")]: AbacusIcon` in `PROVIDER_ICON_BY_PROVIDER`.
- [`apps/web/src/components/settings/providerDriverMeta.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/settings/providerDriverMeta.ts):
  - Configured driver metadata with `label: "ChatLLM"` and `icon: AbacusIcon`.

### 2. Provider Instance Badges & Clean Icons

- [`packages/client-runtime/src/state/providerInstanceDisplay.ts`](file:///Users/tvh0021/git_repos/t3code-dev/packages/client-runtime/src/state/providerInstanceDisplay.ts):
  - `shouldShowInstanceBadge(entry, entries)`: Compares `driverKind` across entries. Only returns `true` if `sharedDriverCount > 1` (multiple instances of the same driver, e.g., two Codex instances) or if `accentColor` is explicitly set. Default single instances return `false`, removing the overlay badges ("CH", "CO", "AN") from service logos.
- [`packages/client-runtime/src/state/providerInstanceDisplay.test.ts`](file:///Users/tvh0021/git_repos/t3code-dev/packages/client-runtime/src/state/providerInstanceDisplay.test.ts):
  - 16 unit tests covering single vs multi-instance badging, accent colors, and legacy name migration.

### 3. Client Settings & Font Defaults

- [`packages/contracts/src/settings.ts`](file:///Users/tvh0021/git_repos/t3code-dev/packages/contracts/src/settings.ts):
  - `DEFAULT_INTERFACE_FONT_SIZE = 20` (Message font)
  - `DEFAULT_PROMPT_FONT_SIZE = 18` (Input font)
  - `DEFAULT_CODE_FONT_SIZE = 18` (Code font)
  - `DEFAULT_TERMINAL_FONT_SIZE = 17` (Terminal & UI font)
  - `AbacusSettings`: Added `sessionCookie` field for monthly compute credits lookup.

### 4. ChatLLM / Abacus Provider Backend

- [`apps/server/src/provider/builtInDrivers.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/builtInDrivers.ts):
  - Registered `AbacusDriver` into `BUILT_IN_DRIVERS`.
- [`apps/server/src/provider/Drivers/AbacusDriver.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Drivers/AbacusDriver.ts):
  - Driver factory handling startup snapshots, model definitions, credential resolution (`ABACUS_API_KEY`, `ABACUS_SESSION_COOKIE`), and probe execution. Advertises `displayName: "ChatLLM"` and sanitizes legacy snapshots.
- [`apps/server/src/provider/Layers/AbacusAdapter.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Layers/AbacusAdapter.ts):
  - Autonomous agent loop with full toolset (`read_file`, `write_file`, `edit_file`, `list_directory`, `execute_command`).
  - Safety filter rejecting dangerous commands (`sudo`, `rm -rf /`, `git push --force`, etc.).
  - Workspace sandbox restricting write/edit operations to workspace root while permitting read operations.
  - Streaming SSE parser handling fragmented chunks.
  - 20-step loop ceiling asking user whether to continue.
  - Runtime metadata prompt: `through the ChatLLM harness, as ${model}`.
- [`apps/server/src/provider/Layers/abacusUsageLimits.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Layers/abacusUsageLimits.ts):
  - Concurrently queries `POST https://apps.abacus.ai/api/_getOrganizationComputePoints` and `POST https://apps.abacus.ai/api/_getBillingInfo` via `Promise.allSettled`.
  - Calculates `usedPercent` and extracts `nextBillingDate` into `resetsAt`, with fallback to the 1st of the next UTC month.
  - Powers credit usage progress bar and reset countdown badge in the native UI.

### 5. LaTeX Math & KaTeX Clearance

- [`apps/web/src/components/ChatMarkdown.tsx`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/ChatMarkdown.tsx):
  - Preprocesses `\\[ ... \\]`, `\\( ... \\)`, and disambiguates `$math$` from currency and skill tags.
  - Configures `rehypeKatex` after `rehypeSanitize` to ensure rendered math elements are preserved.
- [`apps/web/src/index.css`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/index.css#L2226-L2245):
  - Complete, untruncated 2,245 lines preserving all window styling, CSS variables, drag regions, and borders.
  - Sqrt overline clearance:
    ```css
    .katex .sqrt > .vlist-t > .vlist-r:first-child > .vlist > span:not(.svg-align) {
      transform: translateY(-0.22em);
    }
    .katex .sqrt {
      padding-top: 0.22em;
    }
    ```
  - Fraction denominator clearance:
    ```css
    .katex .mfrac:has(.frac-line) > .vlist-t > .vlist-r:first-child > .vlist > span:first-child {
      transform: translateY(0.22em);
    }
    .katex
      .mfrac:has(.frac-line)
      > .vlist-t
      > .vlist-r:first-child
      > .vlist
      > span:first-child:has(.msupsub) {
      transform: translateY(0.38em);
    }
    ```

### 6. Antigravity Quota Ingestion, 3P Filtration & Model Catalog Seeding

- [`apps/server/src/provider/Layers/antigravityUsageLimits.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Layers/antigravityUsageLimits.ts):
  - Fetches quota summaries from `https://cloudcode-pa.googleapis.com/v1alpha:fetchCurrentTier` using cached Google OAuth tokens.
  - Filters out third-party model buckets (`3p-weekly`, `3p-5h`, Claude, GPT).
  - Standardizes labels to `"Session"` and `"Weekly"`.
  - Sorts windows by `windowDurationMins` ascending (`Session` followed by `Weekly`).
- [`apps/server/src/provider/Layers/antigravityUsageLimits.test.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Layers/antigravityUsageLimits.test.ts) & [`AntigravityProvider.test.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Layers/AntigravityProvider.test.ts):
  - Unit test coverage for OAuth token caching, quota calculation, 3P filtration, and `"Session"` / `"Weekly"` labels (28/28 tests passing).
- [`apps/server/src/provider/Drivers/AntigravityDriver.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Drivers/AntigravityDriver.ts):
  - Ingests `readAntigravityUsageLimits` on startup and in `snapshotShape.refresh`.
  - In `classifyModels`, when `draft.installed !== false && draft.status !== "error" && draft.auth.status !== "unauthenticated" && draft.models.length === 0`, resolves catalog models from `ModelManifest.resolveProviderCatalog(manifest, DRIVER)` (or `BUNDLED_MODEL_MANIFEST`).
  - Seeds the 3 Gemini models (`gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`) and binds `"antigravity-default"` alias to `gemini-3.8-flash-high`.
  - Rebuilt `apps/server/dist/bin.mjs` via `pnpm --filter t3 build:bundle`.
- [`apps/server/src/provider/Drivers/AbacusDriver.ts`](file:///Users/tvh0021/git_repos/t3code-dev/apps/server/src/provider/Drivers/AbacusDriver.ts):
  - Wired `readAbacusUsageLimits` to snapshot draft and `snapshotShape.refresh`.
- [`apps/web/src/components/usage/UsageLimits.tsx`](file:///Users/tvh0021/git_repos/t3code-dev/apps/web/src/components/usage/UsageLimits.tsx):
  - Configured Google blue `#4285f4` in `barColor()` for `driver === "antigravity"`.

---

### 7. Personal Fork Documentation

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
| `pnpm --filter t3 test antigravityUsageLimits` | ✅ PASS | 7/7 tests passing (quota ingestion, 3P filtration, Session/Weekly labels)                        |
| `pnpm --filter t3 test AntigravityProvider`    | ✅ PASS | 21/21 tests passing (provider lifecycle, snapshots, usage limit attachment)                      |
| `pnpm --filter t3 test AntigravityDriver`      | ✅ PASS | 12/12 tests passing (model refresh, catalog fallback, auth handling)                             |
| `pnpm --filter t3 build:bundle`                | ✅ PASS | Built 8.46 MB `dist/bin.mjs` cleanly in 768ms                                                    |
| `pnpm --filter t3 exec tsc --noEmit`           | ✅ PASS | 0 TypeScript errors                                                                              |
| `pnpm --filter @t3tools/client-runtime test`   | ✅ PASS | 1,524/1,524 tests passing (77/77 test files, including provider instance display & badges)       |

---

## Git & Checkpoint Status

- **Branch**: `integration/zed-abacus`
- **Origin**: `https://github.com/tvh0021/t3code.git`
- **Upstream**: `https://github.com/pingdotgg/t3code.git`
- **Working Tree**: Clean (all changes committed and pushed to `origin/integration/zed-abacus`).
- **Latest Commit**: `dc12a6a1e` (`feat(antigravity): simplify usage window labels to Session and Weekly`)

---

## Quickstart for Resuming in a New Session

1. **Verify Environment**:
   ```bash
   git status
   git branch --show-current  # Should be integration/zed-abacus
   ```
2. **Run Tests**:
   ```bash
   pnpm --filter @t3tools/web test
   pnpm --filter @t3tools/client-runtime test
   pnpm --filter t3 test Abacus
   pnpm --filter t3 test AntigravityDriver
   ```
3. **Launch Dev Client**:
   ```bash
   pnpm dev:desktop
   ```
