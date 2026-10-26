# Personal fork modifications

The detailed companion to [the changelog](./CHANGELOG.md). Each feature area
describes current behavior (**Now**), then the reasons behind each change
(**Decisions**), keyed by release and [issue tracker](./ISSUE_TRACKER.md) ID.
Search for a version or ID from a changelog line to find its reasoning. When a
decision and **Now** disagree, **Now** wins.

## Look and feel

**Now.** The sidebar title has two lines, `T3 Code` and italic `personal`. The
default font sizes are interface 20px, prompt 18px, code 18px and terminal 17px
(`packages/contracts/src/settings.ts`); saved preferences override them. Chat
renders inline and block math with KaTeX, including inside tables and bold or
italic text. HTML file links open in the system browser, with the integrated
browser in the context menu.

**Decisions.**

- Before 0.0.42: messages without math delimiters skip math preprocessing and
  plugins, so ordinary chat pays nothing for KaTeX.
- 0.3.1: KaTeX markup and stylesheet are pinned to the same version (0.18.7).
  A mismatch drew vector accents inside their letters.
- 0.9.0: upstream's shared math pipeline (`@t3tools/shared/markdownMath`,
  `MarkdownMath.tsx`, `MathTypeset.tsx`) replaces the fork's `chatMarkdownMath.ts`
  preprocessor and `rehype-katex`. It covers the same cases (`$skill` tokens,
  currency, `\( \)` and `\[ \]`, tables) and renders markup and stylesheet from
  one `katex` import, so the 0.18.7 pin is gone and upstream's `katex` range
  applies. The fork's KaTeX "clearance" CSS in `apps/web/src/index.css` (shifted
  fraction denominators and radical lines, hidden overflow on display math) is
  gone too: it compensated for that mismatch, and on correct markup it pushed
  the inner denominator of a nested fraction into the outer bar and clipped
  tall inline fractions. The fork keeps `mathRenderingEnabled` defaulting to on
  (`packages/contracts/src/settings.ts`); upstream defaults it to off.
- 0.3.1: HTML files are served by the environment that owns them, including
  files outside the workspace. PDFs are unchanged.
- 0.3.3: upstream's provider badge helpers are back. An earlier sync had
  silently reverted them. The only fork change left there relabels an instance
  still named "Abacus" as ChatLLM.

**Removed.** Single-instance provider badges were hidden before 0.0.42; 0.3.3
restored upstream's badges.

## ChatLLM provider

**Now.** The `abacus` driver runs ChatLLM (Abacus RouteLLM) through the
configured API. Catalog refresh lists the account's models and keeps custom
models. Its agent loop streams tool calls and runs `read_file`, `write_file`,
`edit_file`, `list_directory` and `execute_command`, with filters for known
destructive commands. A turn allows 200 tool calls on models whose id contains
`flash` and 50 on others (`abacusMaxTurnSteps`); `requestTimeoutMs` (default
600 s) applies to each request.

**Decisions.**

- 0.7.4 (CHATLLM-USAGE-001): `AbacusAdapterV2` overwrote usage after each
  request. It now sums every request's tokens.
- 0.7.5 (CHATLLM-USAGE-002): per-turn credits from account balance changes
  missed late charges and mixed concurrent turns. Turn logs now hold tokens only,
  and credits come from Abacus's billing ledger (`abacusLedger.ts`); see Usage.
- 0.6.1 (CHATLLM-STEPS-001): the old 20-call cap ended delegated runs with a
  silent `completed`. The cap now depends on the model, the batch that would
  exceed it is skipped so history has no unanswered calls, and the turn ends
  with a visible message that delegated tasks report as their summary.
- 0.6.4 (CHATLLM-WRITE-001): writes compared path text, so a symlink
  inside the project could redirect them outside it. They now check the real
  path (`resolveWorkspaceWritePath`). `execute_command` can still write
  anywhere, so this is not a sandbox.
- 0.10.0: moving ChatLLM onto Pi or OpenCode as a custom OpenAI-compatible
  provider was checked and rejected. RouteLLM handles their tool calling
  (parallel calls, tool results, streamed usage), but neither harness is in use
  here, and the usage, ledger and catalog code would remain. Keep this loop.

