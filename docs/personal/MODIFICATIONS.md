# Current personal fork modifications

Reconciled October 11, 2026 against Personal 0.3.2 source. This is a description
of current behavior, not a runtime certification. [Verification](./VERIFICATION.md)
owns audit results, [issues](./ISSUE_TRACKER.md) own remaining work, and
[the changelog](./CHANGELOG.md) owns release history.

## Branding, typography and markdown

The sidebar uses two lines, `T3 Code` and italic `personal`, with descender
clearance. Single provider instances omit initials badges. ChatLLM uses its
own name and vector icon.

The current client schema defaults are interface 20px, prompt 18px, code 18px,
and terminal 17px. Existing saved preferences override defaults. The earlier
README's message 20px/UI 17px/terminal 18px labels did not match these current
schema fields. See `packages/contracts/src/settings.ts`.

Web/desktop chat uses KaTeX for inline and block math, including tables and
styled wrappers. Plain messages skip math preprocessing/plugins. KaTeX markup
and stylesheet dependencies are aligned at 0.18.7; earlier mismatches produced
vector accents inside base glyphs. Native mobile has a separate markdown renderer.

HTML file links default to the system browser and offer an integrated browser
alternative where available. Their owning environment serves the file, including
files outside the workspace. PDF handling is separate.

## ChatLLM provider

The `abacus` driver uses the configured RouteLLM API and exposes ChatLLM in
clients. Catalog refresh reads available account models manually and periodically,
preserving configured custom models.

Its agent loop streams fragmented tool calls, executes file/directory/command
tools, feeds results back and accumulates usage across every completion step.
Ordinary sessions support `read_file`, `write_file`, `edit_file`,
`list_directory`, and `execute_command`. Writes stay in the workspace. Command
filters reject known destructive forms; commands have cancellation and timeout
handling. A turn runs at most 200 tool calls on models whose id contains
`flash` and 50 on any other model (`abacusMaxTurnSteps`). At the limit the
batch that would exceed it is skipped, so the history has no unanswered calls,
and the turn ends with a visible assistant message naming the limit. Delegated
tasks report that message as their summary. `requestTimeoutMs` (default 600 s)
applies to each RouteLLM request, not the whole turn.

Workflow review workers expose only confined read/list and scoped reporting
tools. Execution rejects forbidden writes and commands even if the provider
requests them. Read containment includes symlink resolution. Parent coordination
tools are forwarded through the HTTP MCP bridge.

## Usage accounting

Usage contract v6 includes Antigravity and ChatLLM. The personal server projects
v5 for mobile 1.2.x/1.3.x, retaining only Claude, Codex and Grok entries that those
clients understand. This restores older-client decoding; it cannot add missing
providers to their Usage tab. Newer mobile releases keep v6 without ChatLLM
entries, which upstream clients reject even inside forward-compatible arrays
(MOBILE-002). Limits is independent. MOBILE-001 records the accepted limitation.

Completed Antigravity/ChatLLM turns write usage JSONL atomically. Transcript
scanning also reads native Antigravity SQLite conversation traces. The original
recovery decoded protobuf fields 9.2 for uncached input, 9.5 for cache reads,
9.3 for output, 9.9 for thinking, and 24.8/gen_metadata for model identity.
Historical counts are dated measurements, not permanent totals.

ChatLLM credits use $0.0005 per credit. Turn usage accumulates all agent-loop
steps; compute-point deltas measure credits with a pricing fallback when needed.
Codex credits use $0.04 each. The usage scan cache (v6) keeps each record's
account balance, so reconciliation orders balance snapshots by timestamp across
duplicate/forked rollouts instead of charging the same balance drop once per
transcript. `codex-auto-review` contributes no paid credits
or USD and does not move the paid baseline. Its original guessed token rate has
been removed from current accounting.

Shared normalization combines known model effort/thinking variants while
preserving intrinsic/custom model distinctions. Gemini Flash tiers combine;
`gemini-pro-agent` maps locally to Gemini 3.1 Pro. Effort-specific overrides
apply before aggregation. Model rows separate subscription throughput from
credit-based usage. Physical transcript sources are deduplicated across
environments using host, provider, path and volume identity. A 20,000-bucket
merge has a 1,000 ms regression budget.

Custom token prices take precedence over provider-reported cost; reported cost
precedes verified reference rates, then public/fallback rates. Reference estimates
use base-context pricing. Dotted Claude and bare Gemini Pro names include local
aliases. Gemini cache-creation fallback uses input rates as an assumption;
cache storage and long-context premiums are excluded. See
`apps/server/src/usage/usagePricing.ts` and the latest pricing evidence.

Speed comes from the provider's reported `usage.speed`, not from the selected
option. Claude Code drops a fast-mode request to standard when the account
cannot serve it, for example with extra usage off. The Claude adapter then adds
one thread notice per Claude process stating the reason (USAGE-004).

USAGE-002 tracks inconsistent Day provider costs versus Total. A passing model
normalization check does not establish that all breakdowns or charts agree.

## Antigravity catalog, permissions and quotas

