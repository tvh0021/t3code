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

### ChatLLM / Abacus Token & Point Verification

- Audited all local Abacus project files (`~/.abacusai/projects/*/*.json`), logs, and history files. Verified that no local token counts are recorded by Abacus.
- Confirmed official compute point conversion: 10,000 points = $10.00 ($0.001 per compute point).
