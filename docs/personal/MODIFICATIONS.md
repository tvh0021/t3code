### `apps/web/src/components/usage/UsageLimits.tsx`

- **Modifications**:
  - Configured Google blue `#4285f4` in `barColor()` for `driver === "antigravity"` to distinctly identify Antigravity usage bars in the UI.

---

## 10. ChatLLM (Abacus) Usage Limits Restoration & Snapshot Wiring

### Root Cause & Architecture

While `readAbacusUsageLimits` was previously implemented and tested, `AbacusDriver.ts` was not invoking it or attaching the returned limits to the driver's snapshot draft or `refresh` method. Because `provider.usageLimits` remained `undefined`, `providersWithLimits()` in `packages/shared/src/usageLimits.ts` filtered ChatLLM out of the Usage Limits panel.

### `apps/server/src/provider/Drivers/AbacusDriver.ts`

- **Modifications**:
  - Imported `readAbacusUsageLimits` from `../Layers/abacusUsageLimits.ts`.
  - Extracted `apiKey` and `sessionCookie` during provider instantiation.
  - When credentials are present, queries `readAbacusUsageLimits` and attaches `usageLimits` to `draft`.
  - Implemented `snapshotShape.refresh` to re-query `readAbacusUsageLimits` whenever the snapshot is refreshed, updating `usageLimits` dynamically.

---

## 11. Antigravity Third-Party Models Feasibility Analysis & Quota Filtration

### Feasibility Analysis of Third-Party Models (Claude / GPT-OSS)

