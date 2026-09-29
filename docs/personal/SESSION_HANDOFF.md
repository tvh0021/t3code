# Handoff: Personal workflow release and remaining provider checks

Updated September 28, 2026. The isolated desktop pass verified an ordinary Sol
thread and a four-child workflow with two Luna and two Gemini children. All four
reported findings, and the parent repaired a fixture that then passed 10/10
tests. A live Gemini parent completed a Codex-to-Gemini quota handoff. A Zed
Luna child reported through T3 after rebuilding the worker binary. Mobile,
remote, and Zed parent checks remain open.

## Intent and settled decisions

`$session-handoff` could not create T3 threads. The task expanded to cross-model
handoffs and T3 orchestration layers for verification and improvement.
Reports must persist while parents are busy, resume idle parents without
steering, and respect pending human requests. Any supported model may parent.

- Exactly one T3 parent-child layer. Four concurrent children; overflow persists.
- Provider-native subagents are allowed. They cannot start nested T3 orchestration layers
  or create T3 child threads from a workflow child, so those calls cannot reset
  the shared model budget.
- A round is an automatic provider turn start. Initial user planning is excluded.
  Canonical-model counters are shared across the parent, children and aliases.
- Astra 1, Sol 2, Luna/Gemini 3.8 Flash unlimited; Sonnet 5, Opus 5.5 and Fable
  5.1 each 1; GLM 5.3 Flash unlimited. Unlimited does not mean free.
- Other output prices per million tokens: above $10 gives 1; below $1 gives
  unlimited; $1 through $10 gives 4. Unpriced models need overrides. Monthly
  maintenance preserves named/user overrides and active session budgets.
- Pause/resume retain counters. Complete retains late reports. Cancel interrupts
  owned children. Manual parent messages pause coordination. Restart pauses
  workflows before reconciling stored completions, without replaying paid work.
- Reviews use detached checkouts of resolved Git commits. Editing children use
  separate existing registered worktrees; the parent integrates changes.

