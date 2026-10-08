# Issue tracker

Updated October 6, 2026.

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

## Open issues

### DESKTOP-001: Slow backend startup exceeds the window readiness timeout

Status: Open. Observed during Personal 0.1.3 reinstallation, October 6, 2026.

The desktop readiness probe timed out after 60 seconds. Server startup spent
about 60 seconds in coordination-reactor startup and another 60 seconds in
project auto-pull, becoming ready after about 120 seconds. The server eventually
responded as 0.1.3, but the desktop window remained unavailable until the user
reopened the app. The subsequent installed Zed test passed.

Verify cold launch with retained projects and workflows. A slow background task
should not leave the app without a usable window after the backend becomes ready.

October 6 source check: `DesktopBackendManager` already retries readiness while
the backend remains alive. Its regression covers two expired readiness budgets
before a successful probe. All 26 backend-manager tests pass. Keep this issue
open until an installed cold launch with retained state establishes why the
reported launch still required reopening. Project auto-pull still runs before
server command readiness.

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
remote and multiple-environment flows, and native Zed MCP discovery with a
separate rebuilt binary. Web typechecking retains 11 unrelated HAST errors.

The desktop pass used Computer Use against `vp run dev:desktop`. See
[the handoff](./SESSION_HANDOFF.md) for evidence and remaining checks.

### WORKFLOW-002: Enable strict Antigravity workflows

Status: Parent startup verified with the managed Antigravity runtime. A full
Gemini parent and child report cycle remains unverified.

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

### WORKFLOW-003: Gemini authentication fails in standalone and orchestration threads

Status: Network-specific failure. Observed October 6, 2026 in installed Personal 0.1.5.
All six children failed. A standalone Gemini thread failed at the same step.
The native failure is isolated to IPv6 connectivity during onboarding. The user
reports Gemini works on hotspot after failing on eduroam Wi-Fi. The experimental
relay and its integration/tests were removed at the user's request. No network
workaround remains in the source. An October 8 full-adapter Gemini turn passed on the new network. Orchestration recovery remains unverified.

The user reported that OpenAI-to-Gemini orchestration remains broken and may
have regressed. In `Streamline Apartment Search Document`, parent thread
`8627c083-1d92-47ce-bc0e-b363ffd03e83` uses Codex `gpt-6.1-sol` with medium
reasoning. It assigned six read-only research tasks to Antigravity
`gemini-3.8-flash-medium`, with four concurrent child slots. All six children
failed before executing their assignments. No Gemini research result was
produced.

#### Confirmed evidence

The persisted model selections point to Antigravity and the requested Gemini
model. Native ACP logs show successful `initialize`, followed by failed
`authenticate` with `errorTag: Die` after roughly 75 seconds. These logs contain
no `session/new` or task execution for the failed children.

| Child thread                           | Authentication started, EDT | Authentication failed, EDT |
| -------------------------------------- | --------------------------- | -------------------------- |
| `e6de8648-babf-4938-85db-e6e292451bcf` | 5:57:19 PM                  | 5:58:34 PM                 |
| `6b5ce4e8-738e-4d7e-8ff7-8c0d3ab00d30` | 5:58:36 PM                  | 5:59:51 PM                 |
| `5033ad5e-d0a0-49d0-b4fe-f1e5b1d11e3f` | 5:59:53 PM                  | 6:01:08 PM                 |
| `0ee0c485-37c0-4634-baa4-ef298f0fbc90` | 6:01:10 PM                  | 6:02:25 PM                 |
| `eea72a7a-a7c2-400a-bcf1-395d8eff8f01` | 6:02:27 PM                  | 6:03:42 PM                 |
| `d1d3a5bc-df09-40e9-837c-1b7fe33dffe8` | 6:03:44 PM                  | 6:05:00 PM                 |

