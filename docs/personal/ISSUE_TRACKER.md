# Issue tracker

Updated October 12, 2026.

Latest audit and per-item verdicts: [VERIFICATION.md](./VERIFICATION.md).
This tracker owns open defects and verification work; dated release history
lives in [CHANGELOG.md](./CHANGELOG.md).

## Accepted mobile limitation

### MOBILE-001: App Store 1.3.0 Usage omits Antigravity and ChatLLM

Status: Accepted September 24, 2026.

The App Store 1.3.0 Usage client decodes contract v5 and recognizes Claude,
Codex, and Grok. The personal host's v6 response includes Antigravity and
ChatLLM, which makes that older client report Usage unavailable. The host now
projects v5 for mobile 1.2.x and 1.3.x connections, retaining only providers
those clients can represent. A historical mobile schema decode accepted the
projected response, and the user confirmed Codex usage billing works on the
phone.

Antigravity and ChatLLM usage cannot appear in this app version's Usage view
without a mobile update. Their Limits view remains independent of this Usage
response. No provider is relabeled to make those totals appear under another
name.

## Resolved usage issues

### USAGE-001: Effort variants split model rows and miss pricing

Status: Fixed and verified in Personal 0.3.2 on October 11, 2026.

Claude Sonnet 5.5 Low and Medium and Opus 5.5 Medium appeared as separate,
unpriced rows. Shared normalization now combines effort variants on every
client. The server uses verified official API rates for the affected models.
Antigravity's `gemini-pro-agent` maps to Gemini 3.1 Pro instead of Gemini 2.5 Pro.
Exact effort overrides are priced before aggregation, and custom base prices
apply to other effort levels. The 85 focused regressions and scoped checks pass.
The installed candidate shows one priced Sonnet row with 193K tokens, one Opus
row with 3.96M tokens, and Gemini 3.1 Pro in place of the old alias. Usage refresh
and Model/Day switching pass. Native mobile and remote runtime verification
remain untested.

## Open issues

### USAGE-002: Day provider costs do not add to Total

Status: Open. Reproduced October 11, 2026 in an isolated copy of installed
Personal 0.3.2 and through the public shared usage merge.

Open Usage > Tokens > Day with mixed subscription and credit-backed Codex
history. October 11 shows Codex `$5.78`, Antigravity `$0.00`, and Total `$5.43`.
October 7 shows `$11.02` and `$2.15`, with Total `$11.64`. Refreshing retains
the mismatch. These differences exceed rounding.

`mergeUsage` excludes credit buckets from `day.costUsd` and `hour.costUsd`, but
adds their API-equivalent cost to `byProvider.costUsd`. The Day UI renders those
incompatible totals together. A controlled public-interface probe with a $1
subscription bucket and a 25-credit bucket carrying $3 API-equivalent cost
returns Codex $4 and Total $1. The credit-model row correctly values 25 credits
at $1; that is a separate calculation.

Acceptance: provider columns, total, and charts must use the same stated cost
basis, or separate subscription and credit values explicitly. Cover mixed and
subscription-only days and hours. Verify web/desktop and shared mobile consumers.
This is separate from resolved effort normalization in USAGE-001.

Evidence: [Day screenshot](/private/tmp/t3-changelog-audit-20261011/usage-day.png),
[accessibility output](/private/tmp/t3-changelog-audit-20261011/usage-day.txt), and
[controlled observations](/private/tmp/t3-changelog-audit-20261011/quality-probes.json).

### AG-QUOTA-001: Usable Claude models still lose their quota windows

Status: Open source-confirmed gap. Controlled converter diagnostic recorded
October 11, 2026; the current live Claude quota response remains unexamined.

Personal 0.3.0 enabled account-discovered Claude models through Antigravity.
`antigravityQuotaSummaryToLimits` still discards every group whose name contains
Claude/GPT and every `3p` bucket. Its comment assumes only Gemini can run.
The test suite still requires this exclusion.

