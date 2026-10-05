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
- Discover the newest hosted Sonnet and Luna through the bridge's `--list-models`
  command on manual and periodic provider refreshes. Custom models remain
  available. Failed or incomplete discovery retains the last successful list.
  The original Sonnet 5 and GPT-5.6 Luna list remains the startup fallback.

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

## 20. Performance guardrails and upstream synchronization

- Added a timed 20,000-bucket usage-merge regression test with a 1,000 ms ceiling.
- Added a fast path that skips math preprocessing and plugins for messages without math delimiters.
- The focused benchmark improved plain-message math preprocessing from about 0.107 ms to 0.008 ms per call.
- Merged the latest `upstream/main` on September 22, 2026.

## 21. Agent-created threads and T3 orchestration layers

Status: Implemented in the development checkout on September 27, 2026. Final
verification and cross-provider integration remain open. The installed personal
app has not been replaced.

### Thread handoffs and model selection

The `threads` MCP toolkit exposes `list_thread_models`, `create_thread`,
`read_thread`, `send_message_to_thread`, and `interrupt_thread`. A new thread
can use another model in the same family or another configured provider.
Omitting the selection inherits the source model and options. Threads start
with fresh history, so the initial prompt must carry the handoff or assignment.
MCP credentials grant thread tools independently of Browser/Device availability.

The model manifest now groups GPT-6 Astra, Sol, and Luna as current and GPT-5.6
Sol and Luna as legacy. A live provider refresh confirmed the grouping.

### Workflow behavior

The orchestration layer tools are `start_orchestration_layer`, `spawn_child`, `assign_child`,
`report_to_parent`, `wait_for_children`, `read_orchestration_layer`,
`control_orchestration_layer`, and `refresh_coordination_policy`.

- Any available model can be selected for a parent whose harness exposes these tools.
- Children cannot create threads, start workflows, or assign other children.
- Four children run concurrently. Excess assignments persist in the queue.
- Initial assignments wait until the planning turn ends. Provider-native subagents remain available. T3 children cannot start workflows, create child threads, or assign work.
- Reports persist while the parent is busy. The parent resumes when idle, with budget and pending human requests respected. Reports can arrive individually or coalesce without losing report IDs.
- `wait_for_children` records intent and tells the agent to end its turn. It does not poll.
- Reviews use a detached checkout of a resolved Git commit and stay read-only. Editing children need separate existing registered worktrees; the parent integrates changes.
- Pause blocks new starts. Resume preserves counters. Complete retains late reports without waking the parent. Cancel interrupts owned children and cancels queued work.
- Manual parent messages and interrupts pause coordination. Restart recovery pauses workflows rather than replaying uncertain paid work.
- Active workflow members cannot be archived, and active children cannot be deleted. Parent deletion cancels its workflow first.
- Provider completion captures final child output when no explicit report was sent. Turn correlation rejects stale terminal events. Acceptance/completion ordering and startup reconciliation are covered by regression tests. Unnamed disconnects pause active parents; disconnected children of completed parents remain removable.

The event-sourced workflow state persists through migration
`054_ThreadCoordination`. Shell snapshots carry counters and report identities;
full assignment prompts and report bodies remain in thread detail.

### Model budgets and maintenance

One round means one automatic provider turn start. Initial user planning is
excluded. Parent report wakeups and child assignments share counters for the
same canonical model across aliases and provider instances.

| Model            | Automatic turns per workflow |
| ---------------- | ---------------------------- |
| GPT-6 Astra      | 1                            |
| GPT-6 Sol        | 2                            |
| GPT-6 Luna       | Unlimited                    |
| Gemini 3.8 Flash | Unlimited                    |
| Sonnet 5         | 1                            |
| Opus 5.5         | 1                            |
| Fable 5.1        | 1                            |
| GLM 5.3 Flash    | Unlimited                    |

For other models, output pricing in USD per million tokens determines the default:
above $10 gives one turn, below $1 gives unlimited turns, and $1 through $10
inclusive gives four. Unpriced models require an override. Named defaults and
user overrides take precedence over price bands. Unlimited is a turn policy,
not a claim that the provider is free or has no rate limits.

Maintenance refreshes available models and pricing monthly while the server
runs. A manual refresh is also available. Failed pricing refreshes retain the
previous cache. Active workflows keep their captured limits and counters.
Policy names do not add models to a provider catalog or grant subscription access.

