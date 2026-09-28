# Handoff: Personal workflow release and remaining provider checks

Updated September 27, 2026. An isolated desktop pass verified an ordinary Sol
thread and a four-child workflow with two Luna and two Gemini children. All four
reported findings, and the parent repaired a fixture that then passed 10/10
tests. Mobile/remote checks and Zed native MCP discovery remain open.

## Intent and settled decisions

`$session-handoff` could not create T3 threads. The task expanded to cross-model
handoffs and flat parent-child workflows for verification and improvement.
Reports must persist while parents are busy, resume idle parents without
steering, and respect pending human requests. Any supported model may parent.

- Exactly one T3 parent-child layer. Four concurrent children; overflow persists.
- Provider-native subagents are allowed. They cannot start nested T3 workflows
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

[Capabilities](./MODIFICATIONS.md#21-agent-created-threads-and-flat-workflows),
[invocation example](../user/composer.md#coordinate-child-threads), and
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
reject nested workflow creation and child assignment. Antigravity is enabled
as a workflow child, while parent use still requires T3 tool forwarding.
The focused workflow/policy suite passes 203 tests. The Luna-parent/Gemini-child
runtime check is blocked for now because the isolated server reports
authenticated=false. Repo instructions require user approval before
desktop/browser pairing. See /private/tmp/t3-workflow-antigravity-runtime-status.txt.

ChatLLM exposes scoped T3 coordination tools through its own tool loop. The
bridge is tested against the real MCP HTTP protocol. Zed forwards the scoped
HTTP server through ACP and explicitly allows only coordination tools in worker
profiles. Parent startup requires both `t3WorkerPolicy` and `t3ThreadTools`
metadata. The companion source compiles; native discovery is not yet verified.
Codex/Claude review profiles prevent writes, not all host-file reads.

The old GPT 5.6 Sol/high reviewer was stopped after the user corrected its cost.
**Use GPT 6 Sol at low reasoning for audit-trail reviews.** Its source review
found no further actionable bug; native discovery and UI proof remain caveats.

## Final evidence

| Evidence under `/private/tmp/`                                   | Result                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `t3-workflow-resumed-final-tests.log`                            | 219 tests passed, 12 focused backend files.                                                |
| `t3-workflow-resumed-client-tests.log`                           | Six client interaction/parser tests passed.                                                |
| `t3-workflow-mcp-http-integration.log`                           | Real MCP HTTP discovery/call passed.                                                       |
| `t3-workflow-resumed-final-lint.log`                             | Scoped lint passed, 79 warnings.                                                           |
| `t3-workflow-final-*-types.log`                                  | Server, mobile, contracts and client-runtime passed; web retains 11 unrelated HAST errors. |
| `t3-workflow-zed-mcp-check.log`                                  | Offline `cargo check -p eval_cli --bin zed-acp-server` passed.                             |
| `t3-thread-preview-20260926-3oq989rq/workflow-smoke-resumed.log` | Real Sol/Luna workflow passed; one automatic turn each.                                    |

Latest native parent: `586d27f9-f8f7-42b6-95ab-affb4b1f1df1`; child:
`a967d723-e542-4e65-a91a-e31b07dab3ab`. `workflow-smoke.json` contains their
final state. Earlier failing logs are superseded; do not add overlapping counts.

## Remaining verification and capability gaps

1. Mobile UI, command-palette actions, remote and multiple-environment flows.
   Desktop child roster, reports and completion were inspected with Computer Use.
2. Build a separate worker-aware Zed binary and prove native MCP discovery,
   parent tool use and child reporting. Do not replace the installed binary.
3. Antigravity can run as a child, but cannot parent until its ACP adapter forwards
   T3 workflow tools. Cursor, Grok and OpenCode remain unavailable for workflows.
   Model entries do not prove provider support.
4. Resolve the unrelated web HAST dependency errors separately. The user has
   authorized a personal source release, DMG rebuild and reinstall.

## Environment and constraints

- T3 checkout `/Users/tvh0021/git_repos/t3code-dev`, branch `feat/zed-integration`;
  companion checkout `/Users/tvh0021/git_repos/zed-dev`.
- Isolated state `/private/tmp/t3-thread-preview-20260926-3oq989rq`; Git fixture
  `workflow-workspace`. Dev web `http://localhost:7942`, backend `15982`.
  Owned exec session `25385`; recheck health and ownership before reuse.
- Dev command: `vp run dev --home-dir /private/tmp/t3-thread-preview-20260926-3oq989rq`.
  No browser flag. Private log `dev-resumed-no-browser.log` can contain startup
  credentials; never print it wholesale or expose consumed pairing URLs.
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