The user's new standalone thread, `Workspace Project Inventory`,
`1bb25504-c290-424a-8c79-950f3f64623a`, selected
`gemini-3.8-flash-high`. It also initialized successfully, began authentication
at 6:05:02 PM, and failed at 6:06:17 PM. Its session status became `error`.
The failure therefore does not require orchestration or a cross-provider branch.

A direct, credential-redacted Google OAuth check accepted the existing stored
refresh token with HTTP 200 in 0.12 seconds and returned an access token with
3,599 seconds of validity. The profile contains a refresh token. Neither the
credential file nor live T3 state was modified. This rules out a missing token,
Google rejecting that token during this check, and general inability to reach
the token endpoint from the diagnostic process. It does not prove the native
runtime's subsequent authentication calls succeed.

The cached provider snapshot still said `ready` and `authenticated`, with
`checkedAt: 2026-10-06T21:57:46.968Z`. That snapshot does not establish current
session authentication health.

#### Native authentication finding

An isolated probe ran the installed `agy_acp_server_1.1.1` binary against a
temporary copy of the Google profile. It sent only ACP `initialize` and
`authenticate`, with browser launch suppressed. It sent no model prompt and
removed the temporary profile after stopping its own process.

Initialization succeeded. Authentication failed after 76.87 seconds with this
native JSON-RPC response:

```json
{
  "code": -32603,
  "message": "Internal error",
  "data": { "details": "[Errno 60] Operation timed out" }
}
```

Native stderr identified `oauth_manager.py:294` and stated:
`Failed to run onboarding after obtaining access token`.

Further authentication-only probes reproduced the native timeout in 77.07 and
76.77 seconds with isolated copies of the Personal credential. The traceback
identifies the first `loadCodeAssist` request to
`https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`.
The native process remained in `SYN_SENT` on an IPv6 connection to Google.
The bundled `httplib2` client raises on socket timeout before trying the next
address.

An unauthenticated IPv4 connectivity check returned HTTP 404 in 0.066 seconds;
the same IPv6 check timed out. Routing the unchanged native authentication
probe through a temporary localhost CONNECT tunnel that connects to Google
over IPv4 produced successful authentication in 2.50 seconds. TLS remained
end-to-end, and the tunnel allowed only the OAuth and CCPA Google hosts.
The tunnel and native processes stopped after the probe, and temporary
credential copies were removed. No live credential or network setting changed.

The direct authentication diagnostic is
`python3 /private/tmp/t3-gemini-auth-probe.py`. It requires network access and
sends no model prompt. The temporary IPv4 tunnel and source relay were removed
at the user's request; their results above are historical diagnostic evidence.

This establishes a failing IPv6 path plus missing native fallback as the
immediate cause. The user reports previously working Gemini; the September 28
handoff records successful native Gemini work. The pinned runtime remains
1.1.1, and installed Personal is confirmed as 0.1.5. The time and cause of the
network change are not established. Matching runtime and sanitized provider
configuration fingerprints between the September 28 success and current
Personal install show no relevant boundary change in those artifacts; they do
not capture the intervening host network state. T3's displayed error also drops
the useful native `data.details` timeout message.

Despite four child slots, these startup attempts occurred sequentially. The
next child initialized only after the previous authentication failed. At
6:03 PM, child `d1d3a5bc-df09-40e9-837c-1b7fe33dffe8` had coordination phase
`running` but no session row or native log yet. At 6:04 PM, its session status
was `starting`. This mismatch needs investigation before treating the child
as executing its assignment.

Each failed child has session status `error`, coordination phase `reported`,
and a synthetic report beginning `Assignment could not start: Error: Internal
error`. T3 delivered the first two failure reports to the parent as ordinary
`Child reports arrived` messages. The parent remained `active`, with session
status `ready`, `waiting: false`, and no blocked reason. A delivered failure
report does not establish that the parent resumed and handled it.

The projection timestamps for all four startup failures are
`2026-10-06T21:57:17.207Z`, although the native failures occurred minutes apart.
Use the native request timestamps above when measuring startup latency.