[Capabilities](./MODIFICATIONS.md#21-agent-created-threads-and-t3-orchestration-layers),
[invocation example](../user/composer.md#start-a-t3-orchestration-layer), and
[open issues](./ISSUE_TRACKER.md#open-issues) carry the current details.

## Latest work

The desktop pass used `vp run dev:desktop` against isolated state under
`/private/tmp/t3-desktop-verify-NYBzEP`. Its evidence summary is
`verification.md` in that directory. A shared turn-start command ID initially
started only one child; assigning each child a distinct ID fixed provider
launch. Completed workflow report counts and labels were also corrected.
The focused coordination suite passed 13/13; targeted lint and formatting
passed. Server, client-runtime and mobile typechecks passed; web retains HAST
dependency type errors. The dev desktop process was stopped after screenshots.

Added durable terminal observations and late-receipt reconciliation. Tests cover
lost starts, completion before acceptance, stale exits, runtime errors, restart
recovery and cleanup after a completed parent's child disconnects. Binding uses
receipt time. Parent sessions restart after workflow completion.

Reviews now read detached commit snapshots. Spawn failures roll back snapshots;
thread deletion removes them, and hourly storage cleanup recovers orphaned UUID
directories after a grace period. Referenced active/archived snapshots remain for
inspection. Cleanup skips noncanonical roots, including symlink ancestors.
ChatLLM reads/listing are confined by realpath, and children cannot read parent
or sibling thread histories.

Codex and Claude retain provider-native subagents in workflow turns; T3 handlers
reject nested workflow creation and child assignment. The managed Antigravity
runtime now has live evidence of T3 MCP tool use and parent startup. Its child
role remains supported. The earlier authenticated=false blocker was specific
to that isolated server and is superseded by the September 28 dev check.

ChatLLM exposes scoped T3 coordination tools through its own tool loop. The
bridge is tested against the real MCP HTTP protocol. Zed forwards the scoped
HTTP server through ACP and explicitly allows only coordination tools in worker
profiles. Parent startup requires both `t3WorkerPolicy` and `t3ThreadTools`
metadata. A rebuilt Zed worker completed a Luna child report. Zed parent tool
discovery and startup remain unverified. Codex/Claude review profiles prevent
writes, not all host-file reads.

The old GPT 5.6 Sol/high reviewer was stopped after the user corrected its cost.
**Use GPT 6 Sol at low reasoning for audit-trail reviews.** Its source review
found no further actionable bug; native discovery and UI proof remain caveats.

On September 28, a runtime probe drove the quota reactor, the persisted
orchestration engine, and real SQLite projections with simulated provider
readings. A Luna XHigh child at 95% routed to Gemini 3.8 Flash High; after
settlement, the new child received partial edit context. The engine started a
summary turn, and the probe supplied summary text to inspect the continuation
prompt. A known reset with a fresh 12% Luna reading created a
new Luna child. The probe caught lost XHigh options and stale reset details;
both were fixed. The browser showed the 95% setting and Luna-to-Gemini mapping.
The probe did not spend quota or run a destination provider turn.

The managed Antigravity runtime called `read_thread` and
`start_orchestration_layer` in an isolated dev thread. A later live run hit
Codex Luna's 95% secondary quota, switched the child to Gemini 3.8 Flash High,
recorded its report, resumed the parent, and completed the layer. The Gemini
child's T3 report tool did not request approval. Its read-only Git review
commands still required approval.

The same run found that Gemini could continue using T3 tools after
`wait_for_children` in the same turn. T3 now records the waiting turn and
rejects its later coordination calls. The companion Zed worker had stale tool
names and did not accept `--worker-mode`; after rebuilding it, a Codex parent
completed a Zed Luna review child. Zed parent startup remains unverified.

## Final evidence

| Earlier evidence under `/private/tmp/`                           | Result                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `t3-workflow-resumed-final-tests.log`                            | 219 tests passed, 12 focused backend files.                                                |
| `t3-workflow-resumed-client-tests.log`                           | Six client interaction/parser tests passed.                                                |
| `t3-workflow-mcp-http-integration.log`                           | Real MCP HTTP discovery/call passed.                                                       |
| `t3-workflow-resumed-final-lint.log`                             | Scoped lint passed, 79 warnings.                                                           |
| `t3-workflow-final-*-types.log`                                  | Server, mobile, contracts and client-runtime passed; web retains 11 unrelated HAST errors. |
| `t3-workflow-zed-mcp-check.log`                                  | Offline `cargo check -p eval_cli --bin zed-acp-server` passed.                             |
| `t3-thread-preview-20260926-3oq989rq/workflow-smoke-resumed.log` | Real Sol/Luna workflow passed; one automatic turn each.                                    |

Earlier Sol/Luna native parent: `586d27f9-f8f7-42b6-95ab-affb4b1f1df1`; child:
`a967d723-e542-4e65-a91a-e31b07dab3ab`. `workflow-smoke.json` contains their
final state. Earlier failing logs are superseded; do not add overlapping counts.

September 28 quota evidence is in
`apps/server/.t3/verify/quota-output.log`. The live Gemini parent is in the
worktree's `.t3/userdata/state.sqlite` under thread
`b8e7cb97-81e5-4075-828c-590a2f40a2e5`. Both are isolated development
state. Do not use the copied provider credentials or pairing URL as public
evidence.

## Remaining verification and capability gaps

1. Mobile UI, command-palette actions, remote and multiple-environment flows.
   Desktop child roster, reports and completion were inspected with Computer Use.
2. Verify Zed as an orchestration parent, including native MCP discovery and
   parent tool use. The child path and report passed with a rebuilt worker.
3. Test Gemini as the parent of a quota handoff. Older or custom binaries have
   not been checked for MCP forwarding. Cursor, Grok, and OpenCode remain
   unavailable for workflows.
4. Exercise live quota threshold crossing during a running provider turn.
   Confirm interruption, the linked Gemini summary and continuation, the
   one-switch limit, and manual cancellation. The 95% probe simulated provider
   readings and settled the source in the harness.
5. Exercise a timed reset after no fallback qualifies. Confirm that a fresh
   under-threshold reading wakes a new Luna XHigh thread, while an unknown
   reset leaves a visible pause reason. The 12% probe started from a stored
   waiting state with an elapsed reset time.
6. Resolve the unrelated web HAST dependency errors separately.

## Environment and constraints

- T3 checkout `/Users/tvh0021/git_repos/t3code-dev`, branch `feat/zed-integration`;
  companion checkout `/Users/tvh0021/git_repos/zed-dev`.
- September 28 verification used the worktree's ignored `.t3` state with
  `vp run dev`. The dev runner reported web port `7942` and server port `15982`.
  The built-in Browser panel used one task tab. Recheck server health and
  ownership before reuse.
- The earlier September 26 pass used isolated state
  `/private/tmp/t3-thread-preview-20260926-3oq989rq` and Git fixture
  `workflow-workspace`. Its private log `dev-resumed-no-browser.log` can contain
  startup credentials; never print it wholesale or expose pairing URLs.
- Decision trail `/private/tmp/t3-coordination-decisions.tsv`. Append corrections;
  do not search unrelated private transcripts or reuse the expensive reviewer.
- Keep live `~/.t3/userdata` untouched. The Personal app uses
  `~/.t3-personal/userdata`; preserve its ChatLLM secret when reinstalling.
  Never bake dev origins with `VITE_HTTP_URL`/`VITE_WS_URL`. Stop only owned
  retained sessions/PIDs.
- Safari: Work profile only, reuse one task tab, never add tabs, close finished
  task tabs and preserve unrelated tabs. No Safari tabs were opened this run.
- Preserve unrelated desktop edits, DMG artwork and the Zed README review marker.
  Use focused checks only; no repo-wide tests/builds or unrelated cleanup.

The earlier Codex usage reconciliation and separate
[Zed billing issue](./ISSUE_TRACKER.md#zed-001-read-zed-account-usage-from-the-billing-service)
remain recorded in the personal changelog. Session cost must not substitute for
account-wide Zed spend.