With Gemini at 10% used and a Claude bucket at 99% used, the converter returns
only the Gemini window. This proves the supplied Claude reading is lost, not
that a real Claude turn or quota handoff failed during this pass. The initial isolated
app had no provisioned Antigravity runtime/profile. The October 12 continuation
provisioned an isolated managed profile, completed native Gemini and Sonnet turns,
and observed live Gemini quota updates. It did not establish Claude pool mapping.

Acceptance: inspect the current account response and establish which supported
models share each quota pool. Represent supported Claude quota without assigning
unsupported GPT models or Gemini quotas to it. Check Limits and orchestration
threshold decisions against both pools. Update the obsolete Gemini-only comment
and regression expectation when that policy is settled.

Evidence: [controlled observations](/private/tmp/t3-changelog-audit-20261011/quality-probes.json),
`apps/server/src/provider/Layers/antigravityUsageLimits.ts`, and its focused test.

### QUALITY-001: Abacus driver-list regression still omits Zed

Status: Fixed in working tree, October 11, 2026. Both focused driver tests pass.

`AbacusDriver.test.ts` expects seven built-in drivers. The actual registry also
contains Zed, so `registers Abacus without replacing the existing built-in drivers`
fails. The configured Abacus text-session test passes. This is a stale quality
gate, not evidence that ChatLLM cannot execute a turn.

Acceptance: update the registration expectation to reflect the intended registry
without weakening its check that existing providers remain available. Rerun the
focused driver test. The continuation added Zed to the exact registry expectation;
both focused tests passed.

Evidence: [initial provider test log](/private/tmp/t3-changelog-audit-20261011/provider-tests.log)
and [passing driver tests](/private/tmp/t3-runtime-continuation-20261011/abacus-tests.log).

### ACP-REVIEW-001: Read-only Antigravity reviews could write through client filesystem RPC

Status: Fixed in working tree, October 12, 2026. Not installed or released.

Five controlled review children successfully wrote inside their disposable review
clones through native `fs/write_text_file`. The adapter now rejects filesystem
writes when the coordination role is review. Reads still work; editing and
ordinary sessions retain writes. This closes the reproduced filesystem bypass,
not every native command/tool restriction across providers.

Verification: the regression failed before the fix; all 42 adapter tests pass.
The real mixed workflow rejects four review writes, allows one editing write,
auto-allows 15 scoped MCP permissions and requires explicit client responses for
five unrelated native tools. Server typecheck and scoped lint pass.

Evidence: [continuation report](/private/tmp/t3-workable-verify-20261011/REPORT.md)
and [mixed workflow results](/private/tmp/t3-mixed-workflow-20261012/results.json).

### DOC-PERMISSIONS-001: The historical model-name override removal claim is inaccurate

Status: Current guide corrected, October 12, 2026. Historical audit item 056 is FAIL.

The public contracts helper still chooses different review modes for GPT and
Claude with the same Zed driver and Full access parent. Existing tests explicitly
require that behavior. `MODIFICATIONS.md` now describes it accurately. No
permission semantics were changed to satisfy the historical changelog wording.

Evidence: [public-interface observations](/private/tmp/t3-workable-verify-20261011/permissions-results.json).

### ZED-CONTEXT-001: Native Zed token usage never reaches T3

Status: Open. Reproduced October 12, 2026 with authenticated native Luna turns.

Native Zed session storage contains nonzero input and output token counts,
but the captured ACP stream contains no `usage_update` notifications. The T3
adapter handles that notification when supplied, but receives none. This fails
both row 032 and the usage portion of row 027. Native approvals do pass.

Acceptance: emit current context use and capacity from the native bridge, verify
updates through T3's real subscription and context meter, and preserve intact
streaming. Check new and resumed sessions.

### ZED-CATALOG-001: Failed discovery after restart restores retired seed models

Status: Open. Reproduced twice October 12, 2026 in isolated source servers.