#### Reproduction and investigation scope

Observed trigger: start a T3 layer from the Codex parent, assign six Gemini
3.8 Flash Medium review tasks, then call `wait_for_children`. Inspect each
child's provider startup and the reports delivered to the parent.

Evidence comes from read-only queries of
`~/.t3-personal/userdata/state.sqlite` and the matching
`~/.t3-personal/userdata/logs/provider/events.<child-thread-id>.log` files.
Seven existing attempts show the same failure sequence, and the isolated
authentication-only probe reproduced it. Those attempts predate the source
workaround. They involved no paid model turn, app restart, browser interaction,
or live credential change. The orchestration monitor was paused after all six
original children failed.

The IPv4 comparison identifies the authentication failure independently of
provider routing, model selection, and orchestration. Gemini works on hotspot;
the eduroam network failure remains outside the retained source repairs. Child
reports, parent recovery, and concurrency still need an integrated pass on the
working network.

#### Source repairs, October 6

ACP request errors now retain the native operation and text `data.details`,
using the existing bounded credential redaction. The recorded failure becomes
`Provider adapter request failed (antigravity) for authenticate: Internal error:
[Errno 60] Operation timed out`. Other response data is omitted. A regression
covers failed authentication cleanup and a subsequent successful session retry.
An engine-backed test verifies that session errors and failure activities retain
the provider, operation, and timeout detail sent to clients and child reports.

The provider command reactor used one queue for every thread, serializing
authentication attempts. It now processes up to four thread queues concurrently,
preserving command order within each thread and existing workspace leases.
An engine-backed regression holds one authentication attempt open while another
thread starts. Worker tests cover four active threads, queued overflow, same-thread
ordering, and drain completion. The coordination layer still owns child-slot limits.

The ACP error and concurrency repairs above did not resolve the native onboarding
timeout. Installed Gemini authentication, substantive child reports, parent
recovery, and client state labels remain unverified. No live credentials, paid
model turns, or app restart were used for those source repairs.

Verification: 326 focused tests pass across the provider command reactor,
coordination, quota policy, keyed worker, and affected ACP adapters. Server and
shared typechecks pass. Targeted lint passes with existing unused-parameter
warnings; formatting and `git diff --check` pass. The separate desktop
backend-manager suite passes 26 tests.

#### Release-boundary audit, October 6

The last two implementation releases are `b67039843` (Personal 0.1.4) and
`b1061c8e1` (Personal 0.1.5); `HEAD` `7da4d5dbe` only records the 0.1.5
publication. Comparing the provider launch files from the 0.1.4 parent through
0.1.5 shows no changes to Antigravity binary selection, profile/auth setup,
arguments, or child environment. The 0.1.5 Antigravity changes parse task
notifications after content arrives and retain bounded native error details.
They do not run before `authenticate`. The 0.1.4 macOS change disables
automatic keychain prompts in the Electron process; the native child is a
separate process and uses file-backed profile storage (`GEMINI_HOME` and
`AGY_ACP_FORCE_FILE_STORAGE=1`). This narrows the demonstrated release boundary
away from the authentication launch path; it does not prove there were no
other regressions.

Read-only Personal provider logs show successful native `initialize`,
`authenticate`, and `session/new` on October 5, including a later re-auth at
7:48 PM EDT. The user reports that Gemini worked yesterday and that the Wi-Fi
or VPN changed. The current direct native probe stalls on IPv6 during
`loadCodeAssist`; the same binary and temporary profile succeed through the
provider-scoped IPv4 relay. This makes the changed network path the leading
explanation, but available evidence does not identify a specific router, VPN,
or network configuration change. The user later confirmed Gemini works on hotspot and identified the failing
network as eduroam. The experimental provider relay was removed; no installed
app or system settings were changed.

