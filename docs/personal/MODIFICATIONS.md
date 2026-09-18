# Detailed File Modifications & Architecture

This document catalogs every modified, created, or configured file in the personal fork of T3 Code compared to upstream `pingdotgg/t3code`.

---

## 1. User Interface & Branding

### `apps/web/src/components/sidebar/SidebarChrome.tsx`

- **Purpose**: Sidebar header rendering the workspace title, project name, and application branding.
- **Modifications**:
  - Replaced the inline title logic that produced `"T3 Code - personal"` on a single row, which stuck out and clipped into the chat window when non-maximized.
  - Split the title into two distinct lines:
    - Row 1: `T3 Code` (`font-bold text-lg leading-tight tracking-tight`)
    - Row 2: `personal` (`italic font-semibold text-lg leading-none pb-0.5 tracking-tight text-muted-foreground`)
  - Added bottom padding (`pb-0.5`) and `leading-none` to guarantee that letters with lower descenders (notably the `p` in `personal`) are never clipped by the bounding container.

### `apps/web/src/branding.ts` & `apps/web/src/branding.test.ts`

- **Purpose**: App identity, channel strings, and window title formatting.
- **Modifications**:
  - Preserved `"personal"` channel designation and updated window titles and test assertions accordingly.

### `apps/web/src/components/Icons.tsx`

- **Purpose**: Central vector icon registry for model and provider branding.
- **Modifications**:
  - Added `AbacusIcon`: Vector SVG of the official Abacus.AI brand mark (dark navy `#011322` rounded square background with bead tracks and multi-colored beads in cyan `#00e5db`, blue `#008ef8`, purple `#d201f8`, and magenta `#f700a9`).
  - Replaces generic placeholder initials (`"AB"`) with a refined, official brand asset.

### `apps/web/src/components/chat/providerIconUtils.ts`

- **Purpose**: Maps provider driver kinds to their primary brand icon component and provides model name formatting utilities.
- **Modifications**:
  - Imported `AbacusIcon` and registered `[ProviderDriverKind.make("abacus")]: AbacusIcon` in `PROVIDER_ICON_BY_PROVIDER`.
  - Ensures `ProviderInstanceIcon` resolves the official Abacus.AI logo across all UI surfaces:
    - Usage Limits pooled bar and account avatars (`UsageLimitsPooled.tsx`)
    - Provider Instance cards and badges (`ProviderInstanceCard.tsx`)
    - Chat composer model pickers and model lists (`ProviderModelPicker.tsx`, `ModelListRow.tsx`)
    - Sidebar instance headers and launch notifications

---

## 2. Appearance & Font Preferences

### `packages/contracts/src/settings.ts` & `packages/contracts/src/settings.test.ts`

- **Purpose**: Schema definitions, validation rules, and default settings values for client instances.
- **Modifications**:
  - Updated default appearance font sizes in `DefaultClientSettings` to eliminate manual configuration:
    - `messageFontSize`: Changed from `13` to `20`
    - `inputFontSize`: Changed from `14` to `18`
    - `terminalFontSize`: Changed from `14` to `18`
    - `uiFontSize`: Changed from `13` to `17`
  - Updated corresponding schema tests in `settings.test.ts` to assert against these new personal defaults.

---

## 3. Abacus AI (RouteLLM) Agentic Provider

### Architecture Overview

The Abacus AI provider is integrated at multiple layers of the system:

1. Contracts & Configuration (`packages/contracts/src/model.ts`)
2. Server Built-in Drivers (`apps/server/src/provider/builtInDrivers.ts`)
3. Driver Lifecycle (`apps/server/src/provider/Drivers/AbacusDriver.ts`)
4. Autonomous Adapter Loop (`apps/server/src/provider/Layers/AbacusAdapter.ts`)
5. Web Settings UI (`apps/web/src/components/settings/`)

### `packages/contracts/src/model.ts`

- **Modifications**:
  - Added `ProviderDriverKind.make("abacus")` to supported provider drivers.
  - Registered static catalog models:
    - `route-llm` (RouteLLM General Model)
    - `abacus-route` (Abacus AI Route Model)

### `apps/server/src/provider/builtInDrivers.ts`

- **Modifications**:
  - Exported and registered `makeAbacusDriver` in the server's provider driver registry.

### `apps/server/src/provider/Drivers/AbacusDriver.ts` & `AbacusDriver.test.ts`

- **Modifications**:
  - Implemented the driver factory managing initialization, API base URL resolution (`https://routellm.abacus.ai` / `/v1`), authentication verification (`ABACUS_API_KEY`), and adapter instantiation.
  - Wired `readAbacusUsageLimits` to attach live monthly compute points and credits allowance to the server provider snapshot and probe.