Web and desktop expose limits under Settings > Providers. Mobile exposes them
under Settings > Maintenance, labeled by environment. Workflow controls show
children, pending reports, budgets, and parent navigation; web also has command
palette actions. The desktop controls were checked in an isolated development
app; mobile and remote flows remain unverified.

### Provider enforcement and limitations

- Codex and Claude may use provider-native subagents during T3 orchestration layers. The T3 server rejects nested T3 orchestration layer creation and child assignment. Reviews remain read-only; Codex review turns use a read-only sandbox without routine approval prompts, and Claude reviews disallow shell and write tools.
- ChatLLM reviews advertise read/list and scoped reporting tools. Reads are confined to the snapshot, including symlink checks; forbidden writes are rejected at execution time.
- Zed passes `--worker-mode`, forwards the scoped T3 HTTP MCP server, and requires `_meta.t3WorkerPolicy`. Parent sessions also require `_meta.t3ThreadTools`. The companion Zed source enables only coordination tools in worker profiles. Older binaries fail closed.
- Antigravity can parent or join a T3 orchestration layer. Its managed ACP runtime called T3 MCP tools in an isolated dev thread. The server rejects nested layer creation and T3 thread creation from any child. Cursor, Grok, and OpenCode remain excluded because their workflow role support has not been established. Ordinary handoffs remain available.

ChatLLM parent forwarding is tested through its tool loop and the real MCP
HTTP protocol. Zed forwarding compiles, but native discovery needs a separate
rebuilt binary smoke test. Codex/Claude read-only execution prevents writes; it
is not a general sandbox against reading every host path. An isolated Sol parent
assigned work to two Luna and two Gemini children, received all four reports,
and used them to repair a test fixture.
Track the remaining Gemini parent verification in
[the issue tracker](./ISSUE_TRACKER.md#workflow-002-enable-strict-antigravity-workflows).

### Verification recorded

The final isolated Sol parent/Luna child smoke passed. The child reported
`COORDINATION_NATIVE_OK`, the parent resumed and completed, and each consumed
one automatic turn. The final focused suite passed 219 backend tests; six
client interaction/parser tests and a real MCP HTTP transport test also passed.
Server, mobile, contracts and client-runtime typechecks passed. Scoped lint
passed with 79 warnings. Web typechecking retains 11 unrelated HAST errors.
The companion Zed compile check passed without replacing the installed binary.

GPT 6 Sol at low reasoning reviewed the earlier changes. An isolated desktop
pass covered an ordinary Sol thread and a four-child workflow. A shared
child-start command ID initially prevented three provider sessions from
starting; unique per-child IDs fixed that. All four reports informed a parent
patch, and the fixture passed 10/10 tests. The focused coordination suite
passed 13/13 after the fix. Remote/mobile flows and native Zed tool discovery
remain unverified. Evidence is in [SESSION_HANDOFF.md](./SESSION_HANDOFF.md).

## 22. Quota handoff for T3 orchestration layers

An environment policy sets a usage threshold and ordered model fallbacks. Each
layer opts in. At 95% used in any reported quota window, the server interrupts
the affected turn and prepares a linked handoff thread. It switches providers
once at most. A fallback needs a ready, authenticated provider, a fresh quota
reading below the threshold, role support, and one remaining automatic turn.
If no fallback qualifies and the source reports a reset time, the layer waits
for a fresh source reading after that reset. Unknown quota or reset time pauses
automatic work with a visible reason. Manual activity cancels pending routing.

An isolated runtime probe used real SQLite projections and the orchestration
engine with simulated quota readings. Luna XHigh at 95% routed a child to
Gemini 3.8 Flash High. After the source settled, the destination received its
partial edit history and the engine started a summary turn. The probe supplied
summary text and confirmed that the continuation prompt included it. A separate
reset probe resumed Luna at 12% in a linked thread. The
probe found and fixed lost XHigh options and stale reset details on that path.
The web Providers page showed the 95% threshold and Luna-to-Gemini mapping.
Focused coordination and quota reactor tests passed, as did the server
typecheck. The probe did not consume real quota or run the destination provider.

Antigravity parent support followed a live check of the managed ACP runtime.
Gemini called `read_thread` and `start_orchestration_layer` in an isolated dev
thread. The server recorded the calls and persisted an active parent with quota
handoff enabled. The policy and Luna-to-Gemini parent routing tests passed.
A complete Gemini parent assignment and report cycle remains unverified.