- **Backend Capabilities**:
  - Cloud Code Private API (CCPA) supports models such as `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, and `gpt-oss-120b-medium`. Live API calls confirmed that `v1internal:streamGenerateContent` successfully streams completions for these models when authenticated.
- **ACP Protocol Blocker**:
  - In T3 Code, Antigravity communicates via Google's official ACP server binary (`agy_acp_server.par`).
  - Analysis of `agy_acp_server.par` (specifically `google3/cloud/developer_experience/antigravity_extensions/acp_server/model_selection.py`) revealed a hardcoded filter:
    ```python
    for ccpa_id in ordered_model_ids:
        # Only include models that start with "gemini".
        if not ccpa_id.startswith("gemini"):
            continue
    ```
  - During session initialization or model switching (`session/new` or `session/set_config_option`), the server validates the requested model against this whitelist. Selecting any non-Gemini model causes the server to reject the request with JSON-RPC error `-32602` (`RequestError: Model is not available`).
  - Because `agy_acp_server.par` is fetched as a Google-signed release binary with strict SHA256 integrity verification, binary modification is infeasible.
  - In Antigravity Desktop, 3P models are served through `language_server` rather than `agy_acp_server`. Once Google updates the ACP binary to support 3P models, T3 Code will automatically surface them without code changes due to its dynamic ACP option discovery.

### Exclusion of Claude/GPT Quota Windows

- **User Preference**: Since 3P models cannot currently be selected or used through Antigravity in T3 Code, third-party quota buckets are filtered out from the Usage tab to prevent misleading status displays.

### `apps/server/src/provider/Layers/antigravityUsageLimits.ts`

- **Modifications**:
  - In `antigravityQuotaSummaryToLimits`, buckets belonging to Claude/GPT groups (e.g. group name containing `"claude"` or `"gpt"`, or bucket ID starting with `"3p"`) are ignored.
  - Simplified window labels to `"Session"` (for 5-hour quota) and `"Weekly"` (for weekly quota), aligning with Codex and Claude provider conventions instead of prefixing `"Gemini (...) "`.
  - Windows are sorted by `windowDurationMins` ascending so that `"Session"` appears first, followed by `"Weekly"`.
  - Only active Gemini quota windows (`gemini-weekly` and `gemini-5h`) are exposed to the client runtime.

### `apps/server/src/provider/Layers/antigravityUsageLimits.test.ts` & `AntigravityProvider.test.ts`

- **Modifications**:
  - Updated test assertions verifying that third-party quota entries are properly excluded and labels match `"Session"` and `"Weekly"` while sorting duration order correctly.

---

## 12. Antigravity Model Catalog Seeding & Server Bundle Rebuild

### Root Cause & Architecture

- **Symptom**: When Antigravity usage limits were integrated, `readAntigravityUsageLimits` successfully confirmed active Google Cloud Code quota windows. In `AntigravityProvider.ts`, `checkAntigravityProvider` set `status: "ready"` and `auth: { status: "authenticated" }`. However, in the UI model picker dropdown, Antigravity displayed "No models found" / "No models are available for this provider. Open provider setup", despite usage limits showing correctly.
- **Root Cause**:
  1. In `AntigravityProvider.ts`, `initialDraft` initializes `models: []`.
  2. Because Antigravity's health probe is synthetic (avoiding the ~1 GB PyInstaller extraction overhead of `agy_acp_server` every 60 seconds), `models` was only populated dynamically when an explicit ACP session started (`onSessionStarted` / `onConfigOptionsUpdated`).
  3. Without an active session in memory, `draft.models` remained `[]`.
  4. Upstream `model-manifest.json` already defines the complete Antigravity model catalog (`gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`) with default `gemini-3.8-flash-high`.
  5. In `AntigravityDriver.ts`, `classifyModels` only overlaid manifest metadata on _existing_ models; it did not seed `draft.models` when `draft.models` was empty.
  6. The desktop app executes the compiled server bundle at `apps/server/dist/bin.mjs` (watched by `dev-electron.mjs`), which required rebuilding via `pnpm --filter t3 build:bundle` to take effect.
- **Resolution**:
  - In `apps/server/src/provider/Drivers/AntigravityDriver.ts`, updated `classifyModels`:
    ```typescript
    if (
      draft.installed !== false &&
      draft.status !== "error" &&
      draft.auth.status !== "unauthenticated" &&
      draft.models.length === 0
    ) {
      const catalog =
        ModelManifest.resolveProviderCatalog(manifest, DRIVER) ??
        ModelManifest.resolveProviderCatalog(ModelManifest.BUNDLED_MODEL_MANIFEST, DRIVER);
      if (catalog && catalog.models.length > 0) {
        withModels = {
          ...draft,
          models: catalog.models.map((entry) => {
            const isDefault = entry.model.isDefault;
            const aliases = isDefault
              ? [...new Set([...(entry.model.aliases ?? []), ANTIGRAVITY_DEFAULT_MODEL])]
              : entry.model.aliases;
            return {
              ...entry.model,
              capabilities: entry.model.capabilities ?? { optionDescriptors: [] },
              ...(aliases ? { aliases } : {}),
            };
          }),
        };
      }
    }
    ```
  - Changed the guard from `draft.auth.status === "authenticated"` to `draft.auth.status !== "unauthenticated"` so models are available whenever Antigravity is installed and not signed out.
  - Rebuilt the bundle with `pnpm --filter t3 build:bundle`.
  - When an active session starts, `onSessionStarted` populates `draft.models` with live ACP models, taking precedence.
  - When unauthenticated or disabled, models remain empty.

---

## 13. Token & Cost Tab Integration for Antigravity & ChatLLM

### Architecture Overview

T3 Code's Usage window previously only tracked tokens and costs for Codex (and Claude/OpenCode). We extended the Usage engine and interface to incorporate Antigravity and ChatLLM (Abacus AI) alongside Codex:

1. **Contracts (`packages/contracts/src/usage.ts`)**:
   - Expanded `UsageProvider` schema from `"codex" | "claude" | "opencode"` to include `"antigravity" | "abacus"`.
2. **Web UI (`apps/web/src/components/usage/usageProviders.ts`)**:
   - Registered `antigravity`: Label `"Antigravity"`, vector icon `AntigravityIcon`, brand color Google Blue (`#4285f4`).
   - Registered `abacus`: Label `"ChatLLM"`, vector icon `AbacusIcon`, brand color Abacus Teal (`#008ef8`).