### `apps/server/src/provider/Layers/AbacusAdapter.ts`

- **Modifications**:
  - **Tool Definitions (`ABACUS_AGENT_TOOLS`)**:
    - `read_file`: Line-range reading with 1-based indexing (`start_line`, `end_line`).
    - `write_file`: File creation or full replacement within the workspace.
    - `edit_file`: Targeted exact-match replacement (`old_string` -> `new_string`) requiring unique occurrence validation.
    - `list_directory`: Formatted directory listing with `[dir]` and `[file]` markers.
    - `execute_command`: Non-interactive `/bin/zsh` execution in the workspace root with a 60s timeout.
  - **Safety Filter (`checkCommandSafety`)**:
    - Regular expression patterns that reject dangerous invocations:
      - `sudo`
      - `rm -rf /`, `rm -rf ~`
      - `curl | bash`, `wget | sh`
      - `git push --force`, `git push -f`
      - `git clean -fxd`
      - `mkfs`, `dd if=`
  - **Sandboxing (`isInsideWorkspace`, `resolvePath`)**:
    - Confines all write and edit operations strictly within the active workspace root.
    - Permits system-wide reads and directory listings for inspection tasks.
  - **Output Truncation (`truncateToolOutput`)**:
    - Limits tool output to 30 KB or 500 lines total (200 head, 300 tail) to protect LLM context windows.
  - **Streaming SSE Agent Loop (`sendTurn`)**:
    - Injects an expert engineering agent system prompt (`buildAbacusSystemPrompt`).
    - Sends requests to the OpenAI-compatible endpoint with `tools` and `tool_choice: "auto"`.
    - Parses streaming SSE chunks (`parseAbacusSse`) and handles fragmented tool call payloads.
    - Emits live T3 Code timeline events (`item.started`, `content.delta`, `item.completed`) using canonical item types:
      - `command_execution` for shell runs
      - `file_change` for file writes and edits
      - `dynamic_tool_call` for general tools
      - `assistant_message` for conversational text
    - Dispatches tool outputs back into the conversation history with `{ role: "tool", tool_call_id, content }`.
    - **20-Step Loop Ceiling**: Limits turns to 20 tool executions, gracefully interrupting with a conversational prompt asking if the user wants to continue.
    - **Cancellation & Interrupts (`interruptTurn`, `stopSession`)**: Aborts the HTTP request, sends `SIGTERM` to any running child process, and rolls uncommitted messages back.
    - **Clean History (`readThread`)**: Filters internal `system` messages from thread reconstructions.

### `apps/server/src/provider/Layers/AbacusAdapter.test.ts`

- **Modifications**:
  - 11 unit tests covering:
    - Path formatting (`abacusChatCompletionsUrl`).
    - SSE parsing across chunk boundaries and UTF-8 characters (`parseAbacusSse`).
    - Authenticated request dispatch and message history.
    - Attachment rejection.
    - Stream cancellation and rollback.
    - Safety filter blocking dangerous patterns.
    - Workspace sandboxing for writes and edits.
    - File utilities (`read_file`, `write_file`, `edit_file`, `list_directory`).
    - Output truncation.
    - Multi-turn autonomous agent tool execution loop.
    - 20-step loop ceiling behavior.

---

## 4. Abacus AI Monthly Credits in Usage Panel

### Architecture Overview

Rather than tracking micro-credits consumed per individual chat message, the user's monthly compute points balance is queried from Abacus AI's billing endpoint and displayed directly in T3 Code's native Usage Panel (`/usage` -> Limits tab).

### `packages/contracts/src/settings.ts` & `packages/contracts/src/settings.test.ts`

- **Modifications**:
  - Added optional `sessionCookie: TrimmedString` field (masked password input) to `AbacusSettings` and `AbacusSettingsPatch` schema definitions.
  - Defaults to `""`.
  - Updated schema parsing and patch round-trip unit tests.

### `apps/server/src/provider/Layers/abacusUsageLimits.ts` & `abacusUsageLimits.test.ts`