Authenticated refresh persists Sonnet 5.5 and GPT-6 Luna. Restart with unchanged
settings and deliberately failed native discovery returns Sonnet 5 and GPT-5.6
Luna instead. The custom model remains. Same-process refresh failure retains
the current inventory. A discovery failure reports ready/authenticated, which
prevents the registry's failed-probe retention branch from applying.

Acceptance: retain the last discovered built-ins during pending and failed
startup discovery, preserve current custom settings, and replace retired models
only after successful discovery. Verify an actual restart with disk cache.

### CHATLLM-USAGE-001: First turn logs an estimate instead of its measured charge

Status: Open. Reproduced October 12, 2026 with controlled account responses
through the real ChatLLM driver and usage endpoints. No live charge induced.

The account counter increases by 40 credits on each of two turns. The first
turn logs 3.36 estimated credits, the second logs 40. Usage reports 43.36 credits
and $0.02168 instead of 80 credits and $0.04. The first post-turn account reading
establishes a baseline after the first charge, so that charge uses a token estimate.
The second measured delta and $0.0005-per-credit conversion are correct.

Acceptance: establish a valid baseline before the first charged turn or mark
estimates explicitly. Keep account baselines isolated per instance and avoid
attributing concurrent external spending to one turn. Verify the initial turn,
a later turn, unavailable account readings and multiple configured instances.

Evidence for these three defects: [native-provider report](/private/tmp/t3-verification-to30-20261012/REPORT.md)
and [filtered observations](/private/tmp/t3-verification-to30-20261012/evidence-summary.json).

### AG-TURN-001: Native Antigravity turns do not write T3 per-turn usage logs

Status: Open. Native managed Gemini and Sonnet runs confirmed October 12, 2026.

Two completed native turns have nonzero generation counters in their provider
conversation databases. The public usage scan recovers one priced generation
for each, but `usage/antigravity/sessions` does not exist in the isolated T3
state. The adapter's per-turn writer requires usage in the ACP prompt response;
the managed runtime's exercised responses do not provide it. The combined
Antigravity/ChatLLM atomic logging claim fails for the Antigravity path.

Historical database ingestion still recovers totals. This finding concerns the
T3 turn-correlated log, not a loss of all usage accounting. ChatLLM's two-turn
JSONL logging is separately verified.

Acceptance: establish a measured native-runtime usage source for each T3 turn
and persist it once with the T3 turn identity. Cover tool-loop generations,
resume, cancellation and deduplication against native database ingestion. Do not
substitute prompt-length estimates for measured token counts.

Evidence: [continuation report](/private/tmp/t3-blocked-continuation-20261012/REPORT.md)
and [native usage summary](/private/tmp/t3-antigravity-native-20261012/summary.json).

### QUOTA-RESET-001: Automatic quota interrupt cancels reset continuation

Status: Open. Reproduced twice October 12, 2026 through real source servers,
the ChatLLM driver and controlled account responses. No live quota exhaustion.

An opt-in parent at 96% enters `waiting-reset` when no eligible fallback is
available. The `quota:wait:<id>:interrupt` command then pauses the parent and
changes its quota status to `paused`, with `Canceled by user activity.` The
client sent no user interrupt. The reactor only checks reset continuation for
`waiting-reset`, so its own interrupt removes the state it needs to resume.

The controlled fallback instances report authentication as unknown, so their
ineligibility is expected. This finding concerns the no-fallback reset path,
not ordered switching. Both original probe scripts waited on coordination
events absent from the thread detail stream and timed out. The persisted
command/event chain independently establishes the defect; the fixture timeout
is not the product failure.

Acceptance: distinguish automatic quota interrupts from user interrupts,
preserve reset-wait state, and verify continuation after a controlled reset.
Keep manual interruption able to cancel the pending action.

Evidence: [runtime event checker](/private/tmp/t3-zero-quota-20261012/check-defect.py)
and [two-run command chains](/private/tmp/t3-zero-20261012/quota-defect.json).

### CHATLLM-WRITE-001: Worker file tools follow links outside the workspace

