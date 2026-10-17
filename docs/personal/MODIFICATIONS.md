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

- Before 0.0.42: usage accumulates across every step of the loop, not just the
  last completion.
- 0.6.1 (CHATLLM-STEPS-001): the old 20-call cap ended delegated runs with a
  silent `completed`. The cap now depends on the model, the batch that would
  exceed it is skipped so history has no unanswered calls, and the turn ends
  with a visible message that delegated tasks report as their summary.
- 0.6.4 (CHATLLM-WRITE-001): writes compared path text, so a symlink
  inside the project could redirect them outside it. They now check the real
  path (`resolveWorkspaceWritePath`). `execute_command` can still write
  anywhere, so this is not a sandbox.

**Removed.** In the 0.4.0 sync: parent access to T3 coordination tools over the
HTTP MCP bridge, and the read-only tool set for review workers. Delegated
reviews now run in their own worktree instead (see Delegated tasks).

## Usage

**Now.** Usage prices every provider's tokens at API-equivalent rates. Codex
credits cost $0.04 and ChatLLM credits $0.0005 (`packages/contracts/src/usage.ts`).
Effort and thinking variants of a model share one row. Credit-based usage is
shown separately from subscription usage. The period picker includes All time
(`Cmd/Ctrl+Shift+5`) and remembers the last period. ChatLLM writes per-turn
usage logs; every other provider is read from its native transcripts or
database.

**Decisions.**

- Before 0.0.42 (MOBILE-001): App Store 1.2.x and 1.3.x reject Usage contract
  v6, so the host sends them v5 with only Claude, Codex and Grok.
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
- A 20,000-bucket merge has a 1,000 ms test budget (`usageMerge.test.ts`).

**Removed.** In the 0.4.0 sync, the fork's Antigravity per-turn logs and its
protobuf trace decoder gave way to upstream's SQLite scanner.

## Limits

**Now.** Limits shows reset countdowns for Antigravity, ChatLLM and Zed besides
upstream's providers. Antigravity has a Gemini pool and a shared "Claude & GPT"
pool, shortest window first. ChatLLM shows monthly compute points. Zed shows
`$X of $Y spent`, or `$X spent, no limit`.

**Decisions.**

- 0.4.0: the fork adopted upstream's Antigravity quota probe and its shared
  Claude & GPT bucket instead of keeping its own converter.
- 0.6.2 (AG-QUOTA-001): Google's daily endpoint can leave out the Gemini group,
  so the probe asks both endpoints and merges their windows.
- 0.5.0 (ZED-001): Zed's own credential can't read billing, so spend comes from
  `cloud.zed.dev` with a dashboard sign-in. Desktop signs in with **Connect** in
  Zed provider settings; other clients paste the dashboard Cookie header. The
  session lives in the host's secret store. Spend is read at provider start and
  after each Zed turn, never on a timer. A missing or expired session shows a
  notice, not an empty bar. Only personal billing is read.

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

**Now.** Zed runs through a companion bridge, `zed-acp-server`, built from the
`integration/zed-abacus` branch of [tvh0021/zed](https://github.com/tvh0021/zed)
and set as the Zed provider's binary path. Desktop updates don't include it. It
uses the existing Zed sign-in. Refresh discovers the newest hosted Sonnet and
Luna through `--list-models` and keeps custom models. Answers, tools, child
agents and approvals stream into the thread. Thinking effort uses Zed's native
values.

**Decisions.**

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
- Open (ZED-CATALOG-001, ZED-CONTEXT-001): a restart after failed discovery
  restores retired models, and the bridge sends no context usage.

## Delegated tasks

**Now.** Agents delegate through upstream's `delegate_task`. The fork adds two
things:

- **Per-model budgets.** A parent may start a limited number of children per
  model across aliases and instances. The count never resets, so waiting for
  children doesn't restore budget. Provider-native subagents don't count.
  Named defaults and overrides beat price bands: above $10 per million output
  tokens gets one turn, $1 to $10 gets four, below $1 is unlimited. Unpriced
  models need an override. Settings shows the live policy
  (`apps/server/src/orchestration-v2/delegationGuards.ts`).
- **Review worktrees.** A `reviewRef` is resolved to a commit and passed to
  upstream's `isolation: "worktree"` as its base, so the child reviews that
  commit instead of the parent's current one (`OrchestratorMcpService.ts`).

The policy is checked daily but refetches models and prices only when the month
changes or a refresh is forced from Settings > Providers (mobile: Settings >
Maintenance).

**Decisions.**

- 0.4.0: upstream's `delegate_task` replaced the fork's orchestration layers;
  the fork kept only its budgets and review isolation, as guards on it.
- 0.4.0: clearing limit overrides deep-merged an empty map and kept the old
  values; cleared overrides are now removed.
- 0.6.5: upstream added worktree isolation for delegated tasks, so the fork's
  clone snapshots and their cleanup were dropped in favor of it. The fork's
  remaining change is one revision argument, which keeps weekly syncs small.

**Removed.** In the 0.4.0 sync: orchestration layers, their UI and coordination
state, thread handoff MCP tools, and worker restrictions (0.0.42.2 to 0.1.1).
Threads from old layers import as ordinary threads.

## Quota handoff

**Now.** Built on upstream's usage-limit recovery. When a thread hits a usage
limit, auto-resume is on and the environment has a fallback map, the recovery
worker skips the limited instance and picks the first mapped model whose
provider is ready and whose quota is fresh and below the threshold (95% by
default). If none qualifies it refreshes quota once; otherwise upstream's
reset-based retry applies.

**Decisions.**

- 0.4.0: rebuilt on upstream's recovery worker instead of the fork's layer
  reactor, which the sync removed. Live fallback has not been exercised since.

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