- **Modifications**:
  - **Dual Endpoint Querying**:
    - Queries `POST https://apps.abacus.ai/api/_getOrganizationComputePoints` and `POST https://apps.abacus.ai/api/_getBillingInfo` concurrently via `Promise.allSettled`.
    - Authenticates using either `sessionCookie` (`Cookie: session=...`) or `apiKey` (`apiKey: ...` and `Authorization: Bearer ...`).
  - **Points & Billing Cycle Extraction**:
    - Reads points balance: `totalComputePoints` and `computePointsLeft` (or fallback `curr_month_avail_points`).
    - Reads billing cycle from `_getBillingInfo`: `nextBillingDate` (e.g. `2026-10-12T03:59:37+00:00`) and `subscriptionStartTime`.
    - Computes `windowDurationMins` from the difference between `nextBillingDate` and `subscriptionStartTime` (defaults to 43,200 mins / 30 days).
    - If `nextBillingDate` is missing or unparseable, automatically computes the fallback reset date as the 1st of the next UTC month at 00:00:00Z.
    - Calculates `usedPercent = Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)))`.
    - Formats window label: `Monthly (${left.toLocaleString()} / ${total.toLocaleString()} credits left)`.
    - Produces a `ServerProviderUsageWindow` with `kind: "monthly"`, `usedPercent`, `resetsAt`, and `windowDurationMins`.
  - **Usage Bar Reset Presentation**:
    - Exposing `resetsAt` enables the right-side reset countdown badge on the progress bar plate (e.g., `⤻ 24d 1h`), resolving the previously empty right-hand side.
  - **Graceful Error Handling**:
    - On unauthenticated or network failures, gracefully returns `makeUnavailableUsageLimits({ reason: "probeFailed" })`.
  - **Unit Testing**:
    - 8 unit tests in `abacusUsageLimits.test.ts` covering points parsing, billing info parsing, fallback next-month calculation, session cookie vs API key authentication, and error handling.

### `apps/server/src/provider/Drivers/AbacusDriver.ts`

- **Modifications**:
  - Extracted `sessionCookie` and `apiKey` from provider configuration and environment variables (`ABACUS_SESSION_COOKIE`, `ABACUS_API_KEY`).
  - Queries `readAbacusUsageLimits` on startup and in `snapshot.refresh`.
  - Attaches `usageLimits` to `ServerProvider` snapshot and `ServerProviderProbeResult`.

### `apps/web/src/components/usage/UsageLimits.tsx`

- **Modifications**:
  - Added violet theme bar color (`#8b5cf6`) for `driver === "abacus"` to give Abacus AI usage progress bars a distinctive brand color in the Usage Limits tab and pooled bar.

### `apps/web/src/components/settings/ProviderSettingsForm.test.ts`

- **Modifications**:
  - Updated expected Abacus settings field schema to include both `apiBaseUrl` and `sessionCookie`.

---

## 5. Settings UI & Metadata (Cosmetic Display as "ChatLLM")

### Cosmetic Display Renaming ("ChatLLM")

Following T3 Code naming conventions (e.g. displaying "Codex" instead of "ChatGPT"), all user-facing cosmetic display references have been rebranded from "Abacus" to **"ChatLLM"** while preserving the underlying engine and driver architecture (`abacus`, `ABACUS_API_KEY`, etc.):

- **Provider Label**: `label: "ChatLLM"` in `providerDriverMeta.ts` (powers the Usage Limits page, Composer status popovers, Provider Settings panel, and Add Instance dialog).
- **Driver Presentation**: `displayName: "ChatLLM"` in `AbacusDriver.ts` (advertised in server snapshots and client probes).
- **Settings Descriptions**: "ChatLLM-compatible API base URL" in `packages/contracts/src/settings.ts`.
- **System Prompt & Runtime**: Injects `through the ChatLLM harness` into `buildAbacusSystemPrompt` in `AbacusAdapter.ts`.
- **Usage & Error Messages**: Usage limits and turn errors reference ChatLLM rather than Abacus in user-facing toasts and banners.

### `apps/web/src/components/settings/providerDriverMeta.ts`

- **Modifications**:
  - Registered ChatLLM display metadata, configured with `AbacusIcon`, label `"ChatLLM"` (cosmetic display title matching T3 Code conventions like Codex for OpenAI), and `AbacusSettings` schema.
  - Exported `DRIVER_OPTIONS` and `DRIVER_OPTION_BY_VALUE`.

### `apps/web/src/components/settings/ProviderInstanceCard.tsx` & `.test.ts`

- **Modifications**:
  - Integrated Abacus AI card rendering and configuration controls in the provider settings panel.

### `apps/web/src/components/settings/ProviderSettingsForm.test.ts`

- **Modifications**:
  - Updated provider instance tests to account for the new Abacus provider options.

---

## 6. Desktop Application & Packaging

### `apps/desktop/package.json` & `apps/desktop/scripts/electron-launcher.mjs`

- **Modifications**:
  - Updated desktop packaging and development launcher scripts to support personal branding channels.

### `apps/desktop/src/app/DesktopAppIdentity.test.ts` & `DesktopEnvironment.ts`

- **Modifications**:
  - Adjusted app identity and environment variables for the personal fork release profile.

### `docs/internals/providers.md`

- **Modifications**:
  - Updated provider architecture documentation to include Abacus AI / RouteLLM capabilities and driver specifications.

---