Status: Open. Observed October 12, 2026 through a real source server and
ChatLLM driver with controlled model responses. All paths were disposable
fixtures under `/private/tmp`; no external account was charged.

An edit worker's `write_file` rejects a direct path outside its assigned
worktree. A symlink inside that worktree points to the same outside fixture.
`write_file` and `edit_file` follow the link, return success and change the
outside contents to `ESCAPED_EDIT`. The file tools check the lexical resolved
path rather than the filesystem destination.

Acceptance: keep successful writes inside the assigned worktree, including
existing file links and linked parent directories. Preserve ordinary in-worktree
write/edit behavior and the stricter review-worker policy.

Evidence: [captured runtime tool results](/private/tmp/t3-zero-chatllm-worker-v3-20261012/defect.json).
The fixture waited for a coordination receipt on the wrong stream after the
worker finished. That timeout is not a product failure. No rerun is needed to
establish the captured file change.

### VERIFY-001: Complete current runtime coverage before calling the app fully tested

Status: Open. The October 11 changelog audit covers every recorded bullet.
The latest October 12 continuation leaves 2 BLOCKED claims, with 51 PASS,
11 FAIL and 29 Historical / not applicable. Rows 004, 043 and 064 closed after
first-party mark acceptance, native/provider worker restriction checks and
compiled native child attachment regressions. Row 055 still needs desktop
Antigravity switching, running-turn and restart evidence. Row 084 still needs a
cross-environment client click; local HTML and desktop PDF now pass.
See the [latest evidence and fixture incident report](/Users/tvh0021/.codex/visualizations/2026/10/12/01a12fe1-c2ad-74e3-b4db-4af8277cf571/five-blockers/REPORT.md).
Mobile verification is excluded by the developer. Follow the
[repository restriction](../../AGENTS.md#verifying); mobile-only audit rows are
outside scope, not passing. The iOS runtime download was canceled before any
client build or launch. CocoaPods installation had already completed.

Use the per-item matrix in [VERIFICATION.md](./VERIFICATION.md) as the acceptance
list. It identifies the missing providers, UI specimens, signing conditions,
historical corpora, mobile clients and remote connection modes. Historical
verification-only records are Historical / not applicable, not new runtime passes. Existing workflow,
permission, startup and billing issues below retain their own acceptance criteria.

The developer resumed after the earlier usage stop. Remaining blocked IDs are
055 and 084. Native desktop automation returned inconsistent state and activated
an unintended Claude update attempt, which the disposable app's shutdown
interrupted. No completed update is recorded. Normal Keychain-free launch remains
accepted; the adverse-Keychain experiment is excluded and must not be repeated.

Acceptance: resolve or explicitly accept every remaining runtime gap, run the
relevant real interfaces and adjacent cases, and record the tested revisions and
date. Until then, there is no evidenced last full-app test date.

### DESKTOP-001: Slow backend startup exceeds the window readiness timeout

Status: Open. Current timeout recovery verified October 11, 2026; the original
Personal 0.1.3 startup failure remains unexplained.

The desktop readiness probe timed out after 60 seconds. Server startup spent
about 60 seconds in coordination-reactor startup and another 60 seconds in
project auto-pull, becoming ready after about 120 seconds. The server eventually
responded as 0.1.3, but the desktop window remained unavailable until the user
reopened the app. The subsequent installed Zed test passed.

Verify cold launch with retained projects and workflows. A slow background task
should not leave the app without a usable window after the backend becomes ready.

`DesktopBackendManager` retries readiness while the backend remains alive.
Its regression covers two expired readiness budgets before a successful probe.
Project auto-pull still runs before server command readiness.

October 11 runtime check: an isolated copy of installed Personal 0.3.1,
commit `de86571090cf`, retained a snapshot of 12 projects, 306 threads, and
workflow history. Normal cold startup became ready in about 4.1 seconds and
opened its window automatically. Pausing only the newly spawned backend for
70 seconds triggered the 60-second readiness timeout. After resumption, the
window opened automatically about 74 seconds after launch, without reopening
the app. A retained thread's reply and permission mode survived the restart.

Workspace paths were remapped to a disposable repository, so this check did
not reproduce the original project auto-pull workload or establish why the
0.1.3 launch required reopening. Keep this issue open for that investigation.
The backend-manager and Zed ACP support suites passed all 28 focused tests.
Local evidence is in the [verification report](/private/tmp/t3-verify-desktop-zed-20261011/REPORT.md).

### PERMISSION-001: Orchestration triggers unrelated macOS folder prompts

Status: Open. Observed September 28, 2026.

While a T3 orchestration layer runs, macOS repeatedly asks for access to
Downloads, Documents, Desktop, and Apple Music. The agent should already have
access to the folders explicitly granted for the task. These unrelated prompts
interrupt orchestration.

Find which process makes each request and why it reaches folders outside the
task's configured access. Starting orchestration should not trigger requests for
unrelated locations.

#### Acceptance criteria

- Starting or running orchestration does not prompt for access to unrelated
  folders such as Downloads, Documents, Desktop, or Apple Music.
- Parent and child agents can access the folders explicitly granted for the
  task.
- A prompt for another protected location appears only when a task operation
  actually needs that location.

### WORKFLOW-001: Finish client and native-provider verification

Status: Isolated desktop workflow verified; mobile and remote flows pending.

Completed: 219 backend tests, six client tests, live Sol/Luna workflow,
real MCP HTTP transport, scoped lint, and server/mobile/contracts/client-runtime
typechecks. Receipt ordering, restart recovery, disconnect cleanup, fixed review
revisions, child-history isolation, and parent session restart have regressions.
GPT 6 Sol at low reasoning reviewed the latest changes.
An ordinary Sol desktop thread and a four-child Sol workflow ran in an isolated
desktop app. Two Luna and two Gemini children returned findings; the parent
used all four and the fixture passed 10/10 tests. A child-start command ID fix
and completed report-label fix passed 13 focused coordination tests.

Remaining: mobile interactions, command-palette actions,
remote and multiple-environment flows, and native Zed parent MCP discovery and tool use with a
compatible companion binary. The historical HAST errors were fixed in Personal
0.3.1; the October 11 audit reran web typechecking successfully.

The desktop pass used Computer Use against `vp run dev:desktop`. See
[the historical handoff](./SESSION_HANDOFF.md) for evidence and
[the verification matrix](./VERIFICATION.md) for current coverage.

### WORKFLOW-002: Enable strict Antigravity workflows

Status: Parent startup verified with the managed Antigravity runtime. A full
Gemini parent and child report cycle remains unverified. The September 28
quota-handoff evidence proves a Gemini child report and parent resumption,
not a complete Gemini-parent assignment cycle.

The managed Antigravity ACP runtime received T3 MCP tools in an isolated dev
thread. Gemini 3.8 Flash High called `read_thread` and then
`start_orchestration_layer`; the latter persisted an active parent with quota
handoff enabled. The provider policy now allows Antigravity as either role.
The server still rejects attempts by any child to start another layer or create
T3 threads. Cursor, Grok, and OpenCode remain unavailable as strict workflow
children and parents.

Focused tests cover the role gate and nested-thread rejection. A live Sol parent
assigned substantive work to two Gemini children and received their reports.
An attempted nested spawn stopped at Codex provider approval before reaching
T3; the server guard passed a focused MCP toolkit test. The policy, MCP
coordination, and Luna-to-Gemini parent routing tests passed 13 focused cases
after the Antigravity parent change. The server typecheck passed.

Remaining: run a Gemini parent through child assignment, report, and parent
wake. Confirm quota-triggered parent handoff to Gemini with a real provider
turn. Older or custom Antigravity binaries have not been checked for MCP tool
forwarding.

ChatLLM now forwards parent coordination tools; its tool loop and the real MCP
HTTP protocol are tested. Zed forwards the scoped server and restricts worker
MCP tools explicitly. Compilation passed; actual native discovery remains in
WORKFLOW-001. Model-limit entries alone do not make a model available.

### WORKFLOW-003: Gemini onboarding fails on the eduroam IPv6 path

Status: Network-specific failure observed October 6 in installed Personal 0.1.5.
A standalone full-adapter Gemini turn passed October 8 on the working network.
Current orchestration recovery and concurrency remain unverified.

#### Observed failure

A Codex Sol parent assigned six Gemini Flash Medium review tasks with four
child slots. All six children failed during ACP authentication before
`session/new` or task execution. A standalone Gemini High thread failed at the
same step, establishing that orchestration is not required for the failure.
No substantive research result was produced.

Parent thread: `8627c083-1d92-47ce-bc0e-b363ffd03e83`,
`Streamline Apartment Search Document`. Standalone thread:
`1bb25504-c290-424a-8c79-950f3f64623a`, `Workspace Project Inventory`.

| Child                                  | Authentication started, October 6 EDT | Failed, EDT |
| -------------------------------------- | ------------------------------------- | ----------- |
| `e6de8648-babf-4938-85db-e6e292451bcf` | 5:57:19 PM                            | 5:58:34 PM  |
| `6b5ce4e8-738e-4d7e-8ff7-8c0d3ab00d30` | 5:58:36 PM                            | 5:59:51 PM  |
| `5033ad5e-d0a0-49d0-b4fe-f1e5b1d11e3f` | 5:59:53 PM                            | 6:01:08 PM  |
| `0ee0c485-37c0-4634-baa4-ef298f0fbc90` | 6:01:10 PM                            | 6:02:25 PM  |
| `eea72a7a-a7c2-400a-bcf1-395d8eff8f01` | 6:02:27 PM                            | 6:03:42 PM  |
| `d1d3a5bc-df09-40e9-837c-1b7fe33dffe8` | 6:03:44 PM                            | 6:05:00 PM  |

The standalone attempt ran from 6:05:02 to 6:06:17 PM. Persisted models pointed
to the requested Antigravity models. The cached `ready/authenticated` snapshot
was not evidence that new authentication worked.

#### Diagnosis and release boundary

Isolated authentication-only probes of managed `agy_acp_server_1.1.1`, using
temporary profile copies and no model prompts, reproduced timeouts in
76.77-77.07 seconds. Native JSON-RPC error `-32603` carried
`[Errno 60] Operation timed out`. Stderr identified `oauth_manager.py:294`,
`Failed to run onboarding after obtaining access token`, and the first
`loadCodeAssist` call to Google's CCPA service.

A redacted OAuth refresh check returned HTTP 200 in 0.12 seconds, with 3,599
seconds of token validity. The native process then remained in `SYN_SENT` on
IPv6; its bundled `httplib2` timed out before trying the next address. An IPv4
connectivity comparison returned HTTP 404 in 0.066 seconds while IPv6 timed out.
The unchanged authentication probe succeeded in 2.50 seconds through a temporary
provider-scoped IPv4 CONNECT tunnel with end-to-end TLS. This isolates a failing
IPv6 path and absent native fallback, rather than a missing refresh token.

The user confirmed Gemini works on hotspot and fails on eduroam. No particular
router/VPN change was established. The experimental relay, integration and tests
were removed at the user's request; no network workaround remains in source or
system settings. Temporary tunnel processes and profile copies were removed.

The 0.1.4-to-0.1.5 launch-path comparison found no change to binary selection,
profile/auth setup, arguments or child environment. 0.1.5 task parsing runs only
after content arrives. The macOS Keychain change belongs to Electron; native
Antigravity uses file storage. October 5 native logs show successful auth and
`session/new`, including re-authentication at 7:48 PM EDT. Matching sanitized
configuration/runtime fingerprints narrow the release boundary, but do not
record the intervening host network state. The later 1.3.0 runtime and working
network have standalone evidence; that does not close orchestration recovery.

#### State and scheduling defects found alongside authentication

Startup attempts were serialized despite four slots. A queued child could show
coordination `running` before any native session/log existed, then `starting`.
Failed children became session `error`, coordination `reported`, with synthetic
`Assignment could not start` reports. Reports reached the active/ready parent;
that does not establish that it resumed and handled them. Synthetic failure
reports are expected recovery output, not proof assignments executed.

Projection timestamps for the first four failures shared
`2026-10-06T21:57:17.207Z` despite failures minutes apart. Use native request
timestamps above for latency. Investigate client labels for pending, starting,
running and failed work separately.

#### Repairs included in Personal 0.3.1

ACP errors preserve operation and sanitized native `data.details`. The recorded
failure now retains provider, `authenticate`, and timeout text in client/child
failure activity. Focused regressions cover cleanup and subsequent retry.
Provider commands now run up to four per-thread queues concurrently, preserving
same-thread ordering and workspace leases. Engine/worker regressions cover held
authentication, overflow, ordering and drains. These repairs do not fix the
native eduroam timeout.

A separate parser defect made incomplete whitespace-heavy task notifications
backtrack quadratically. A closing-tag requirement and greedy capture reduced
the recorded 16,000-space probe from about 404 ms to 0.06 ms. Valid padded
messages and incomplete input have regressions. This content parser runs after
authentication and was not the onboarding cause.

#### Evidence and acceptance

Original evidence came from read-only Personal SQLite and matching
`logs/provider/events.<thread-id>.log` files. Seven attempts and isolated native
probes showed the same failure sequence. The original orchestration monitor was
paused after the failures. Full historical notes before cleanup are retained at
`/private/tmp/t3-changelog-audit-20261011/ISSUE_TRACKER.before.md`.
The direct diagnostic was `/private/tmp/t3-gemini-auth-probe.py`; check that it
still exists before reuse. It sends authentication only. Removed relay scripts
are historical evidence, not a retained launch recipe.

Acceptance:

- A real Codex parent starts Gemini children, receives substantive reports and
  resumes/completes on a working network.
- Failed authentication reports provider, operation and actionable secret-free
  detail; a subsequent retry succeeds after cleanup.
- UI states distinguish queued/startup/failure from actual execution.
- Four assignments and queued overflow exercise concurrent startup without
  exceeding provider limits or losing failure reports.
- Rerun the complete cycle against the current installed runtime. Focused tests
  and a standalone Gemini success do not substitute for that cycle.

### ZED-001: Read Zed account usage from the billing service

Status: Blocked by Zed billing authentication.

The Zed entry in Limits must show the account's actual spend for the current
Zed billing period. It must not estimate account spend from one or more T3
sessions.

#### Observed behavior

The previous implementation built a `$10` monthly bar from ACP
`usage_update.cost` values. ACP reports cumulative cost for one session. It does
not report the account total shown by `dashboard.zed.dev`. A fresh provider
snapshot also showed `$0 / $10` before any session reported a cost.

#### Why the usage tracker does not work

T3 has no authenticated source for Zed account spend. The headless Zed provider
uses the stored native credential. Zed accepts that credential for
`/client/users/me`, but all tested billing routes return `401`:

- `/frontend/organizations/{id}/billing/usage`
- `/frontend/organizations/{id}/subscription`
- `/frontend/billing/usage`
- `/frontend/billing/subscriptions/current`

The dashboard sends a browser-session cookie to these routes. T3 does not have
that cookie and must not copy a private dashboard cookie into server state.

The native `/client/users/me` response includes the billing-period start and
end. It does not include token spend. Its usage fields contain request counts
and edit-prediction usage. Native account-update events fetch the same response,
so waiting for an update does not supply the missing spend value.

ACP `usage_update.cost` is also unsuitable. It is the cumulative cost of one
ACP session, not the account total for the billing period. Adding those values
across T3 sessions would omit usage from Zed and other clients, and repeated
cumulative updates could count the same session cost more than once.

The signed-in Safari dashboard showed `$5.20` used of `$10`. T3 cannot read
that value with the credential available to the provider. The usage tracker
therefore has no trustworthy value to display.

#### Billing response details

The organization dashboard reads
`/frontend/organizations/{id}/billing/usage` and
`/frontend/organizations/{id}/subscription`. The older account routes are
`/frontend/billing/usage` and `/frontend/billing/subscriptions/current`.
The organization usage response contains
`current_usage.token_spend.spend_in_cents`, `limit_in_cents`, and `updated_at`.
Any future implementation must preserve organization scope and use the billing
period from the same account.

#### Implemented behavior

`ZedProvider.ts` publishes a `probeFailed` usage state with no windows and the
message `Zed account spend is unavailable here. Check the Zed dashboard.` The
Limits view shows that message instead of a zeroed or session-derived bar.

`ZedProvider.test.ts` checks that the initial provider snapshot has no usage
windows and reports the explicit unavailable state. Provider-refresh tests
cover successful and nonzero-exit CLI probes. A failing probe previously marked
the provider ready. It now reports an error. Both paths keep account spend
unavailable. The unused `ServerProvider` import is removed.

Verification: 18 focused Zed tests pass, with the hosted smoke test skipped.
Targeted lint, the server typecheck, and `git diff --check` pass. T3 UI
verification remains pending because this session lacks the required Browser
panel tools.

#### Remaining work

1. Obtain a Zed billing API that accepts native credentials, or design an
   explicit dashboard sign-in integration. A local bridge change cannot grant
   access to Zed's hosted billing service.
2. Add a server-side provider read with explicit loading, failure, and stale
   data behavior.
3. Use the returned billing-period end time for the reset date.

Until that work lands, T3 reports Zed account spend as unavailable. It does not
publish a zeroed bar, and ACP session cost is never labeled as account spend.

#### Acceptance criteria

- The displayed amount matches the value from the supported Zed billing
  response.
- The reset date comes from the same response.
- The UI identifies the value as account spend and shows when it was checked.
- Missing authentication or an unavailable endpoint produces an explicit
  unavailable state, not a zeroed bar.
- Tests cover account scope, billing-period boundaries, failed reads, and
  repeated cumulative session updates.

## Verification scope

### Desktop and Zed verification, October 11, 2026

ZED-003 is resolved for Personal 0.3.1 with the configured native Zed bridge
and GPT-6 Luna at Medium effort. In separate scratch threads, Full access ran
`pwd` without an approval request; Supervised displayed a Command approval
card and ran it only after approval. Both returned the expected directory,
`fixture`. The Supervised reply and selection survived the delayed restart.
Account discovery no longer returned the historical GPT-5.6 Luna model.

The test copy's application code archive matched the installed app. Setup used
separate T3 and Electron data directories, remapped workspace paths, and a
temporary Zed credential copy. The test app exited normally, and the credential
copy was removed. The installed app and live T3 data were unchanged.

### Desktop verification scope, September 22, 2026

Used the already-running personal desktop app through computer use. Sent three
short Zed GPT-5.6 Luna prompts and one ChatLLM GLM-5.3-Flash prompt. Zed passed
basic response, follow-up memory, approved command execution, and conversation
persistence checks. ChatLLM returned `CHAT_OK` to
`Reply only: CHAT_OK. Do not use tools.` in thread
`405dca5a-683b-4de4-bce1-25ecd145d85e`, titled `Chat Acknowledgment`.
No further ChatLLM prompts were sent because Limits showed 10 credits remaining
before the test.

Settings navigation, provider configuration views, Usage Limits and Tokens,
the new-thread project picker, and the Files panel loaded. No additional
confirmed defect was found in that cursory pass. Computer-use window and
accessibility errors occurred initially and recovered. They are not classified
as T3 defects. Historical failed threads were not reproduced or filed as new
issues. Mobile, remote connections, cancellation, and quota exhaustion were not
tested. No app restart or configuration change was required.