The release audit also found a separate 0.1.5 performance regression in
`parseAntigravityTaskNotification`: an incomplete task message followed by
whitespace made its lazy output capture backtrack quadratically. The capture is
now greedy and must match the closing tag; summary trimming still removes
trailing whitespace. A focused regression test covers a valid whitespace-padded
message and an incomplete whitespace-heavy message. Direct measurements of the
real function changed from about 404 ms for 16,000 spaces before the fix to
about 0.06 ms afterward (`/private/tmp/t3-gemini-verification/parser-before.log`
and `parser-after.log`). This content-parsing issue is separate from startup
authentication.

Relevant code is `AntigravityAdapter.ts`, where `runtime.start()` precedes model
application, and `ThreadCoordinationReactor.ts`, which converts a matching
`provider.turn.start.failed` activity into a child failure report. The synthetic
report is expected recovery behavior; its existence is not itself the defect.

#### Acceptance criteria

- A real Codex parent can start the requested Gemini children, receive their
  substantive reports, and resume or complete the layer.
- Authentication failure identifies the failing provider and operation with an
  actionable, secret-free explanation instead of only `Internal error`.
- Child and parent states distinguish failed startup, pending startup, and
  actual execution. Failure delivery must not imply useful work completed.
- Verify four simultaneous child assignments and queued overflow. Explain or
  remove serialized authentication delays without exceeding provider limits.
- Add focused coverage for ACP authentication failure and parent recovery,
  then verify the full cycle against the installed runtime.

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

### ZED-003: Full access still blocks a read-only command for approval

Status: Open. Observed September 22, 2026 in T3 Code - Personal 0.0.42.

In thread `46981a74-b5c1-4a15-804f-44eb30d8ec00`, select Zed GPT-5.6 Luna
with Full access and send `Run pwd once. Reply with only the directory name.`
The thread enters Approval, shows a Command approval card for `pwd`, and
replaces the composer with `Resolve this approval request to continue`.
Approving the command succeeds and produces `t3code-dev`. Full access remains
selected afterward.

At the time of the report, the displayed permission mode did not match the
effective behavior. October 6 source inspection found that `ZedAdapter.ts`
now selects a provider-supplied allow option automatically in Full access.
When no allow option exists, it retains the approval flow. Reproduce the
installed terminal command before changing this policy again. Approval-required
behavior still needs a separate installed check.

#### Acceptance criteria

- Map supported permission modes to Zed's actual behavior, or clearly show the
  provider's limitation instead of presenting an ineffective Full access mode.
- Verify approval-required behavior separately. Do not bypass permissions
  merely to hide the mismatch.

### ZED-006: Model thinking effort is unavailable in T3

Status: Fixed, browser and desktop verified October 6, 2026. Released and installed in Personal 0.2.0.

The Zed ACP bridge previously exported model names and IDs without effort
metadata, and T3 assigned empty model capabilities. The adapter also ignored
model option selections.

The bridge now exports native effort values and defaults and validates ACP
configuration changes against the selected model. T3 exposes those values through
its existing web/desktop and mobile option controls and applies selections before
prompts, including reapplication from stored thread selections. Mobile keeps
compatible choices on a model switch and removes options unsupported by the
destination model. No new wire contract or storage format is needed.

#### Acceptance criteria

- Expose thinking-effort choices for Zed models that support them, using the
  model's actual supported values and default.
- Pass the selected effort to Zed and verify it affects the provider request.
- Preserve the selection across thread reload and session resume. When switching
  models, retain it only if the destination model supports that value.
- Cover web, desktop, and mobile model controls. Remote connections preserve
  the same selection.
- Models without configurable thinking effort do not show an ineffective control.

#### Verification

- 56 focused T3 tests pass across discovery, ACP dispatch, web/desktop composer
  dispatch, and mobile option handling. Cases cover defaults, changes during an
  active session, supported/unsupported model switches, custom hosted models,
  and reapplication of a serialized selection after restarting the adapter.
