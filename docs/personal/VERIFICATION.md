# Verification record

Last changelog audit: October 11, 2026. Last complete cross-client,
cross-provider runtime test: **not established by the retained evidence**.
Do not treat this audit date as a full-app PASS.

## Personal 0.5.0 release verification, October 14, 2026

The installed arm64 candidate reports 0.5.0 in native About. It retains the
Personal bundle ID and local signing identity. Deep signature and DMG integrity
checks passed. The previous 0.4.0 bundle is retained in
`/private/tmp/t3-personal-0.5.0-release/backup/`.

Retained history, Settings, provider listing, Luna selection and two ordinary
Codex turns passed in `/private/tmp/t3-personal-0.5.0-probe`, with a thread
reopen between turns. Responses contained `PERSONAL_050_TURN_ONE_OK` and
`PERSONAL_050_TURN_TWO_OK`. Limits shows the missing-session Zed notice.
Zed settings shows the secure session field and Connect. Connect opened GitHub
sign-in for Zed Industries; closing it restored the enabled Connect button.
No credentials were entered or saved.

278 focused tests passed, including the Antigravity new-directory regression,
billing states and secret save/redaction/clear behavior. Five affected package
typechecks, formatting and scoped lint passed with existing warnings. Three
settings filesystem-watch tests timed out in the sandbox and passed with native
filesystem access. An obsolete test under `apps/server/test/provider` imports
removed V1 modules and cannot run; it is outside the current source test suite.
Startup traces show readiness retries, unavailable optional CLI probes, missing
`t3.json` in the empty probe folder, and unauthenticated Bitbucket access.
No visible error blocked the tested flows.

Live Zed billing, cookie lifetime, organization billing and quota fallback are
not established by this pass. Organization billing is unsupported. Hosted web
and remote connections were not exercised; mobile verification is outside this
fork's scope. Final commit metadata and the short smoke pass are recorded with
the release evidence. Local build logs and evidence are in `/private/tmp/t3-personal-0.5.0-release/`.

## Personal 0.4.0 release verification, October 14, 2026

Native About reports 0.4.0 at `a97e3bb66ef8`. The installed app preserves the
Personal bundle ID and signing identity. Deep signature verification passed
with macOS signing-service access outside the filesystem sandbox. All four
release artifact checksums match `SHA256SUMS`.

Installed-app computer use confirmed retained conversations after migration,
Settings, the provider listing, Usage limits, and Luna model selection. Two
ordinary turns passed in `/private/tmp/t3-personal-0.4.0-probe`, with a thread
reopen between turns. Responses contained `PERSONAL_040_TURN_ONE_OK` and
`PERSONAL_040_TURN_TWO_OK`. A temporary delegated-limit override persisted after
save and reload. Clearing it, saving, and reloading restored the blank field
and named defaults.

No visible error blocked these flows. Traces include startup readiness retries,
unavailable optional CLI probes, an unauthenticated Bitbucket probe, and the
expected missing `t3.json` in the empty probe folder. Screenshots and the local
verification report are in `/private/tmp/t3-personal-0.4.0-release/verify/`.
The previous app and pre-migration database copies are in the release directory's
`backup/` and `db-backup/` directories.

The earlier isolated dev desktop pass covered a live `delegate_task` child.
This installed-app pass did not repeat delegation or the legacy paused-layer
MCP rejection checks. A later installed 0.4.0 check confirmed a `reviewRef` child uses a separate
checkout at `HEAD~2`, leaves the parent worktree untouched, and rejects an invalid
ref. Live quota fallback remains untested. Hosted web, remote connections, and fresh inference through other
providers were not tested. Mobile verification is outside this fork's scope.

## Upstream orchestration-v2 sync, October 13, 2026

The fork moved onto upstream's orchestration-v2. The T3 orchestration layers,
worker tools, coordination reactor and fork Antigravity quota converter were
removed. Rows 041, 043-053 and 077 describe that removed code. Their verdicts
are historical, and their PASS results do not cover upstream `delegate_task` or
the rebuilt quota handoff. Row 042's named limits and price bands survive as
`delegate_task` turn budgets.

Source checks: server, contracts, web, client-runtime, provider-core and
desktop typechecks passed. More than 700 focused tests passed, including the
new delegation-guard, recovery-worker fallback, usage-cache and Zed tests.
Migrations ran cleanly against a read-only copy of Personal state. Two
upstream AntigravityAdapterV2 client-file tests failed on macOS. Upstream's
workspace check rejected new files in new directories when the workspace path
went through a symlink, like `/var` to `/private/var`. The fork fixed this on
October 14 in `AntigravityClientFiles.ts` and added a platform-independent
regression test.

The October 14 release checks above supersede the pending desktop runtime pass.
A live `delegate_task` turn budget and quota fallback remain untested. The later
installed 0.4.0 check above covers `reviewRef` snapshots.

## Personal 0.3.3 release verification, October 13, 2026

The signed macOS arm64 candidate reports 0.3.3 and source `10a17c581b5c`
in native About. It preserves `com.t3tools.t3code.personal`, the Personal
product name, existing signing identity and `~/.t3-personal` data location.
Deep signature verification and the DMG checksum passed. Signature verification
requires macOS signing-service access outside the Codex filesystem sandbox.

Installed-app computer use confirmed retained projects and threads, Settings,
Codex Luna model selection, two ordinary agent turns and thread reopen after
Usage navigation. The disposable project is `/private/tmp/t3-personal-0.3.3-probe`.
The responses contained `PERSONAL_033_TURN_ONE_OK` and
`PERSONAL_033_TURN_TWO_OK`. Inline powers and display fractions and square roots
rendered correctly. Usage Limits loaded Codex credits and Antigravity quotas;
refresh and the Tokens model breakdown worked. Recent server trace entries
showed successful requests during the smoke check.

The prior session's retained log reports 1,117 passing tests across 57 focused
files. Affected package typechecks passed. The `coordinationIds.test.ts` lint
fix uses `it.effect`; its two tests passed again in this session. Scoped lint
has two pre-existing errors in `antigravityUsageLimits.ts`, for `process.platform`
and `JSON.parse`. Composer styling warnings remain warnings. The desktop build
script tests passed in this release pass; the earlier cleanup failure below
remains a historical result.

Mobile runtime verification is outside this fork's scope. Hosted web,
remote/relay/tunnel, full coordination parent/child and quota-handoff workflows,
and fresh Antigravity inference were not exercised. Existing audit findings,
including COORD-001 and CODEX-CREDIT-001, remain open. This maintenance release
has no intended behavior change and does not establish a full-app PASS.

The previous 0.3.2 bundle is recoverable under
`/private/tmp/t3-personal-0.3.3-release/backup/`. The candidate and final artifact
staging live under `/private/tmp/t3-personal-0.3.3-release/`. Computer-use evidence
is retained in the release conversation. Temporary files are not shipped.