Managed ACP 1.3.0 with the recognized Zed client identity discovers eligible
Gemini and Claude Opus/Sonnet 5.5 variants. Availability depends on the signed-in
Google account and Google's undocumented recognized-client behavior. Native
model identifiers reach chat and text helpers unchanged. Built-in catalog seeds
cover eligible installed/new sessions until live discovery is available; a live
catalog takes precedence. Unauthenticated/disabled providers do not gain models
merely because a budget policy names them.

The September Gemini-only ACP restriction is historical. Personal 0.3.0 added
Claude support. Quota probing and usage scanning are upstream's: Claude and GPT
share one "Claude & GPT (shared)" bucket, and historical Antigravity tokens
come from upstream's SQLite scanner. The fork only keeps its shortest-window-first
sort and asks both Google quota endpoints, merging their windows, because the
daily endpoint can omit the Gemini group (AG-QUOTA-001). ChatLLM still writes
live turn usage.

Antigravity uses Full access at new-session/resume boundaries. Web/desktop/mobile
selectors expose that effective mode while retaining the saved thread/draft
preference for a later provider switch. Existing turns continue. Provider policy
compares effective modes, avoiding redundant restarts.

Native task notifications produce work-trace results without finishing the prompt.
Ordinary, quoted, incomplete and foreign-session content remains chat text.
Incomplete whitespace-heavy notifications no longer trigger quadratic backtracking.
ACP request errors retain operation names and bounded, sanitized native text
including timeout/cancellation detail.

Provider commands can run in four thread queues concurrently, preserving order
within each thread and existing workspace leases. This removes global startup
serialization. It does not repair the native runtime's network-specific IPv6
onboarding failure. WORKFLOW-003 retains that diagnosis and missing recovery checks.

## Zed ACP integration

The separately configured companion bridge provides headless Zed ACP sessions.
T3 discovers one newest hosted Sonnet and one newest Luna through `--list-models`
on manual/periodic refresh, preserves custom models and retains the last successful
catalog when a probe is pending or fails, including after restart. Original seed
models are a fallback, not a reason to overwrite cached discovery.

The bridge authenticates with existing Zed sign-in, waits for model readiness,
and streams answers, tools, approvals, elicitation and context-token usage.
Repeated identical completed tool snapshots are suppressed. Native context
counts and capacity drive the composer meter; session billing is separate.

Native web-search initialization, child/nested-child subscriptions, pending
approval forwarding and answer routing require companion commit `317b394ae4`
or later. Tool titles, inputs, output, content and locations stay current as
calls stream. Child tool IDs remain distinct and child text does not replace
the parent answer. Prompt errors return ACP errors.

Thinking-effort descriptors and defaults require companion commit `11708bd472`
or later. T3 applies compatible selected effort before prompts and reapplies
stored choices to replacement sessions. Model changes discard unsupported values.
This is not a claim of native conversation-history resumption.

Zed account spend remains unavailable because native credentials cannot read
the dashboard's billing routes. ACP cumulative session cost cannot substitute
for account billing. Limits explicitly links the dashboard without showing a
zeroed or invented account bar. ZED-001 owns billing access; earlier approval,
streaming and effort verification remains dated evidence.

## Delegated tasks

Since the October 2026 upstream sync, agents delegate through upstream's
`delegate_task` MCP tool. The fork's orchestration-layer tools, layer UI and
coordination state are gone. Child threads created by earlier layers import as
ordinary threads without parent links.

The fork adds two guards to `delegate_task` (`orchestration-v2/delegationGuards.ts`):

- **Per-model turn budgets.** Each parent may start a limited number of
  app-owned children per canonical model, across aliases and provider
  instances. The count never resets, so a parent cannot regain budget by waiting
  for children to finish. Provider-native subagents are not counted. Named
  defaults and overrides take precedence over price bands: above $10 per million
  output tokens gets one turn, below $1 is unlimited, and $1 through $10 gets
  four. Unpriced models need overrides. Settings shows the live policy, so don't
  copy the table here.
- **Review snapshots.** A `reviewRef` gives the child a detached local clone of
  that commit instead of the parent's live worktree. StorageCleanup removes
  orphaned snapshots.

The coordination policy refreshes models and prices daily and on demand from
Settings > Providers. Mobile uses Settings > Maintenance.

## Quota handoff

Quota handoff is built on upstream's usage-limit recovery. When a thread hits a
usage limit and auto-resume is on, the recovery worker looks up the thread's
model in the environment's ordered fallback map. It skips the limited source
instance and picks the first mapped model whose provider is ready and whose
quota windows are fresh and below the threshold (95% by default). If none
qualifies, it refreshes the candidates' quota once. A qualifying fallback
resumes the thread on that model; otherwise upstream's reset-based retry
applies unchanged.

Earlier live evidence of Codex-to-Gemini child handoffs predates this design
and does not verify it.

## Desktop startup and macOS access

Personal builds retain a local signing identity so an executable hash change alone
does not discard macOS folder grants. Automatic inaccessible Keychain reads avoid
launch password dialogs while encryption remains enabled; explicit cookie imports
may request approval.

The backend manager retries readiness while the process remains alive. Current
normal/delayed startup evidence is recorded in DESKTOP-001, whose original
slow project auto-pull incident remains unexplained. PERMISSION-001 separately
tracks orchestration reaching unrelated protected folders.