- Seven native bridge tests pass. The new test changes effort through the ACP
  handler and captures actual native `LanguageModelRequest.thinking_effort`
  values, without a hosted provider turn. Invalid values are rejected.
- Scoped server, web, and mobile typechecks and targeted lint pass. The local
  `zed-acp-server` binary is rebuilt in `zed-dev/target/debug`.
- Authorized computer-use verification in an isolated browser discovered Sonnet
  5.5 and GPT-6 Luna. Sonnet Max resets to Luna's native Medium default on a
  model switch. A real Luna Low turn and a High turn after restarting the server
  completed successfully; captured ACP configuration requests precede each
  prompt. High and both replies survive a page reload.
- Evidence is retained under `/private/tmp/t3-zed-effort-ui/evidence`. Temporary
  copied Zed credentials were removed and the isolated server was stopped.
- Installed Electron 0.2.0 shows Sonnet 5.5 and its Low, Medium, High default,
  Extra High, and Max choices. Selecting Low updates the composer; the draft was
  restored to High. About confirms `0.2.0 (6a29039bf7f6)`.
- Personal 0.2.0 is published at
  https://github.com/tvh0021/t3code/releases/tag/personal-v0.2.0 and installed in
  `/Applications/T3 Code - Personal.app`. DMG and ZIP integrity, deep signature,
  matching Personal signing identity, and uploaded artifact digests pass. The
  previous install is retained at `/private/tmp/t3-personal-before-0.2.0`.
- Native mobile and remote/relay runtime verification remain pending. Native
  conversation history resumption was not added; replacement sessions reapply
  the stored effort. The companion bridge commit is `11708bd472`; the desktop
  installer does not bundle this separately configured executable.

### MATH-001: KaTeX vector accent renders inside base glyph instead of above it

Status: Fixed and verified in the installed Personal 0.3.1 candidate on October 8, 2026. Included in this release.
Observed September 23, 2026.

In mathematical expressions containing vector notation such as `\vec{B}` (e.g.
`(\nabla \cdot \vec{B} = 0),`), the right-pointing arrow accent is rendered
vertically misaligned: the arrow appears positioned inside the body of the
letter $B$ along the midline / baseline instead of hovering above the glyph.

![KaTeX vector accent misaligned inside glyph](./assets/math-vector-accent-misalignment.png)

#### Observed behavior

When rendering assistant messages containing LaTeX via `ChatMarkdown.tsx`,
expressions with accents (such as `\vec{B}`) render with the accent symbol
overlapping directly with the character glyph. In the reported equation
`(\nabla \cdot \vec{B} = 0),`, the arrow accent rests inside the center of the
italicized letter $B$ rather than clearing the top of the letter.

#### Root cause investigation

`rehype-katex` resolved KaTeX 0.16.47, while `ChatMarkdown.tsx` imported the
stylesheet from the web app's direct KaTeX 0.18.7 dependency. The renderer
generated `.accent` and `.overlay`; the stylesheet targeted `.katex-accent`
and `.katex-overlay`. Those rules never matched, leaving the accent body
statically positioned and its SVG wrapper inline. The real chat renderer
reproduced the original overlap in an isolated copy of runtime state.

#### Remediation

Added a `rehype-katex>katex` override for 0.18.7 in `pnpm-workspace.yaml` and
updated the lockfile. Markup and stylesheet now use the same version. No custom
accent offsets or changes to the existing root and fraction CSS were needed.

#### Verification

Browser verification covered inline and display `\\vec{B}`, `\\vec{v}`,
`\\vec{E}`, hats, bars, tildes, dots, square roots with superscripts, fractions,
and scalable delimiters. All seven vector SVG paths cleared their base glyphs
by about 1.8 CSS pixels, using KaTeX font heights and the rendered vertical-list
baseline. The 54 existing `ChatMarkdown` tests passed.