## Desktop recovery and isolation correction, October 12, 2026

The working desktop displayed `Timed out waiting for authenticated session after
bootstrap.` The installed app was already Personal 0.3.2. Its archive still
matched the SHA-256 below, so replacing it with that release would not change
the executable.

Read-only inspection of `~/.t3-personal/userdata/logs/desktop.trace.ndjson.1`
found desktop startups at 10:08 and 12:58 EDT on October 12. The live
`auth_sessions` table showed that the desktop bearer session issued at
14:08:24.208Z was revoked when its replacement was issued at 16:58:38.886Z.
The running desktop later repeatedly received `Session token revoked.`
Its cached bearer token did not refresh. Browser bootstrap requests succeeded,
but desktop HTTP requests omit cookies and continued using that revoked bearer.

These live session changes overlap the audit. The retained evidence does not
identify the exact audit action that reached the working environment. Earlier
blanket claims that desktop verification left the installed app and its state
untouched are not reliable. Separate test directories alone did not establish
isolation. Future desktop checks must establish the test process, T3 home,
Electron profile, and backend endpoint before interaction. A shared display
name is not sufficient to distinguish a test copy from the working app.

With explicit computer-use permission, normal Quit followed by launching
`/Applications/T3 Code - Personal.app` restored authentication. Two normal
launches loaded the existing application state. A renderer Reload check instead
left a blank window, recovered by the second normal launch. Reload recovery is
not a PASS. The app was left running. Read-only database counts remained
13 projects and 307 threads. No database repair, credential-file edit, release
replacement, provider prompt, or source-code change was needed for recovery.

## Scope and result

On October 12, 2026, the developer excluded mobile verification. The mobile app
uses a third-party service that does not receive server changes from a local
fork update. Follow the [mobile verification restriction](../../AGENTS.md#verifying).
Mobile-only claims are outside the current acceptance scope and receive no
runtime PASS. Composite claims now require their web, desktop and server parts.

Audited all 93 bullets present before this pass in `CHANGELOG.md`, September 18
through Personal 0.3.2. Source revision was
`18e24c98fe8a1ff3c4059ab534f9738891ffb888`. The only initial T3 working-tree
change was `ISSUE_TRACKER.md`; its existing desktop/Zed verification edits
were preserved. Companion Zed was `11708bd472a5ad44b995140ba7d74f76243abc1d`
with existing README and cloud-model edits, which were not changed.

Desktop computer use inspected an isolated copy of installed Personal 0.3.2.
Its `app.asar` SHA-256 was
`8959c0f4ceb716c82e5704368b9a2d0a98714991f67c4e48d6c4e4f2298520e3`,
identical to the installed archive. A read-only `VACUUM INTO` snapshot retained
13 projects and 307 threads. All projected workspace paths were remapped to a
disposable repository. Separate T3 and Electron directories were used; provider
secrets and managed Antigravity runtime/profile were not copied. The initial audit
performed no model prompt, publication, credential change, or live database write.
The continuation sent one accidental short Codex prompt in a disposable project;
it produced a clarification response and no source changes.
The native desktop UI was used after explicit user authorization; T3 preview
MCP tools were unavailable.

Verdicts apply to the scope stated in each row. PASS requires direct runtime
or public-library observation. Tests alone do not establish PASS. BLOCKED means
current runtime evidence is insufficient, including partially exercised composite
claims. Historical / not applicable identifies historical build, test, release, or decision records
with no separate current runtime behavior. FAIL identifies a quality defect;
AG-QUOTA-001 is explicitly a source/converter finding rather than a live-account
reproduction. Historical reports remain historical even when recorded today.

Inventory after the latest October 12 continuation: 51 PASS, 11 FAIL, 2 BLOCKED, 29 Historical / not applicable.

Confirmed findings and remaining work live in [ISSUE_TRACKER.md](./ISSUE_TRACKER.md).
The stale Abacus driver-list test failed in the initial audit and was corrected
in the continuation; both focused driver tests now pass. Neither the first MCP listen restriction
nor stale computer-use element indices were classified as product defects.

## Evidence and repeatable checks

Evidence root: /private/tmp/t3-changelog-audit-20261011/ (local evidence, not preserved in repo). These local artifacts
are not shipped. Preserve or relocate them before clearing temporary files.

| Key | Method and observed result                                                                                                                                             | Evidence in that directory                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| L1  | Node loaded the public contracts export and shared usage merge. Nine name probes, credit round trips, combined rows, duplicate environments and 20,000 buckets passed. | `public-probes.mjs`, `public-probes.json`            |
| D1  | Desktop Limits and screenshot show branding, single-instance logos, Codex credit balance and explicit Zed spend unavailability.                                        | `usage-tokens.png`, computer-use transcript          |
| D2  | Settings/About reports 0.3.2. Providers shows ChatLLM, model catalog, named budgets and 95% threshold.                                                                 | `settings-general.txt`, `providers.txt`              |
| D3  | Retained HTML Math Rendering Check thread renders inline and display vector arrows above their letters. Ordinary follow-up text and stored model/mode remain visible.  | `math-vectors.png`                                   |
| D4  | Usage Tokens loads Model and Day; refresh works. Day cost cells do not add to Total.                                                                                   | `usage-tokens.txt`, `usage-day.txt`, `usage-day.png` |
| D5  | Outside-workspace `report.html` offers system/integrated browser choices. Integrated preview loads `T3_HTML_040_OK`. The task panel was closed afterward.              | `html-integrated.png`                                |
| Q1  | Controlled internal quota-converter diagnostic drops 99%-used Claude bucket. Public merge produces Codex $4 and day Total $1 for a mixed subscription/credit fixture.  | `quality-probes.mjs`, `quality-probes.json`          |
| P1  | Read-only official pricing review found no published numeric mismatch. Aliases and Gemini cache-creation assumption remain explicit.                                   | `pricing-review.md`                                  |
| T1  | 133 focused usage/pricing/transcript/limits/compatibility tests passed.                                                                                                | `usage-tests.log`                                    |
| T2  | Provider group: 100 passed, one stale driver-list assertion failed, one opt-in hosted smoke skipped. Initial MCP listen EPERM resolved in T4.                          | `provider-tests.log`                                 |
| T3  | 184 focused workflow, quota, worker, desktop-backend and markdown tests passed.                                                                                        | `workflow-render-tests.log`                          |
| T4  | Real MCP HTTP discovery and tool invocation passed after allowing a temporary local listener.                                                                          | `mcp-transport-tests.log`                            |
| T5  | 115 focused Antigravity protocol/provider and macOS Keychain/permission tests passed.                                                                                  | `boundary-tests.log`                                 |
| T6  | Web package typecheck exited 0, with suggestions. The historical HAST blocker is absent.                                                                               | `web-typecheck.log`                                  |

Final test accounting across the 34 selected files: 533 passed, one failed,
one skipped, counting the successful MCP retry once. This was a focused audit,
not a repository-wide suite. Exact file selections are retained in `checks.sh` in the evidence directory. No implementation code or tests were changed in that initial audit.

Run public probes from `packages/shared`:

```sh
node --input-type=module < /private/tmp/t3-changelog-audit-20261011/public-probes.mjs
node /private/tmp/t3-changelog-audit-20261011/quality-probes.mjs
```

Desktop setup and launch scripts are `setup.py` and `launch.py` in the evidence
root. Setup is a one-time operation against a fresh directory, not an idempotent
reset command. Launch uses the retained isolated app/state and disables updates.
The remapped project paths do not reproduce real auto-pull workloads. The test
app was quit through its own menu and the captured launch process exited 0.
The installed app was not quit or restarted.

Published pricing was compared with [OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), and
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). Local aliases
are not additional official model identifiers. Gemini cache creation uses input
rates as a local assumption; storage, long-context premiums and nonstandard
processing modes are outside the estimate.