3. **Mobile UI (`apps/mobile/src/features/usage/usageProviders.ts`)**:
   - Added corresponding metadata entries for mobile usage tabs.
4. **Real-Time Turn Usage Writer (`apps/server/src/usage/providerTurnUsageWriter.ts`)**:
   - Created atomic append-only writer that writes standard JSONL usage records (`session_meta`, `turn_context`, and `token_count`) to `.t3/userdata/usage/{provider}/sessions/{sessionId}.jsonl` immediately upon request completion.
5. **Adapter Hooks**:
   - Connected `AntigravityAdapter.ts` and `AbacusAdapter.ts` to log usage upon turn settlement without blocking the event stream.
6. **Transcript Scanning (`apps/server/src/usage/UsageService.ts`)**:
   - Added transcript directory resolution for `antigravity` and `abacus`, loading their sessions directly into the Usage aggregation scanner.

---

## 14. Protobuf Precision Usage Recovery & Model Pricing Normalization

### Protobuf Precision Token Extraction

- Rather than relying on character-count heuristics for Antigravity, we leveraged the binary protobuf parser from the `request-auditor` skill:
  - Antigravity logs execution steps to local SQLite databases (`steps` table, step type `15`).
  - Decoded Protobuf fields:
    - Field `9.2`: Uncached input tokens
    - Field `9.5`: Prompt cache read tokens
    - Field `9.3`: Output tokens
    - Field `9.9`: Internal reasoning/thinking tokens
    - Field `24.8` / `gen_metadata`: Selected model
  - Re-extracted all historical Antigravity sessions into `.t3/userdata/usage/antigravity/sessions/`, recovering accurate token counts (~659.5M total tokens across 42 sessions).

### Missing Model Pricing Fixes

1. **`claude-opus-4-6-thinking`**:
   - Antigravity appends `-thinking` to Claude models. LiteLLM indexes it as `claude-opus-4-6`.
   - Updated `candidateRateKeys` in `usagePricing.ts` to strip `-thinking` suffixes, resolving the model cleanly against LiteLLM ($5.00/M input, $0.50/M cache read, $25.00/M output). Added fallback entry to `STATIC_FALLBACK_RATES`.
2. **`codex-auto-review`**:
   - OpenAI's internal automated code review bot model, absent from LiteLLM's public rate sheet.
   - Added to `STATIC_FALLBACK_RATES`: $1.00/M input, $0.25/M cache read, $4.00/M output (from `request-auditor` rate catalog).
3. **`gemini-3.8-flash-tiered`**:
   - Antigravity tiered routing model.
   - Updated candidate normalization regex in `usagePricing.ts` from `/^(gemini-[^-]+-flash)-(high|medium|low)$/` to `/^(gemini-[^-]+-flash)-(high|medium|low|tiered)$/`, normalizing directly to `gemini-3.8-flash`.

### ChatLLM / RouteLLM Credit Valuation

- Audited all local Abacus project files (`~/.abacusai/projects/*/*.json`), logs, and history files. Verified that no local token counts are recorded by Abacus.
- Reverse-engineered user plan pricing anchors (Basic 10k/$5, Month 1 14k/$7, Month 2+ 20k/$10) to establish the exact constant: **1 credit = $0.0005** (2,000 credits = $1.00).

---

## 15. Antigravity Usage Label Standardization & Model Display Name Normalization

### Antigravity Presentation Label

- Replaced two-word spelling `"Anti Gravity"` with official single-word name `"Antigravity"` across:
  - `apps/web/src/components/usage/usageProviders.ts`
  - `apps/mobile/src/features/usage/usageProviders.ts`
- Ensured consistent naming matching Google Antigravity across web and mobile surfaces.

### Model Display Name Normalization