## 7. Provider Display Name Fix ("Abacus" → "ChatLLM")

### `packages/contracts/src/model.ts`

- **Modifications**:
  - Changed `PROVIDER_DISPLAY_NAMES[ABACUS_DRIVER_KIND]` from `"Abacus"` to `"ChatLLM"`.
  - Updates the fallback name mapping for default provider instances across the codebase.

### `packages/client-runtime/src/state/providerInstanceDisplay.ts` & `.test.ts`

- **Modifications**:
  - Added legacy migration logic: if a persisted provider snapshot has `displayName === "Abacus"`, it is treated as a default label and normalized to `"ChatLLM"`.
  - Added unit test asserting legacy snapshot migration in `providerInstanceDisplay.test.ts`.

### `apps/server/src/provider/Drivers/AbacusDriver.ts` & `.test.ts`

- **Modifications**:
  - Added metadata display name configuration: `metadata: { displayName: "ChatLLM" }`.
  - In snapshot generation, sanitizes any existing snapshot configured with legacy `"Abacus"` to `"ChatLLM"`.

---

## 8. LaTeX Math Rendering & Fraction Clearance in Chat

### Architecture Overview

LLM responses frequently contain mathematical notation using standard LaTeX delimiters (`$ … $`, `$$ … $$`, `\( … \)`, `\[ … \]`). T3 Code's markdown renderer did not natively support math, rendering raw LaTeX source as plain text. The integration uses `remark-math` (remark plugin that parses math delimiters into AST nodes) and `rehype-katex` (rehype plugin that transforms those nodes into KaTeX HTML).

### `apps/web/src/components/ChatMarkdown.tsx` & `ChatMarkdown.test.tsx`

- **Modifications**:
  - **Imports**: `remark-math`, `rehype-katex`, and `katex/dist/katex.min.css`.
  - **`preprocessMarkdownMath(text)`**:
    - Runs _before_ markdown AST generation to translate delimiters safely.
    - Preserves fenced code blocks and inline code verbatim.
    - Transforms display math `\[ … \]` into block math (`$$\n…\n$$`).
    - Transforms inline math `\( … \)` into `$$ … $$`.
    - Detects single-dollar math `$math$` using `looksLikeMath` (detects LaTeX commands, math operators, subscripts, Greek characters, or mathematical single-letter variables while explicitly rejecting currency like `$20k` and skill mentions like `$2spec`).
  - **Tokenizer Configuration**:
    - `[remarkMath, { singleDollarTextMath: false }]` is configured in `CHAT_MARKDOWN_REMARK_PLUGINS` and `CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS`.
    - Disabling naive single-dollar matching prevents conflicts with skill chips and prices, while preprocessed math is cleanly tokenized.
  - **Rehype Pipeline Ordering**:
    - `rehypeKatex` is placed **after** `[rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA]`.
    - This allows user-supplied HTML to be sanitized first while preserving KaTeX's generated MathML and styled `<span>` elements from being stripped.
  - **Unit Testing**:
    - Added unit test suite in `ChatMarkdown.test.tsx` verifying display fractions, inline equations, currency preservation, code block isolation, and LaTeX bracket delimiters.

### `apps/web/src/index.css` (Fraction Denominator Clearance Fix)

- **Problem**: In standard KaTeX, the denominator characters in fractions (`\frac{a}{b}`, `\frac{1}{2}`) are positioned with only ~0.23px vertical clearance below `.frac-line`, causing top strokes of denominator characters (such as the top horizontal bar of `2` or ascenders) to be visually clipped or touch the fraction bar.
- **Root Cause**: KaTeX vertical list positioning (`.vlist`) sets `style="top:-2.655em"` for the denominator baseline, leaving inadequate clearance against the fraction bar at `top:-3.23em`.
- **Solution**:
  - Added targeted CSS transform in `apps/web/src/index.css`:
    ```css
    .katex .mfrac:has(.frac-line) > .vlist-t > .vlist-r:first-child > .vlist > span:first-child {
      transform: translateY(0.18em);
    }
    ```
  - Using `:has(.frac-line)` ensures that line-less fractions (such as binomial coefficients `\binom{n}{k}`) are unaffected.
  - Increases clearance between the fraction bar and denominator to ~3.7px, eliminating all visual clipping cleanly.

### `apps/web/package.json`

- **Dependencies**:
  - `katex@0.18.7`, `remark-math@6.0.0`, `rehype-katex@7.0.1`, `@types/katex@0.16.8`.

### `third-party-licenses.config.json`

- **Modifications**:
  - Added `packageOverrides` entries for `rehype-katex` and `remark-math` (MIT license, Copyright (c) Junyoung Choi) with `sourceUrl` pointing to the `remarkjs/remark-math` monorepo.