## Pricing continuation, October 11, 2026

A source server at the same revision used isolated T3 state and provider homes.
Seven direct WebSocket and public-client probes passed. Combined Sonnet cost
was $10 from exact Low and base High overrides, then $12 after editing only Low.
Deleting the overrides repriced the unchanged transcript to $4. Provider-reported
Opus cost remained $11, an unknown model stayed unpriced, repeated scans did not
duplicate records, and hourly and daily totals agreed. A 48-hour hourly request
returned the typed `invalidWindow` error.

This closes item 092 and covers pricing precedence in item 091. The remaining
limits on item 091 still apply. The separate focused service, aggregation and
pricing run passed 54 tests across three files. These counts are not added to
the earlier 533-test audit because the selections overlap.

Evidence and the repeatable source-server recipe are in
the continuation report (local evidence: /private/tmp/t3-verify-continuation-20261011/REPORT.md).
Actual responses are in
rpc-frames.json (local evidence: /private/tmp/t3-verify-continuation-20261011/rpc-frames.json),
and the probe results are in
results.json (local evidence: /private/tmp/t3-verify-continuation-20261011/results.json).
The captured server process exited after verification. No implementation files,
provider credentials, live databases or model prompts were used or changed.

The user subsequently authorized native Computer Use against the isolated desktop
copy, overriding the unavailable Browser panel requirement.

## Desktop and ACP continuation, October 11, 2026

The isolated Personal 0.3.2 renderer displayed a seeded assistant-message fixture
with inline/display vectors, fractions, roots, a math table, bold/italic wrappers,
a quote and a hat accent. Table expansion/collapse worked; ordinary inline code
and a Python block remained literal. This closes 006, 018 and 085 for the desktop
renderer. Source dependency and lockfile entries both use KaTeX 0.18.7. Evidence:
rendering screenshot (local evidence: /private/tmp/t3-verify-continuation-20261011/rendering.png),
styled specimens (local evidence: /private/tmp/t3-verify-continuation-20261011/rendering-styled.png),
and accessibility output (local evidence: /private/tmp/t3-verify-continuation-20261011/rendering-ax.txt).
The fixture is projection-seeded, so it establishes rendering rather than provider
message ingestion. The isolated app was quit and its launch process exited 0.

A controlled ACP subprocess exercised the real source server, adapter, orchestration
and WebSocket subscription. Native task reports appeared without ending the prompt;
ordinary text and foreign task markup survived. An incomplete notification followed
by 16,000 spaces completed without hanging. Standard JSON-RPC errors exposed a
transport defect: native code/data became an internal stack trace. The working-tree
fix normalizes these as request failures before core or extension RPC decoding.
Two raw-wire regression tests failed before the fix and pass afterward.

The same runtime probe now retains `session/prompt` and native details, redacts a
Bearer credential, truncates a detail exceeding 5,000 characters, completes a retry,
and stops a process ignoring cancellation after the 15-second timeout with the
explanation intact. This closes 073, 075, 087 and 088 for the controlled ACP wire
scope. It does not establish Google account authentication or live inference.
The fix has not been installed or released. Focused checks passed: 95 protocol,
client and adapter tests; two corrected Abacus driver tests; effect-acp package
typecheck; lint for changed files. No repository-wide checks were run.

Runtime report and recipe (local evidence: /private/tmp/t3-runtime-continuation-20261011/REPORT.md),
results (local evidence: /private/tmp/t3-runtime-continuation-20261011/results.json), and
actual WebSocket events (local evidence: /private/tmp/t3-runtime-continuation-20261011/rpc-frames.json)
retain the evidence. Captured server processes were stopped. Mobile, remote,
workflow and authenticated provider claims remain open.

## Workable checks, October 12, 2026

Six more claims pass. The real source server enforced four concurrent thread
startups; the public worker export preserved 100 commands in order across five
keys. The isolated desktop showed the 20/18/18/17 px interface, prompt, code and
terminal defaults with rendered previews. Real usage endpoints survived failed,
missing-cache and unusable-rate-source cases. Monthly model/rate maintenance,
price bands, named limits, overrides and captured active budgets passed.

Controlled ACP providers exercised complete MCP workflow cycles, duplicate reports,
parent wakes, child role guards, explicit pause/resume/cancel, shared exhaustion
and restart persistence. The parent could not call coordination tools after
`wait_for_children`. Review/edit children auto-approved scoped MCP read/report
requests, while unrelated native tools required explicit client decisions.
Seven model variants used Full access on seven new and seven resumed sessions.
Rows 041 and 055 remain partial because their claims also include mobile/client
behavior that this backend evidence cannot establish.

A real defect was fixed locally: Antigravity review workers could write through
T3's ACP filesystem handler. The adapter now rejects those writes, preserves
reads, and allows editing/ordinary writes. The regression failed before the fix;
42 adapter tests pass afterward. Five real review write attempts now fail without
creating files; an editing child still writes successfully. Native command-tool
restrictions across every provider remain a separate unverified claim in 043/044.

Item 056 is FAIL rather than BLOCKED. The public coordination helper still
branches on GPT model names: identical Zed review inputs select Full access for
GPT and approval-required for Claude. Existing tests require that distinction.
The current guide was corrected; the historical changelog claim is not supported.
This is a documentation mismatch, not evidence of a provider crash.

This pass ran 74 focused tests across six files, all passing. Server package
typecheck, scoped lint and diff whitespace checks passed. The code fixes remain
uninstalled. All captured probe servers and the isolated desktop were stopped.
The continuation report (local evidence: /private/tmp/t3-workable-verify-20261011/REPORT.md)
links the exact scripts, inputs, results and limits. The source revision remains
`18e24c98fe8a1ff3c4059ab534f9738891ffb888` plus the retained working-tree fixes.