**Removed.** In the 0.4.0 sync: parent access to T3 coordination tools over the
HTTP MCP bridge, and the read-only tool set for review workers. Delegated
reviews now run in their own worktree instead (see Delegated tasks).

## Usage

**Now.** Usage prices every provider's tokens at API-equivalent rates. Codex
credits cost $0.04 and ChatLLM credits $0.0005 (`packages/contracts/src/usage.ts`).
Effort and thinking variants of a model share one row. Credit-based usage is
shown separately from subscription usage. Day and hour columns, totals and charts
count subscription costs only. Locally generated Claude `<synthetic>` messages
do not count as usage. The period picker includes All time
(`Cmd/Ctrl+Shift+5`) and remembers the last period. ChatLLM writes per-turn
token logs; every other provider is read from its native transcripts or
database. ChatLLM credits come from Abacus's daily billing ledger, read with the
API key, so they match the Abacus dashboard and include use outside T3. Turns on
ledger days add tokens only; hourly views and days the ledger lacks price tokens
at published rates. Antigravity model aliases share a priced model row, and unnamed
steps inherit the nearest named model when available.

**Decisions.**

- 0.6.3 (MOBILE-002): newer phone apps reject the whole Usage reply when it
  contains ChatLLM. `ForwardCompatibleArray` doesn't drop unknown entries inside
  RPC replies, so the host removes ChatLLM for every mobile client
  (`usageClientCompatibility.ts`). app.t3.codes is not projected.
- 0.3.2 (USAGE-001): price precedence is custom prices, then provider-reported
  cost, then verified official rates, then LiteLLM (`usagePricing.ts`).
  Estimates use base-context rates and leave out Gemini cache storage.
- 0.3.2: `gemini-pro-agent` maps to Gemini 3.1 Pro and the Gemini Flash tiers
  combine, matching Antigravity's own labels. `codex-auto-review` costs nothing
  and doesn't move the credit baseline.
- 0.3.3, 0.4.0: Codex credits come from balance snapshots ordered by time
  across every rollout, so a forked or duplicated session doesn't charge the
  same balance drop twice. The scan cache (v6) stores each record's balance.
- 0.6.0 (USAGE-003): Codex compresses old rollouts to `.jsonl.zst` and moves
  some to `archived_sessions`. The scanner reads both and counts duplicate
  sessions once. Saved usage no longer expires after 92 days, so it outlives
  provider cleanup; usage deleted before its first scan is still lost.
- 0.6.1 (USAGE-004): speed comes from the provider's reported `usage.speed`,
  not the selected option. Claude Code silently drops Fast when the account
  can't serve it, so the Claude adapter adds one thread notice with the reason.
- 0.6.4 (USAGE-006): Codex balances are account-wide, so each Codex home
  reconciles `sessions` and `archived_sessions` as one timeline. Reconciling
  each directory alone charged the same drop once per directory.
