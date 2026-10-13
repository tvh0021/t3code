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
handling. A turn has a bounded tool loop.

Workflow review workers expose only confined read/list and scoped reporting
tools. Execution rejects forbidden writes and commands even if the provider
requests them. Read containment includes symlink resolution. Parent coordination
tools are forwarded through the HTTP MCP bridge.

## Usage accounting

Usage contract v6 includes Antigravity and ChatLLM. The personal server projects
v5 for mobile 1.2.x/1.3.x, retaining only Claude, Codex and Grok entries that those
clients understand. This restores older-client decoding; it cannot add missing
providers to their Usage tab. Limits is independent. MOBILE-001 records the
accepted limitation.

Completed Antigravity/ChatLLM turns write usage JSONL atomically. Transcript
scanning also reads native Antigravity SQLite conversation traces. The original
recovery decoded protobuf fields 9.2 for uncached input, 9.5 for cache reads,
9.3 for output, 9.9 for thinking, and 24.8/gen_metadata for model identity.
Historical counts are dated measurements, not permanent totals.

ChatLLM credits use $0.0005 per credit. Turn usage accumulates all agent-loop
steps; compute-point deltas measure credits with a pricing fallback when needed.
Codex credits use $0.04 each. Scan-cache v5 reconciles account balance snapshots
in timestamp order across duplicate/forked rollouts instead of charging the same
balance drop once per transcript. `codex-auto-review` contributes no paid credits
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
Claude support. Quota code still filters Claude/GPT groups and `3p` buckets;
that earlier policy is now tracked as AG-QUOTA-001 rather than justified by an
obsolete claim that Claude cannot run. Session/Weekly windows are sorted by
duration. Real quota-pool mapping needs an account-backed check.

Antigravity uses Full access at new-session/resume boundaries. Web/desktop/mobile
selectors expose that effective mode while retaining the saved thread/draft
preference for a later provider switch. Existing turns continue. Provider policy
compares effective modes, avoiding redundant restarts. GPT review/edit children
inherit their parent's saved mode. Coordination still distinguishes GPT model names
from other models when selecting review permissions; that decision has not moved
entirely to the provider boundary.

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

## Agent-created threads and T3 orchestration layers

Included in installed releases through Personal 0.3.2. Current verification
limits are recorded separately, rather than inferred from installation.

Thread MCP tools expose model listing, creation, reading, messaging and interruption.
Selections can cross models/providers; omitted selections inherit model/options.
Handoffs start with fresh history, so assignments must carry needed context.

Layers expose `start_orchestration_layer`, `spawn_child`, `assign_child`,
`report_to_parent`, `wait_for_children`, `read_orchestration_layer`,
`control_orchestration_layer` and `refresh_coordination_policy`.
Four children run concurrently and overflow persists. Initial assignments wait
for the planning turn to end. Reports persist while the parent is busy and wake
an idle parent subject to budgets and pending human requests. `wait_for_children`
records intent to end the turn; later coordination calls in that turn are rejected.

Pause blocks starts; resume preserves counters. Complete retains late reports
without waking the parent. Cancel interrupts owned children and queued work.
Manual parent activity pauses coordination. Restart recovery pauses uncertain
work rather than replaying paid turns. Active members cannot be archived and
active children cannot be deleted; parent deletion cancels its layer first.
Turn correlation, receipt ordering and persisted reconciliation handle early
completion and stale/disconnected sessions.

Reviews use detached snapshots of resolved Git commits. Editing children require
separate existing registered worktrees for parent integration. Read-only execution
is not a general restriction on reading every host path. Provider-native subagents
are allowed; children cannot create nested T3 layers or reset budgets by creating
T3 threads. Migration 054 persists coordination; shell snapshots omit full assignment
and report bodies, which remain in thread detail.

### Model budgets and maintenance

One round is one automatic provider turn start. Initial user planning is excluded.
Canonical model counters are shared across parent wakeups, child assignments,
aliases and provider instances. Named defaults and overrides precede price bands.
Above $10 per million output tokens gets one turn, below $1 is unlimited, and
$1 through $10 gets four. Unpriced models need overrides. The live policy is
shown in Settings; avoid maintaining a second model-budget table here.

Monthly maintenance refreshes available models/pricing for future layers while
active layers retain captured budgets/counters. Failed refreshes preserve prior
cache. Unlimited does not imply free usage or absence of provider quotas.
Web/desktop uses Settings > Providers; mobile uses Settings > Maintenance.

### Provider enforcement

Codex/Claude have native worker restrictions; ChatLLM uses execution/read
containment. Zed requires worker/thread metadata support, forwards scoped HTTP
MCP tools and fails closed with old companion binaries. Antigravity can parent
or join a layer. Cursor, Grok and OpenCode remain excluded from strict roles
until support is established. Ordinary handoffs remain separate.

WORKFLOW-001/002 own missing client/native-provider and complete Gemini-parent
checks. A Gemini child quota handoff and a Zed review child previously passed;
neither proves a complete native parent cycle on the current release.

## Quota handoff

Opted-in layers use an environment threshold, default 95%, and ordered model
fallbacks. A qualifying target needs ready/authenticated status, fresh quota
below threshold, role support and remaining budget. Automatic routing switches
providers at most once. Without a fallback, a known reset permits a fresh source
reading before continuation. Unknown quota/reset pauses work with a reason;
manual activity cancels pending routing.

Linked handoff threads receive partial history and a summary before continuation.
Simulated probes corrected lost effort options and stale reset details. Historical
live Codex-to-Gemini child handoff evidence is in the changelog/handoff; actual
quota exhaustion/reset and current complete parent cycles remain separate checks.

## Desktop startup and macOS access

Personal builds retain a local signing identity so an executable hash change alone
does not discard macOS folder grants. Automatic inaccessible Keychain reads avoid
launch password dialogs while encryption remains enabled; explicit cookie imports
may request approval.

The backend manager retries readiness while the process remains alive. Current
normal/delayed startup evidence is recorded in DESKTOP-001, whose original
slow project auto-pull incident remains unexplained. PERMISSION-001 separately
tracks orchestration reaching unrelated protected folders.