## Native-provider continuation, October 12, 2026

Ten blocked claims now have verdicts: six PASS and four FAIL, representing three
new defects. At that checkpoint the inventory was 29 PASS, 7 FAIL, 30 BLOCKED and 27 Historical / not applicable.
The user subsequently extended the target to 20 BLOCKED.

Authenticated native Zed Luna and Sonnet turns prove current discovery, intact
streaming, full-access and supervised permission handling, child tool updates,
and child approval routing. The context claim fails: native session storage has
nonzero token usage, but ACP emits no usage updates. Restart with unchanged
settings and failed discovery also replaces the cached current catalog with
retired seed models. Same-process failure retention does pass.

Controlled ChatLLM responses through the real source driver prove monthly credit
and reset handling, disk logging and $0.0005 conversion. First-turn attribution
fails: two 40-credit charges become 3.36 and 40 logged credits, so the summary
shows 43.36 instead of 80. This is controlled account evidence, not a live charge.

45 focused tests pass. These defects remain unfixed in this continuation.
The Mac was locked, so desktop effort controls remain open. All captured servers
and the isolated desktop were stopped, and temporary Zed credential copies were
removed. The report (local evidence: /private/tmp/t3-verification-to30-20261012/REPORT.md) and
filtered evidence (local evidence: /private/tmp/t3-verification-to30-20261012/evidence-summary.json)
record recipes, adjacent cases and the exact limits.

## Account/provider continuation, October 12, 2026

The requested target is reached: 38 PASS, 8 FAIL, 20 BLOCKED and 27 Historical / not applicable.
This continuation resolves ten more claims: nine PASS and one FAIL. Across both
October 12 provider passes, 20 previously blocked claims became 15 PASS and
five FAIL. These failures identify three distinct defects, which remain unfixed.

The real ChatLLM driver completes file-read and command loops against controlled
HTTP responses. A harmless command containing a forbidden word is rejected by
the safety filter, creates no marker file, and returns its error to the next
model request. Native Antigravity Gemini and Sonnet inference both succeed.
Their conversation databases yield one priced generation each, stable across
repeat usage scans. This closes native usage support while the combined
accounting claim fails on the independently reproduced ChatLLM first charge.

The authenticated Antigravity account exposes changing five-hour and weekly
quota readings with reset timestamps. Fresh installed state seeds Gemini models
with outbound requests rejected and no account credentials. Real discovery and
refresh retain six current Claude effort variants; a sparse controlled account
catalog does not invent absent variants. No actual reset was induced and no
countdown UI was inspected.

Real MCP creates and reads a native Zed chat across providers. A native Zed
review worker uses the scoped MCP tools, reads its detached fixture, reports,
wakes its controlled parent and emits the finished receipt. The parent completes
the layer. The initial harness timed out waiting for text after completion;
retained MCP calls, persisted state and receipts prove the cycle succeeded.

Authenticated managed Gemini independently starts a parent layer with quota
handoff enabled. That attempt pauses because Zed spend is unavailable. With
handoff disabled, Gemini spawns a native Zed review child, receives its report,
automatically resumes and returns the requested marker. Actual quota-triggered
provider switching remains unverified in row 047. The native child search from
the preceding pass also proves search_web returns five results without crashing.

All captured servers are stopped and temporary credential copies removed. No
implementation source was changed by these provider passes; the existing
working-tree fixes remain uninstalled. The five-hour window reset naturally;
no reset credit was consumed. The Luna five-minute monitor was paused after
reaching 20. The report (local evidence: /private/tmp/t3-verification-to20-20261012/REPORT.md) and
filtered evidence (local evidence: /private/tmp/t3-verification-to20-20261012/evidence-summary.json)
retain exact observations and scope limits.

## Logging/history/effort continuation, October 12, 2026

Renamed the 27 SKIP verdicts to Historical / not applicable at the user's request.
The latest inventory is 48 PASS, 11 FAIL, 5 BLOCKED and 29 Historical / not applicable.
Two more claims pass and one fails. Historical labels do not grant a runtime pass.

Historical Antigravity ingestion matches 272 generations in the September 1–18
window from read-only snapshots of 14 original native conversation databases.
Raw stored generation counters and public WebSocket usage totals agree by day.
Repeat scans, a duplicate session in a managed-profile directory and a corrupt
database do not inflate totals.

The advertised T3 per-turn logging path is absent for the completed native
Gemini and Sonnet turns. Their native databases contain measured usage and
historical ingestion recovers it, but no Antigravity session JSONL was written.
The adapter writes that log only when the ACP prompt response includes usage.
ChatLLM logs do exist. AG-TURN-001 records this integration gap without claiming
that Antigravity totals are lost.

The Mac became available. The isolated installed desktop and verified companion
binary completed native Luna turns at Low and Medium. The desktop effort menu
uses native choices. Low persists across draft reload and thread reopening;
Sonnet retains the compatible Low choice. Switching Sonnet Max to Luna restores
its supported Medium default, survives thread reload, and reaches the next
native prompt. Only disposable state and inward-copied credentials were used.

A usage-only extraction of 354 Codex rollout files covers June 22–September 19.
The public endpoint returns 1,403.59 credits for the full window. Cutting the
input at the earliest retained checkpoint containing the old claim returns
1,336.97; a later commit cutoff returns 1,340.45. Auto-review stays zero and
repeat scans are stable. The original scan cutoff and exact corpus for the
reported about 1,334 credits remain unknown. On October 12 the user excluded that
old total from acceptance and requested current ingestion verification only; row
025 passes under that scope.
No discrepancy was promoted to a defect on changed inputs alone.

The report (local evidence: /private/tmp/t3-blocked-continuation-20261012/REPORT.md) retains the
recipes, counter oracle, cutoff limits and UI evidence. Captured servers and the
isolated desktop are stopped. The temporary Zed credential copy was removed.
No implementation change, install, commit or release was made.

## Stopped continuation, October 12, 2026

Historical stop, superseded by the later request to address the five remaining items. Counts at that stop:
48 PASS, 11 FAIL, 5 BLOCKED and 29 Historical / not applicable across 93 rows.
The zero-blocked target is not complete. Remaining IDs are 004, 043, 055, 064
and 084. Their row notes state the missing evidence.

This pass verified official model rates, browser math preprocessing, web
workflow controls and completed report labels, and macOS Documents grant
retention using the actual persistent signing helper on a disposable native
app. TCC records the first prompt and allow, followed by replacement access
without a new prompt. The installed app was not replaced. Current normal
Keychain-free launch is accepted based on the developer's confirmation and
prior isolated desktop observations; adverse Keychain conditions are excluded.

The dummy-Keychain experiment had already run before the stop request. Its
locked read returned -128 rather than the fixture's expected -25308. This is
an unsettled probe result, not a product failure or an adverse-condition PASS.
Its finally block removed the temporary Keychain. Do not repeat it for this
audit. The developer explicitly said it was unnecessary.