- Centralized usage model string cleaning in `normalizeUsageModel` inside `packages/contracts/src/usage.ts`:
  - `claude-opus-4-6-thinking` and `claude-opus-4-6` normalize to `claude-opus-4.6`
  - `deepseek-ai/DeepSeek-V4.1-Flash` normalizes to `deepseek-v4.1-flash`
  - `zai-org/GLM-5.3-Flash` and `zai/glm-5.3-flash` normalize to `glm-5.3-flash`
  - `gemini-*-flash-(high|medium|low|tiered)` retains normalization to `gemini-*-flash`
- Integrated across server-side usage aggregations (`usageAggregation.ts`), multi-environment usage folding (`usageMerge.ts`), and price rate overrides (`usagePricing.ts`).
- Added unit tests in `packages/shared/src/usageMerge.test.ts` verifying canonical model name presentation.

---

## 16. ChatLLM (RouteLLM) Token Accounting Under-reporting Root Cause Analysis

### Diagnosis

- Comparison of local JSONL logs (17 turns across 10 sessions) against official Abacus RouteLLM credit usage revealed a ~4.5x undercount:
  - **Local token pricing**: $0.003599 (~7.20 credits at $0.0005/credit)
  - **Actual RouteLLM billing**: 32.18 credits ($0.01609)
  - **Variance**: Sep 17 undercounted 8.6x; Sep 18 undercounted 3.9x.
- Because the undercount varies significantly by day and session, a flat rate multiplier is inapplicable.

### Root Cause

- In `apps/server/src/provider/Layers/AbacusAdapter.ts` (`sendTurn`), the agentic loop executed:
  ```typescript
  if (usage !== undefined) finalUsage = usage;
  ```
  on each tool execution iteration.
- Because each tool call step sends an independent HTTP completion to RouteLLM containing the growing conversation history, system prompt, and tool schemas, overwriting `finalUsage` causes all intermediate steps' tokens to be lost. Only the final completion's usage reached `appendProviderTurnUsage`.

### Remediation

- Accumulate prompt, cached, output, and reasoning tokens across all loop steps before invoking `appendProviderTurnUsage`.

---

## 17. ChatLLM Credit vs Subscription Separation in Usage Reporting

### Problem & Motivation

Subscription models (Codex, Antigravity) are paid flat-rate monthly subscriptions where token counts represent raw throughput and API cost is an estimated figure based on standard API rates. In contrast, ChatLLM (Abacus / RouteLLM) is metered on a prepaid compute-credits basis where each request consumes compute points ($0.0005 / credit).
Mixing ChatLLM into the top-level token and cost figures skewed subscription token metrics and misrepresented how ChatLLM is billed.

### Architecture & Implementation

1. **Billing & Valuation Constants**:
   - Added `ABACUS_CREDIT_COST_USD = 0.0005` in `packages/contracts/src/usage.ts` alongside helper utilities `abacusCreditsToUsd` and `usdToAbacusCredits`.
   - Added optional `credits` field to `UsageBucket` and updated model normalizations.
2. **Turn Credit Measurement**:
   - In `apps/server/src/provider/Layers/abacusUsageLimits.ts`, exported `fetchAbacusComputePoints` to probe the Abacus `_getOrganizationComputePoints` endpoint before and after an execution turn.
   - In `apps/server/src/provider/Layers/AbacusAdapter.ts`, accumulated tokens across agent tool execution loops (fixing the clobbering bug) and computed credit consumption from the compute points delta (falling back to model rate / `ABACUS_CREDIT_COST_USD` if points delta is zero).
3. **Usage Transcript & Storage**:
   - Persisted `credits` in `providerTurnUsageWriter.ts` and extracted it in `usageTranscripts.ts` and `usageAggregation.ts`.
4. **Subscription Totals Separation**:
   - In `packages/shared/src/usageMerge.ts`, calculated separate subscription totals (`subscriptionCostUsd`, `subscriptionTotalTokens`, `subscriptionTotals`, `subscriptionCacheSavingsUsd`) that only aggregate Codex and Antigravity (excluding Abacus / ChatLLM).