This fixes the shared web renderer used by local, hosted, remote, and desktop
clients. The installed Personal 0.3.1 candidate also rendered inline and display vectors with arrows above their base glyphs. Native mobile uses its own
markdown renderer and was not changed or verified here.

#### Acceptance criteria

- [x] `\vec{B}`, `\vec{v}`, `\vec{E}`, and related accented math symbols render
      with the arrow floating cleanly above the character glyph.
- [x] No visual collision or overlap between the accent arrow and the letter strokes.
- [x] Existing math adjustments for square roots and fractions remain unaffected.

## Verification scope

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

## Resolved issues

### ZED-005: Complex tools crash or stall native subagents

Status: Resolved October 6, 2026 in companion Zed commit `317b394ae4`.

The live thread reported `ACP transport operation read-process-exit-status failed`.
The crash report showed a missing headless web-search registry. Native child
sessions also lacked event subscriptions, so child approvals could wait without
reaching T3. Streamed tool inputs remained stuck at their first fragment.

The bridge initializes web search, subscribes to child and nested-child sessions,
forwards pending approvals, routes answers to the child, and emits current tool
details with duplicate suppression. Seven focused Rust tests passed. A real
Sonnet 5.5 child search and parent file read completed normally; all 31 captured
ACP messages passed T3's schemas. Website 403 responses are a separate restriction.

### CHAT-002: Show context-window usage in the composer

Status: Resolved September 23, 2026.

The composer now shows a circular context-window meter when a provider reports
the current context token count. The meter shows the used share of the model's
context window and exposes the token counts on hover.

The server converts provider usage events into the shared
`context-window.updated` activity. The Zed bridge forwards real context
token usage, and the adapter maps the ACP `usage_update` fields `used` and
`size` to the shared context-window meter. Billing cost and character estimates
remain separate from context usage.

### ZED-004: Completed Zed turns are absent from the usage summary

Status: Resolved September 23, 2026.

Verified Zed session usage visibility and provider summary reporting in
Usage > Tokens. Session usage tracking operates independently of account billing
authentication.

### CHATLLM-001: The running desktop server does not refresh its model list

Status: Resolved September 23, 2026.

The RouteLLM `/v1/models` endpoint returns the dynamic model IDs (including
`gpt-6-sol` and `gpt-6-luna`) for the configured API key. The driver reads that
endpoint on manual refresh and checks it weekly while the server runs. Both
desktop and server bundles have been updated and verified.

### AG-001: Antigravity usage tracker omits historical sessions and severely undercounts token usage

Status: Resolved September 23, 2026.

Resolved by:

1. Extracting actual token metrics from ACP stream responses and SQLite
   conversation traces (`gen_metadata` / steps) rather than falling back to
   prompt-character heuristics.
2. Ingesting historical SQLite conversation sessions via `UsageService.ts` and
   `antigravityConversations.ts` across both user data and provider state
   directories.

### AG-CLAUDE-001: Claude 5.5 through Antigravity

Status: Verified in installed Personal 0.3.0 on October 8, 2026.

The managed runtime is ACP 1.3.0 and the shared client identity exposes the account's eligible Claude Opus and Sonnet 5.5 variants alongside Gemini. Native IDs reach chat and text helpers unchanged. Local classification preserves these variants across upstream manifest refreshes. Availability remains account-driven and relies on Google's undocumented recognized-client behavior.

The isolated release snapshot passed 167 focused tests, server typechecking, scoped lint and formatting. Earlier isolated live checks covered resume, cancellation and branch generation. Installed Opus, Sonnet and Gemini turns passed on the new network. Remote, relay, tunnel and native mobile paths remain unverified.

Installed verification completed account discovery of all six current Claude variants, live Opus and Sonnet turns, a switch back to Gemini, and thread reopening with retained replies and selection. The managed runtime reports 1.3.0. Native denied-tool behavior remains covered by focused tests rather than a live denial probe.