All owned verification servers and disposable desktop processes are stopped.
The grant-test app quit normally, the browser task tab is closed, and the
original scratch provider settings are restored. The iOS download was canceled;
no mobile client was built or launched. CocoaPods installation completed before
mobile was excluded. Mobile verification is prohibited by root AGENTS.md.

Evidence and restart context: continuation report (local evidence: /private/tmp/t3-zero-20261012/REPORT.md).
No commit, PR, release or lasting implementation edit was made in this pass.
Existing implementation changes from earlier work remain untouched.

## Final-five continuation, October 12, 2026

The developer resumed work and accepted first-party mark matching for 004.
Rows 004, 043 and 064 now pass. Inventory is 51 PASS, 11 FAIL, 2 BLOCKED
and 29 Historical / not applicable. Rows 055 and 084 retain their specific gaps.
Local web/desktop HTML and desktop PDF behavior now have fresh runtime evidence.
Native desktop automation became unreliable before the remaining checks finished.
An unintended Claude update attempt was interrupted when the disposable app quit;
no completed update is recorded. No permission workaround was attempted.

See the evidence and fixture incident report (local evidence: /Users/tvh0021/.codex/visualizations/2026/10/12/01a12fe1-c2ad-74e3-b4db-4af8277cf571/five-blockers/REPORT.md).
Owned verification servers and the disposable desktop are stopped; task browser
tabs are closed. Mobile and further Keychain verification remain excluded. Existing failures are
not changed by closing three blocked rows. This is not a full-app PASS.

## Per-item audit

IDs enumerate the original 93 bullets in file order. Dates/releases and short
claim names identify the source entry. Verdicts are PASS (direct runtime evidence),
FAIL (quality defect), BLOCKED (insufficient evidence), or Historical / not applicable
(build, test, release or decision records with no separate current runtime behavior).

Inventory: 51 PASS, 11 FAIL, 2 BLOCKED, 29 Historical / not applicable.

**001** (2026-09-18): Sidebar Header

- Verdict: **PASS**
- Desktop screenshot shows two lines and unclipped personal descenders. D1.

**002** (2026-09-18): Typography

- Verdict: **PASS**
- Isolated desktop default controls and prompt/code/diff/terminal previews show 20/18/18/17 px. October 12 typography evidence.

**003** (2026-09-18): ChatLLM Agentic Driver

- Verdict: **PASS**
- Real driver completes an autonomous file-read and command loop; forbidden command is rejected and its error reaches the next model request. Controlled HTTP responses, no live ChatLLM charge. Account/provider continuation.

**004** (2026-09-18): ChatLLM Branding

- Verdict: **PASS**
- First-party Abacus mark matches the shipped icon. The developer accepted mark matching on October 12 and excluded exact official SVG provenance from acceptance. Web model picker shows ChatLLM. Mobile excluded.

**005** (2026-09-18): LaTeX Math Rendering

- Verdict: **PASS**
- Retained answer renders inline and display vectors through the actual desktop chat renderer. D3.

**006** (2026-09-18): KaTeX Styling

- Verdict: **PASS**
- Desktop inline/display fractions, roots and vectors render correctly, including styled wrappers. Rendering continuation screenshots; desktop scope.

**007** (2026-09-18): Provider Badges

- Verdict: **PASS**
- Single-instance Codex and Zed logos show without initials badges in desktop Limits. D1. Mobile not included.

**008** (2026-09-18): ChatLLM Usage Limits

- Verdict: **PASS**
- Controlled account responses through the real source driver expose monthly credits and subscription reset. Failed billing uses next-month fallback; failed points report unavailable. Native-provider continuation; no live rollover induced.

**009** (2026-09-18): Antigravity Usage Limits

- Verdict: **PASS**
- Authenticated managed runtime exposes changing five-hour and weekly quota percentages with reset timestamps through server config. No actual rollover or countdown UI exercised. Account/provider continuation.

**010** (2026-09-18): Antigravity Quota Windows

- Verdict: **FAIL**
- The old exclusion still drops usable Claude quota buckets. Source and converter diagnostic confirm the gap; live account effect remains unverified. AG-QUOTA-001, Q1.

**011** (2026-09-18): Antigravity Model Catalog

- Verdict: **PASS**
- Installed managed runtime seeds Gemini models with outbound requests rejected and no account credentials; authenticated discovery separately returns 18 account models. Account/provider continuation.

**012** (2026-09-18): Upstream Sync

- Verdict: **Historical / not applicable**
- Historical source-control merge, no independent runtime behavior. Preserve dated history.

**013** (2026-09-18): Token & Cost Tracking

- Verdict: **FAIL**
- Native Gemini and Sonnet generations produce stable priced usage buckets. ChatLLM first-turn accounting undercounts a controlled 40-credit charge as 3.36; combined accounting claim fails. CHATLLM-USAGE-001.

**014** (2026-09-18): Real-Time Turn Usage

- Verdict: **FAIL**
- Completed native Gemini and Sonnet turns have nonzero database counters but no T3 Antigravity per-turn JSONL log. ChatLLM logging passes; native database fallback recovers totals. AG-TURN-001. Logging/history/effort continuation.

**015** (2026-09-18): Historical Usage Ingestion

- Verdict: **PASS**
- Read-only snapshots of 14 original native databases yield 272 September 1–18 generations. Public usage totals match raw generation counters by day; repeat, duplicate-session and corrupt-database cases preserve totals. Logging/history/effort continuation.

**016** (2026-09-18): Pricing Catalog

- Verdict: **PASS**
- Real pricing refresh/usage endpoints retain cached rates after network failure, handle no cache and unusable responses, and leave unknown models unpriced. Pricing-fallback continuation.

**017** (2026-09-18): ChatLLM Point Pricing

- Verdict: **PASS**
- Real ChatLLM driver writes per-turn disk records; measured second-turn 40-credit delta is $0.02 through the usage endpoint. First-turn attribution is separately FAIL in 022. Controlled API continuation.

**018** (2026-09-18): Table & Inline Math

- Verdict: **PASS**
- Desktop math table, inline fractions/vectors/roots, expansion/collapse and adjacent literal code passed. Rendering continuation.

**019** (2026-09-18): Unified Gemini 3.8 Flash Accounting

- Verdict: **PASS**
- Public contracts export normalized original variants and nearby intrinsic/custom names correctly. L1.

**020** (2026-09-18): Antigravity Usage Label

- Verdict: **PASS**
- Desktop visibly says Antigravity. Mobile presentation excluded by the developer October 12; no mobile PASS claimed. D1.

**021** (2026-09-19): Usage Model Names

- Verdict: **PASS**
- Public contracts export normalized original variants and nearby intrinsic/custom names correctly. L1.