- 0.6.4 (USAGE-005): Gemini usage in Antigravity databases has no
  response id, and each call appears in its step, its generation and the
  generation's retry list. Identical id-less totals within one database count
  once (`antigravityUsageReader.ts`, upstream's file).
- 0.7.4 (USAGE-007): Antigravity step rows often carry only a numeric
  model ID, while their generation rows carry names such as
  `claude-opus-5-5-medium`. A real name beats an `antigravity-model-<id>`
  placeholder when the two merge, and IDs 1318, 1322 and 1401 are mapped.
  Steps with no model at all (context compaction) take the nearest named
  step's model, then the nearest generation's. Gemini access-tier suffixes
  `-trial` and `-n` bill as the base model, and `gemini-pro-default` joins
  `gemini-pro-agent` as Gemini 3.1 Pro.
- 0.7.4 (USAGE-007): Gemini 4 Argon uses Google's introductory rate of $2
  input, $10 output and $0.10 cached per 1M tokens, valid through 2026-11-30.
  The shared rate also prices ChatLLM Argon usage without changing its reported credits.
- 0.10.0: launch rates carry their end date (`introductoryUntil` in
  `usagePricing.ts`) and each record is priced by its own timestamp, so Argon
  doubles on 2026-12-01 and Gemini 3.8 Flash on 2027-01-01 without an edit, and
  history before the change keeps its launch price. GPT-5.6 Sol's promotional
  rate has no published successor, so its row is undated.
- 0.7.5 (CHATLLM-USAGE-002): the ledger is the undocumented
  `_getOrganizationComputePointLog` endpoint behind the Abacus billing page.
  It returns 30 UTC days per model, so `usage-abacus-ledger.json` keeps older
  days. It refreshes during Usage scans, at most once a minute, and charges post
  within minutes. Token pricing supplies estimates when daily ledger data is
  unavailable or the view needs hourly timestamps.
- 0.7.5 (USAGE-002): `mergeUsage` included credit spend in period provider
  columns but omitted it from Total. Both now use subscription costs.
- 0.7.5 (USAGE-008): Claude's local errors and interruptions appeared as an
  unpriced model. The fork skipped `<synthetic>` records in aggregation; since
  0.10.0 upstream drops them in the Claude parser and the scan cache instead.
- A 20,000-bucket merge has a 1,000 ms test budget (`usageMerge.test.ts`).

**Removed.** In the 0.4.0 sync, the fork's Antigravity per-turn logs and its
protobuf trace decoder gave way to upstream's SQLite scanner. In 0.10.0, the
v5 Usage contract for App Store 1.2.x and 1.3.x (MOBILE-001); those builds are
gone, and every mobile client now gets v6 without ChatLLM.

## Limits

**Now.** Limits shows reset countdowns for Antigravity, ChatLLM and Zed besides
upstream's providers. Antigravity has a Gemini pool, a separate Gemini 4 Argon
weekly pool when reported, and a shared "Claude & GPT" pool. ChatLLM shows monthly
compute points. Zed shows `$X of $Y spent`, or `$X spent, no limit`. After rollover, T3 advances
an ended billing period by calendar months and rereads spend once.

**Decisions.**

- 0.4.0: the fork adopted upstream's Antigravity quota probe and its shared
  Claude & GPT bucket instead of keeping its own converter.
- 0.7.3 (AG-QUOTA-002): Google's daily quota endpoint omits both
  the Gemini and Gemini 4 Argon groups when the request identifies as
  `antigravity/hub/1.0.0`. Personal 0.6.2 merged the non-daily endpoint to fill
  in Gemini, but that endpoint reports a separate unused Gemini quota (98%
  weekly and 100% five-hour). Identifying as `antigravity/hub/2.24.0` returns
  the real Gemini and Argon pools in `makeAntigravityUsageProbe`. The probe retains
  upstream's merge of both quota endpoints, keeping the higher used percentage
  when both report a bucket, so a missing group on one endpoint stays visible.
  Unspent rolling windows omit their synthetic `now + 5h` reset timestamp.
- 0.5.0 (ZED-001): Zed's own credential can't read billing, so spend comes from
  `cloud.zed.dev` with a dashboard sign-in. Desktop signs in with **Connect** in
  Zed provider settings; other clients paste the dashboard Cookie header. The
  session lives in the host's secret store. Spend is read at provider start,
  after each Zed turn, and once when the cached period ends. A missing or expired session shows a
  notice, not an empty bar. Only personal billing is read.
- 0.7.2 (ZED-RESET-001): Zed's `subscriptions/current` keeps reporting the
  ended billing period for hours after the monthly rollover, so
  `zedSpendToUsageLimits` rolls an ended period forward by calendar months.
  When the cached period ends, the next status probe also rereads spend once
  per period end (`endedZedPeriod` in `ZedDriver`), which is still not polling.

## Antigravity

**Now.** Antigravity runs over ACP with the recognized Zed client identity, so
the account can offer Claude Opus 5.5 and Sonnet 5.5 (low, medium, high) next
to Gemini. Built-in seeds fill the picker until live discovery answers.
Native task results appear in the work trace without ending the prompt. ACP
errors keep the native operation and error text.

**Decisions.**

- 0.3.0: the Claude variants depend on the Google account and Google's
  undocumented client allowlist. Catalog refreshes keep them only when account
  discovery reports them.
- 0.3.1: incomplete task notifications followed by whitespace caused quadratic
  regex backtracking; the parser no longer backtracks.
- 0.5.0: new files in new directories failed when the workspace path ran
  through a symlink, such as macOS `/var`. Paths now resolve to their real
  location first (`AntigravityClientFiles.ts`).

**Removed.** In the 0.4.0 sync: the Full-access lock from 0.1.2 (Antigravity now
follows the thread's permission mode), and the four-thread provider command
queue from 0.3.1, which kept a slow sign-in from blocking other threads at
startup.

## Zed

**Now.** Zed runs through a companion bridge, `zed-acp-server`, from
[tvh0021/zed](https://github.com/tvh0021/zed) (`main`, released as
`personal-vX.Y.Z`) and set as the Zed provider's binary path. Desktop updates don't include it. It
uses the existing Zed sign-in. Refresh lists every hosted model on the account
through `--list-models`, labeled by upstream provider, and keeps custom models.
A failed refresh keeps the last list and shows a warning. Answers, tools, child
agents and approvals stream into the thread. Thinking effort uses Zed's native
values. After an app restart, a bridge without session resume support starts
a fresh provider session with saved conversation context. A failed prompt
shows Zed's reason, and running out of credits shows as a usage limit.

**Decisions.**

- 0.7.2 (ZED-RESUME-001): the bridge lacks load and resume support.
  `AcpSessionRuntime` now identifies the unsupported restore method so the
  existing ACP adapter fallback can start a fresh session and carry context
  forward through `ProviderTurnStartService`.
- 0.7.3 (ZED-CREDITS-001): prompt failures showed only "Provider turn failed."
  The bridge sends Zed's error as the text of a generic `-32000`, losing Zed's
  payment-required category, so `zedPromptFailure` passes the text through and
  matches credit wording to classify a usage limit. It sets no reset time, so
  limit recovery doesn't auto-resume Zed threads.
- Before 0.0.42: identical completed tool snapshots are dropped; repeating them
  split answers mid-word and flooded the activity list.
- 0.1.3: web search, child-agent forwarding and streaming tool updates need
  bridge commit `317b394ae4` or later. Child tool IDs stay distinct, and child
  text never replaces the parent answer.
- 0.2.0: effort needs bridge commit `11708bd472` or later. Model switches keep
  only compatible effort values.
- 0.5.1: after the 0.4.0 sync Zed turns failed with `Model not available`. The
  thread's model now reaches the bridge's startup `--model` argument, and the
  model is sent before effort even when the bridge advertises no model setting.
- 0.7.0: `parseZedModels` keeps the bridge's whole hosted catalog instead of
  the newest Sonnet and Luna, which hid every other model on the account.
  Provider labels and the account default need bridge commit `aa2e090c03` or
  later, which also leaves out models Zed has disabled. Older bridges list the
  same models without labels, with the first as default.
- 0.7.0 (ZED-CATALOG-001): failed discovery reported ready, so a restart
  replaced the cached catalog with retired seed models. `checkZedProviderStatus`
  now reports a warning, and `shouldRetainMissingProviderModels` keeps the last
  catalog for an installed Zed provider in that state.
- 0.7.1 (ZED-VERSION-001): `checkZedProviderStatus` showed a hardcoded 0.1.0,
  and the bridge's `initialize` reply hardcoded the same. The probe now runs
  `--version` instead of `--help` and parses its output, so it needs bridge
  0.2.1 or later; older bridges fail the probe.
- Open (ZED-CONTEXT-001): the bridge sends no context usage.

## Delegated tasks

**Now.** Agents delegate through upstream's `delegate_task`. The fork adds two
things:

- **Per-task attempt limits.** A parent may delegate the same task to one
  model family a limited number of times. A family spans generations, aliases,
  and instances (6.1 Sol, 6 Sol, and 5.6 Sol are all `gpt-sol`), so an agent
  can't get around the limit by retrying on an older generation. The limit
  stops a parent from resubmitting a task that is going nowhere; it is not a
  cap on how many tasks a thread delegates. A task is its title, or its prompt
  when untitled, since review rounds resend the title with new findings.
  Finished attempts still count. Provider-native subagents don't count.
  Named defaults and overrides beat price bands: above $10 per million output
  tokens gets one attempt, $1 to $10 gets four, below $1 is unlimited. Unpriced
  models need an override. Settings shows the live policy
  (`apps/server/src/orchestration-v2/delegationGuards.ts`).
- **Review worktrees.** A `reviewRef` is resolved to a commit and passed to
  upstream's `isolation: "worktree"` as its base, so the child reviews that
  commit instead of the parent's current one (`OrchestratorMcpService.ts`).

The policy is checked daily but refetches models and prices only when the month
changes or a refresh is forced from Settings > Providers. Mobile has no editor
for it; the limits are server-wide, so the web or desktop screen covers every
client.

**Decisions.**

- 0.7.3: thread-wide budgets blocked unrelated tasks. `taskAttemptsExceeded` in
  `delegationGuards.ts` counts attempts at the same task; `coordinationModelKey`
  groups generations so retrying on an older model consumes the same limit.

- 0.4.0: upstream's `delegate_task` replaced the fork's orchestration layers;
  the fork kept only its limits and review isolation, as guards on it.
- 0.4.0: clearing limit overrides deep-merged an empty map and kept the old
  values; cleared overrides are now removed.
- 0.6.5: upstream added worktree isolation for delegated tasks, so the fork's
  clone snapshots and their cleanup were dropped in favor of it. The fork's
  remaining change is one revision argument, which keeps weekly syncs small.

**Removed.** In the 0.4.0 sync: orchestration layers, their UI and coordination
state, thread handoff MCP tools, and worker restrictions (0.0.42.2 to 0.1.1).
Threads from old layers import as ordinary threads. In 0.10.0: the mobile
limits editor, which duplicated the web screen for a server-wide setting on a
surface this fork doesn't verify, and quota handoff. Quota handoff let the
usage-limit recovery worker resume a limited thread on a mapped fallback model
whose quota was below a threshold. It was rebuilt on upstream's recovery worker
in 0.4.0 and never exercised live after that, and it patched the recovery
worker on every sync, so usage limits now follow upstream's reset-based retry.

## Desktop and macOS

**Now.** Personal builds are signed with one persistent local identity
(`scripts/lib/personal-mac-signing.ts`). Automatic Keychain reads that would
need a password are skipped (`apps/desktop/src/electron/MacKeychain.ts`).

**Decisions.**

- 0.1.4: macOS tied folder grants to the executable hash, so each update asked
  for Documents access again. A stable signing identity keeps the grants.
- 0.1.4: launch no longer shows Keychain dialogs for old or locked credentials.
  Encryption stays on; explicit cookie imports can still ask.

## Upstream sync

**Decisions.**

- 0.8.0: `AgentSessionScanner` compared resolved session paths with unresolved
  managed roots, so symlinked T3 directories could appear as import candidates.
  Resolve managed roots for each scan and import, including directories created
  after startup.

Run the `blast-radius` skill before merging (see `AGENTS.md`). Then:

- Merge `upstream/main`; don't rebase. Merges keep the fork's history and
  resolve conflicts once.
- After resolving, diff each conflicted file against `upstream/main`. Syncs
  have silently undone upstream work before: the provider badge helpers
  (`providerInstanceDisplay.ts`) and the Runbooks section of `docs/README.md`.
- Fork-only services (`DelegationGuards`, the recovery worker's
  `ProviderRegistry`) are read with `Effect.serviceOption`, so upstream tests
  need no edits. Put new fork dependencies behind the same kind of optional
  seam.
- Upstream lint rules apply to fork code. Run targeted lint on every fork file
  the merge touches, not only the conflicted ones.
- Official rates outrank LiteLLM, so an upstream Usage test that sets a custom
  rate on an officially priced model fails. Change the test's model; don't
  weaken the rule.