5. **UI Structure in `UsagePage.tsx`**:
   - **Hero Card**: Displays `subscriptionCostUsd` and `subscriptionTotalTokens` with descriptive subtitle reflecting subscription usage.
   - **Provider Card**: Shows credit count for Abacus (`X credits · Y tokens`) while subscription providers show cost and token share.
   - **Totals Row**: Shows subscription model totals (Processed tokens, Cached input, Uncached input, Output, Cache savings).
   - **Model Breakdown**: Split into two distinct sections:
     - _Subscription Models (Codex & Antigravity)_: Shows Model, Cost, Cost Share, and Tokens.
     - _ChatLLM Models (Credit-Based)_: Shows Model with ChatLLM badge, Cost, Credits used, and Tokens.

## 18. Codex credit backfill correction

- The first 90-day Codex backfill was invalid because it treated an account-wide balance snapshot as if it belonged to each rollout file. Parallel and forked sessions therefore counted the same balance drop more than once.
- Scan-cache version 5 stores raw Codex credit balances. The server reconciles all retained Codex records in timestamp order before aggregation, including balance changes carried by duplicate token payloads.
- `codex-auto-review` is excluded from credit cost and USD cost. Its balance snapshot does not move the paid baseline, so a concurrent paid drop is counted on the next paid record.
- The corrected local corpus result is about 1,334 credits, or $53.37, for a balance change from 2,500 to about 1,166.

## 19. Zed ACP integration status

Status: Partial. The adapter is present for investigation, but Zed ACP is not
release-ready. The changelog records the verified streaming repair only.

### Verification Scope

- Implemented the Zed provider snapshot and health probe, adapter lifecycle,
  streaming event mapping, permission flow, elicitation flow, slash-command
  dispatch, and rollback protection for investigation.
- The protocol harness targets
  `/Users/tvh0021/git_repos/zed-dev/target/debug/zed-acp-server`, but the
  streaming path is now verified in an isolated web client.
- Limited the built-in Zed model catalog to `zed.dev/claude-sonnet-5` (Claude Sonnet 5) and `zed.dev/gpt-5.6-luna` (GPT 5.6 Luna), while retaining support for explicitly configured custom models.

### Modifications

- Kept the ACP protocol handshake independent of an ACP auth method; hosted Zed models still reuse the user's stored Zed credentials.
- Forwarded the selected T3 model identifier to the headless Zed binary and corrected its settings key to `agent.default_model`.
- Added headless model readiness: the ACP server authenticates with the existing Zed credential store, waits for the selected model to be discovered, and installs it in Zed's model registry before creating a session.
- Corrected Zed adapter runtime identifiers to use Effect's crypto service.
- Aligned provider snapshots and driver wiring with the current server-provider contracts.
- Added schema-compliant ACP elicitation responses and synchronized slash-command assertions with streamed output.

### Verification Results

- The fake-ACP adapter tests cover streaming, permissions, elicitation, and
  context-token updates.
- The scoped server typecheck exits 0 with no Zed-related TypeScript errors.
- The real-binary Luna smoke test passes with network access. Sandboxed DNS
  cannot resolve `cloud.zed.dev`.
- The September 21 streaming repair filters identical completed or failed tool
  snapshots before message segmentation. A real Sonnet file-read turn produced
  one completion and one intact Markdown answer in an isolated web client.
- Real Zed Luna approval and decline flows pass in an isolated web client.
  Both paths finish without a session crash.
- The headless bridge forwards context usage for real Luna turns, and the
  composer meter uses the reported token count and capacity.
- Zed adapter tests use `@effect/vitest`; scoped lint and typecheck pass.

### Current status

- Zed streaming, permission, and context-window usage flows are verified.
- Zed account spend is reported as unavailable. T3's stored native credential
  can read `/client/users/me`, but Zed's billing routes return `401` because
  they require a dashboard browser session. ACP session cost cannot replace
  the missing account-wide billing total.
- Follow-up work is tracked in `docs/personal/ISSUE_TRACKER.md`.