**022** (2026-09-19): ChatLLM Usage Accounting

- Verdict: **FAIL**
- Controlled account counter rises 40 credits per turn, but first turn logs 3.36 and second 40. Summary is 43.36 instead of 80 credits. CHATLLM-USAGE-001; real driver and disk/summary path.

**023** (2026-09-19): Usage Breakdowns

- Verdict: **FAIL**
- Day provider cells include credit costs while Total excludes them. Repeat refresh reproduces it. USAGE-002, D4/Q1.

**024** (2026-09-19): Codex Credit Accounting

- Verdict: **PASS**
- Desktop balance and credit rows load; 25 credits converts to $1 through public export. No real spillover charge was induced. D1/D4/L1.

**025** (2026-09-19): Codex History Backfill

- Verdict: **PASS**
- Current ingestion scope accepted by the user October 12; exact old 1,334-credit total excluded. Public rescans of 354 usage-only rollouts are stable, duplicates do not inflate totals, and auto-review stays zero. Logging/history/effort continuation.

**026** (2026-09-19): Zed ACP Provider

- Verdict: **PASS**
- Current authenticated native Luna and Sonnet 5.5 turns complete through the source server, including read/terminal tools and a native child. Retired model names are not re-tested. Native-provider continuation.

**027** (2026-09-19): Zed Permission & Usage Fixes

- Verdict: **FAIL**
- Full access and supervised native approvals pass, but nonzero native session usage produces no ACP usage_update or T3 token update. Usage portion fails. ZED-CONTEXT-001.

**028** (2026-09-20): Zed Live-Test Gating

- Verdict: **Historical / not applicable**
- Test gating/runner maintenance has no product runtime behavior. Current opt-in hosted smoke remains skipped. T2.

**029** (2026-09-21): Zed Streaming Repair

- Verdict: **PASS**
- Real native file/terminal turn returns one intact assistant answer. Sonnet child search/read turn yields four T3 tool completions despite 60 native tool snapshots. Native-provider continuation.

**030** (2026-09-21): Zed Streaming Verification

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**031** (2026-09-21): Zed Approval Flow Verification

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**032** (2026-09-21): Zed Context Meter

- Verdict: **FAIL**
- Native session DB has nonzero token usage while the actual ACP wire contains zero usage_update messages. T3 receives no context usage. ZED-CONTEXT-001.

**033** (2026-09-21): Zed Account Usage

- Verdict: **PASS**
- Real desktop Limits shows Check the Zed dashboard with no zeroed or session-derived spend bar. D1. Billing endpoint access not retested.

**034** (2026-09-21): Zed Test Suite Migration

- Verdict: **Historical / not applicable**
- Test gating/runner maintenance has no product runtime behavior. Current opt-in hosted smoke remains skipped. T2.

**035** (2026-09-22): Performance Guardrail

- Verdict: **PASS**
- Public shared merge processed 20,000 buckets in 10.59 ms with 20,000 records, below 1,000 ms. Duplicate-environment adjacent probe passed. L1.

**036** (2026-09-22): Markdown Fast Path

- Verdict: **PASS**
- Real web runtime logs show delimiter-free messages return before preprocessing and invoke no math plugins. Math case invokes remark-math and KaTeX, renders powers/fraction/vector, and preserves currency/code literals. Temporary observation logs removed byte-for-byte. Zero-blocked continuation.

**037** (2026-09-22): Upstream Sync

- Verdict: **Historical / not applicable**
- Historical source-control merge, no independent runtime behavior. Preserve dated history.

**038** (2026-09-24): Mobile Usage Compatibility

- Verdict: **Historical / not applicable**
- Outside the current fork verification scope by developer instruction October 12. Mobile uses a third-party service unaffected by local server updates. No native-client runtime verdict.

**039** (2026-09-24): Mobile Usage Scope

- Verdict: **Historical / not applicable**
- Outside the current fork verification scope by developer instruction October 12. No native-client runtime verdict. Historical claim retained.

**040** (2026-09-27: Personal 0.0.42.2): Added thread MCP tools for cross-model and cross-provider handoffs

- Verdict: **PASS**
- Real MCP create_thread and read_thread complete an Antigravity-to-native-Zed handoff; native Gemini also spawns a Zed review worker and resumes after its report. Account/provider continuation.

**041** (2026-09-27: Personal 0.0.42.2): Added persisted flat workflows with child queues, durable reports, shared model budgets, parent wake and lifecycle controls

- Verdict: **PASS**
- Real backend queues, durable reports, shared budgets, parent wakes and restart passed earlier. Current web starts two workflows through controlled ACP/MCP; Pause -> paused, Resume -> active, Complete -> completed and Cancel -> cancelled. Completed five-child reports render delivered. Mobile excluded October 12. Separate defects remain in their own rows.

**042** (2026-09-27: Personal 0.0.42.2): Added named limits, price-band defaults, monthly model/pricing maintenance, and per-model overrides

- Verdict: **PASS**
- Previous-month policy refresh, named defaults, all price bands, overrides, active captured budgets and two-turn exhaustion/pause/resume/cancel passed through real MCP/WebSocket. Policy and budget continuations.

**043** (2026-09-27: Personal 0.0.42.2): Added provider worker restrictions and a companion Zed `--worker-mode` implementation

- Verdict: **PASS**
- Native Codex review starts read-only; native Claude omits write tools and rejects an injected Write; actual ChatLLM review rejects write_file. Review/edit MCP bridges reject five forbidden coordination tools each before HTTP forwarding. Earlier Antigravity guards and native Zed worker path also pass. Row 044 remains a separate edit-worker filesystem FAIL. Final-five continuation.

**044** (2026-09-27: Personal 0.0.42.2): Fixed review approval policy, write-tool enforcement, turn correlation, startup ordering, active-memory and cleanup guards

- Verdict: **FAIL**
- Actual ChatLLM edit worker rejects a direct outside path but write_file and edit_file follow a workspace symlink and modify an outside disposable fixture. CHATLLM-WRITE-001. Other lifecycle guards remain partly unverified.

**045** (2026-09-27: Personal 0.0.42.2): Verified ordinary desktop threads and a four-child Sol workflow with two Luna and two Gemini childre

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**046** (2026-09-27: Personal 0.0.42.2): Corrected completed workflow report labels in web and mobile

- Verdict: **PASS**
- Current web renders a real completed five-child workflow snapshot with five delivered report labels and zero reports waiting. Mobile excluded October 12. Evidence: workflow-completed.jpg in zero-blocked continuation.

**047** (2026-09-28: Personal 0.1.0): Added opt-in quota handoff for T3 orchestration layers with a 95% default threshold, ordered environ

- Verdict: **FAIL**
- Two real source-server/ChatLLM-driver runs enter waiting-reset at 96% with no eligible fallback, then the quota action's own interrupt changes it to paused and Canceled by user activity. No manual interrupt was sent. QUOTA-RESET-001; zero-blocked continuation. Ordered switch remains unverified.

**048** (2026-09-28: Personal 0.1.0): Simulated Luna XHigh at 95% and observed a linked Gemini child, source settlement, summary turn, and

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**049** (2026-09-28: Personal 0.1.0): Allowed Antigravity to parent a layer after the managed Gemini 3.8 Flash High runtime called T3's `r

- Verdict: **PASS**
- Authenticated managed Gemini calls read_thread/start_orchestration_layer with quota handoff enabled; unavailable Zed spend safely pauses that attempt. With handoff disabled, native Zed reports and Gemini resumes. Quota-triggered switching remains row 047.

**050** (2026-09-28: Personal 0.1.1): Prevented a parent from continuing coordination tool calls in the same turn after `wait_for_children

- Verdict: **PASS**
- Real parent MCP read after wait_for_children is rejected in the same active turn; later report wakes succeed. Workflow continuation.

**051** (2026-09-28: Personal 0.1.1): Allowed Antigravity review and edit children to call the scoped T3 report and read tools without an

- Verdict: **PASS**
- Fifteen native scoped MCP permissions auto-allowed for review/edit children; five unrelated native tools waited for explicit client decisions. Mixed-workflow continuation.

**052** (2026-09-28: Personal 0.1.1): Updated the Zed ACP worker tool names and permissions

- Verdict: **PASS**
- Native Zed --worker-mode review reads the detached fixture, calls scoped read_thread/report_to_parent, wakes its parent and emits the finished receipt. Parent completes through MCP. Account/provider continuation.

**053** (2026-09-28: Personal 0.1.1): Verified a live quota handoff from a Codex Luna child at 95% to a Gemini Flash High child

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**054** (2026-09-28: Personal 0.1.1): Set the web, desktop, and server package versions to 0.1.1 so About shows the release version

- Verdict: **Historical / not applicable**
- Historical 0.1.1 version alignment, superseded by 0.3.2. Current About reports 0.3.2. D2.

**055** (2026-10-05: Personal 0.1.2): Antigravity starts every model with full access on new sessions and resumes

- Verdict: **BLOCKED**
- Seven controlled variants use Full access on seven new and seven resumed sessions. Web offers only Full access for Antigravity and restores Codex Supervised after switching/reload. Desktop Codex Supervised is observed, but credential-free Antigravity has no selectable models. Desktop switching, running-turn and restart cases remain unproved. Mobile excluded.

**056** (2026-10-05: Personal 0.1.2): Removed model-name permission overrides from coordination policy

- Verdict: **FAIL**
- Public contracts helper still branches on model name: same Zed review/parent mode yields Full access for GPT and approval-required for Claude. Current guide corrected; historical claim contradicted. permissions-results.json.

**057** (2026-10-05: Personal 0.1.2): Two real Zed and Sonnet 5 probes created files in isolated workspaces with zero approval requests un

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**058** (2026-10-05: Personal 0.1.2): Kept the current Zed bridge after reviewing Delta's official docs

- Verdict: **Historical / not applicable**
- Historical decision to retain Zed rather than Delta, no runtime change to exercise. External rationale not re-researched.

**059** (2026-10-05: Personal 0.1.2): Focused verification passed 257 tests and scoped contracts, server, and mobile typechecks

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**060** (2026-10-05): Zed discovers its hosted catalog through the companion bridge's `--list-models` command using existi

- Verdict: **PASS**
- Authenticated --list-models through the real provider refresh selects newest Sonnet 5.5 and GPT-6 Luna with effort choices, preserves custom entries and retains inventory on same-lifetime discovery failure. Restart separately fails in 074.

**061** (2026-10-05): Verified 27 focused tests, with one hosted smoke test skipped, server typechecking, targeted lint, b

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**062** (2026-10-05): Rebuilt Personal 0.1.2 for macOS arm64 in an isolated checkout

- Verdict: **Historical / not applicable**
- Historical packaging/dependency/scope or issue bookkeeping. No independent runtime behavior; current open work is in ISSUE_TRACKER.

**063** (2026-10-06: Personal 0.1.3): Fixed the companion Zed bridge crash when native tools call `search_web` by initializing the headles

- Verdict: **PASS**
- Current native Sonnet child executes search_web, returns five real results, and parent finishes without a bridge crash. Native wire and T3 tool completions retained. Account/provider continuation.

**064** (2026-10-06: Personal 0.1.3): Forwarded native subagent tool updates and approvals, including approvals already waiting when a chi

- Verdict: **PASS**
- Earlier native Sonnet child tools and two approvals reached the client with distinct IDs and preserved parent text. Compiled companion bridge now passes seven focused regressions, including approvals already waiting at child attachment and nested-child attachment, with permission answers delivered to the requesting native thread. These timing cases use controlled GPUI threads, not fresh hosted-model inference.

**065** (2026-10-06: Personal 0.1.3): Kept tool titles, inputs, output, content, and locations current as calls stream

- Verdict: **PASS**
- Actual native child search, terminal and parent read update partial inputs to final titles/inputs/results; four completions survive 60 snapshots without duplicate completion activity. Parent reply remains intact.

**066** (2026-10-06: Personal 0.1.3): Seven bridge tests passed, including the startup, permission, nested-child, and streamed-tool regres

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**067** (2026-10-06: Personal 0.1.3): Requires companion Zed commit `317b394ae4` on `integration/zed-abacus`

- Verdict: **Historical / not applicable**
- Historical packaging/dependency/scope or issue bookkeeping. No independent runtime behavior; current open work is in ISSUE_TRACKER.

**068** (2026-10-06: Personal 0.1.3): Published the macOS arm64 DMG and ZIP, reinstalled Personal, and confirmed About reports `0.1.3 (39d

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**069** (2026-10-06: Personal 0.1.4): Fixed repeated macOS Documents permission requests after installing a new Personal build

- Verdict: **PASS**
- Actual Documents grant survives replacing a disposable native app signed twice by the fork persistent signing helper. TCC records first prompt/allow and replacement allow without a prompt; version-two fixture read succeeds. Installed T3 app untouched. Native grant evidence in /private/tmp/t3-zero-macos-20261012.

**070** (2026-10-06: Personal 0.1.4): Automatic Keychain requests no longer interrupt launch with password dialogs

- Verdict: **PASS**
- Current normal-launch scope accepted by the developer October 12: launching the app no longer requires a Keychain password. Earlier isolated desktop launches also showed no password dialog. The developer excluded the adverse locked/old-Keychain experiment as unnecessary; no PASS for that condition.

**071** (2026-10-06: Personal 0.1.4): Installed the repaired app and verified two normal launches with existing projects and threads

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**072** (2026-10-06: Personal 0.1.4): This patch excludes pending Antigravity changes

- Verdict: **Historical / not applicable**
- Historical packaging/dependency/scope or issue bookkeeping. No independent runtime behavior; current open work is in ISSUE_TRACKER.

**073** (2026-10-06: Personal 0.1.5): Antigravity native task results now appear in the work trace without ending the active prompt

- Verdict: **PASS**
- Controlled native ACP task notification persisted task.completed while ordinary/foreign text continued to final response. ACP continuation; no live Google inference.

**074** (2026-10-06: Personal 0.1.5): Zed catalog refresh removes retired built-in models while preserving custom settings

- Verdict: **FAIL**
- After authenticated discovery populates disk cache, restart with unchanged settings and failed discovery restores Sonnet 5/GPT-5.6 Luna seeds. Custom entry survives. ZED-CATALOG-001; two runtime reproductions.

**075** (2026-10-06: Personal 0.1.5): ACP provider errors include transport details, including the explanation when an agent ignores cance

- Verdict: **PASS**
- Controlled native error details and ignored-cancel explanation survive the real server after the working-tree transport fix. Retry passed. ACP continuation.

**076** (2026-10-06: Personal 0.1.5): Verified seven probes through a real isolated server and WebSocket client using controlled ACP execu

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**077** (2026-10-06: Personal 0.1.5): Recorded the separate open issue for orchestration requesting access to unrelated macOS folders

- Verdict: **Historical / not applicable**
- Historical packaging/dependency/scope or issue bookkeeping. No independent runtime behavior; current open work is in ISSUE_TRACKER.

**078** (2026-10-06: Personal 0.2.0): Zed thinking effort

- Verdict: **PASS**
- Isolated desktop chooses native effort values. Luna Low reaches native storage and survives reopening. Sonnet retains Low; Sonnet Max to Luna restores Medium and survives reload. Native follow-up confirms Medium. Logging/history/effort continuation.

**079** (2026-10-06: Personal 0.2.0): Verification

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**080** (2026-10-08: Personal 0.3.0): Added account-discovered Claude Opus 5.5 and Sonnet 5.5 low, medium and high variants alongside Gemi

- Verdict: **PASS**
- Authenticated account discovers all six Claude effort variants alongside Gemini; native Sonnet Low and Gemini High turns return the marker and priced usage. Account/provider continuation.

**081** (2026-10-08: Personal 0.3.0): Kept the six Claude variants current after upstream catalog refreshes without adding models absent f

- Verdict: **PASS**
- Real account refresh retains all six current Claude variants. Controlled sparse account catalog supplies Opus Low only; absent Sonnet and Opus Medium are not invented. Account/provider continuation.

**082** (2026-10-08: Personal 0.3.0): The isolated release snapshot passed 167 focused tests, server typechecking, scoped lint and formatt

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**083** (2026-10-08: Personal 0.3.0): Installed Personal 0.3.0 and updated its managed runtime through Settings

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**084** (2026-10-08: Personal 0.3.1): HTML file links open in the system browser by default

- Verdict: **BLOCKED**
- Fresh web primary HTML opens a separate served page and renders the marker. Desktop primary HTML opens Safari Work and renders its owning-server asset. Desktop PDF stays integrated and renders FINAL_FIVE_PDF_OK. Web PDF panel routing passes. Cross-environment client routing remains unverified; focused origin tests alone do not close it. Final-five continuation.

**085** (2026-10-08: Personal 0.3.1): Aligned KaTeX markup and styles at 0.18.7 to fix overlapping vector accents

- Verdict: **PASS**
- KaTeX 0.18.7 dependency/lockfile alignment confirmed; desktop vectors, hat, roots, fractions and styled wrappers render correctly. Rendering continuation.

**086** (2026-10-08: Personal 0.3.1): Provider commands process up to four threads concurrently while preserving command order within each

- Verdict: **PASS**
- Five real thread startups reach four concurrent authentication calls; fifth waits for a release. Public worker export preserves 100 ordered commands across five keys and drains. Concurrency continuation.

**087** (2026-10-08: Personal 0.3.1): ACP errors retain the native operation and bounded, sanitized text details

- Verdict: **PASS**
- Working-tree fix preserves native session/prompt and bounded 4 KiB sanitized details through real WebSocket events. Bearer redaction and oversized detail passed. ACP continuation.

**088** (2026-10-08: Personal 0.3.1): Fixed excessive regex backtracking when Antigravity emits an incomplete task notification followed b

- Verdict: **PASS**
- Real server completed incomplete native task notification with 16,000 spaces and preserved following final text. Controlled ACP continuation.

**089** (2026-10-08: Personal 0.3.1): All 297 focused tests passed

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

**090** (2026-10-11: Personal 0.3.2): The Usage breakdown combines reasoning-effort and thinking variants of each model

- Verdict: **PASS**
- Public normalization/merge combines Sonnet and Opus efforts and Pro alias; custom/intrinsic names stay distinct. Desktop model view loads. L1/D4.

**091** (2026-10-11: Personal 0.3.2): Updated the API-equivalent pricing reference from official OpenAI, Anthropic and Google sources

- Verdict: **PASS**
- All 14 official keys match published base rates. Real WebSocket summary prices four token classes ahead of conflicting catalog rates and repeats stably. Existing probes cover overrides/reported costs. Gemini creation at input rate is a documented Cloud policy and Developer API assumption; storage excluded. Zero-blocked continuation evidence.

**092** (2026-10-11: Personal 0.3.2): Effort-specific custom prices apply before rows combine, preserving their individual costs

- Verdict: **PASS**
- Real WebSocket summary combines exact Low $7 and base High $3 into $10. Editing Low yields $12; deleting overrides yields official $4. Public client merge preserves the priced sum. Pricing continuation.

**093** (2026-10-11: Personal 0.3.2): All 85 focused tests, contracts/shared/server typechecks, scoped lint and formatting passed

- Verdict: **Historical / not applicable**
- Dated verification/release record, not a new feature claim. Current checks and their limits are recorded separately; old exact runs were not replayed.

## Coverage still needed

Native iOS/Android, hosted web, remote/relay/tunnel, multiple environments,
live `delegate_task` budgets and review snapshots, live quota fallback and
upstream reset recovery, and fresh authenticated ChatLLM/Zed/Antigravity turns are not
established by this pass. Backend tests and desktop rendering cannot substitute
for those checks. Original historical backfill totals were not remeasured.
Stable signing across reinstall, inaccessible Keychain recovery and original
slow auto-pull startup also remain unverified.

The latest earlier desktop/Zed runtime record is October 11 against 0.3.1 in
/private/tmp/t3-verify-desktop-zed-20261011/REPORT.md (local evidence, not preserved in repo). Its Full access,
Supervised approval, persistence and delayed-start results were retained as
historical evidence rather than counted as fresh 0.3.2 checks.
