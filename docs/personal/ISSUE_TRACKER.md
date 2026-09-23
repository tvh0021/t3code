# Issue tracker

Updated September 22, 2026.

## ZED-001: Read Zed account usage from the billing service

Status: Blocked by Zed billing authentication.

The Zed entry in Limits must show the account's actual spend for the current
Zed billing period. It must not estimate account spend from one or more T3
sessions.

### Observed behavior

The previous implementation built a `$10` monthly bar from ACP
`usage_update.cost` values. ACP reports cumulative cost for one session. It does
not report the account total shown by `dashboard.zed.dev`. A fresh provider
snapshot also showed `$0 / $10` before any session reported a cost.

### Why the usage tracker does not work

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

### Billing response details

The organization dashboard reads
`/frontend/organizations/{id}/billing/usage` and
`/frontend/organizations/{id}/subscription`. The older account routes are
`/frontend/billing/usage` and `/frontend/billing/subscriptions/current`.
The organization usage response contains
`current_usage.token_spend.spend_in_cents`, `limit_in_cents`, and `updated_at`.
Any future implementation must preserve organization scope and use the billing
period from the same account.

### Implemented behavior

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

### Remaining work

1. Obtain a Zed billing API that accepts native credentials, or design an
   explicit dashboard sign-in integration. A local bridge change cannot grant
   access to Zed's hosted billing service.
2. Add a server-side provider read with explicit loading, failure, and stale
   data behavior.
3. Use the returned billing-period end time for the reset date.

Until that work lands, T3 reports Zed account spend as unavailable. It does not
publish a zeroed bar, and ACP session cost is never labeled as account spend.

### Acceptance criteria

- The displayed amount matches the value from the supported Zed billing
  response.
- The reset date comes from the same response.
- The UI identifies the value as account spend and shows when it was checked.
- Missing authentication or an unavailable endpoint produces an explicit
  unavailable state, not a zeroed bar.
- Tests cover account scope, billing-period boundaries, failed reads, and
  repeated cumulative session updates.

## CHAT-002: Show context-window usage in the composer

Status: Reopened September 22, 2026 after desktop verification.

The composer now shows a circular context-window meter when a provider reports
the current context token count. The meter shows the used share of the model's
context window and exposes the token counts on hover.

The server converts provider usage events into the shared
`context-window.updated` activity. The Zed bridge now forwards real context
token usage, and the adapter maps the ACP `usage_update` fields `used` and
`size` to the shared context-window meter. Billing cost and character estimates
remain separate from context usage.

Live verification in T3 Code - Personal 0.0.42 found no context meter after
three completed turns using Zed's `zed.dev/gpt-5.6-luna`. The meter was also
absent after navigating away and reopening the thread. The composer showed
the model, Full access, attachment, and send controls, with no context count.

Reproduction thread: `46981a74-b5c1-4a15-804f-44eb30d8ec00`, titled `ZED_OK`.
Send `Reply only: ZED_OK. Do not use tools.`, then a short follow-up. Inspect
the composer after completion and after reopening the thread.

The configured bridge is `zed-dev/target/debug/zed-acp-server`, reported as
v0.1.0. Its build freshness and emitted usage events were not verified. Check
whether this running binary emits `usage_update`, then trace delivery to the
composer. The UI observation does not establish which component is responsible.

Acceptance: a completed Luna turn supplies a visible context meter with real
used and total token counts, including after navigating back to the thread.

## ZED-003: Full access still blocks a read-only command for approval

Status: Open. Observed September 22, 2026 in T3 Code - Personal 0.0.42.

In thread `46981a74-b5c1-4a15-804f-44eb30d8ec00`, select Zed GPT-5.6 Luna
with Full access and send `Run pwd once. Reply with only the directory name.`
The thread enters Approval, shows a Command approval card for `pwd`, and
replaces the composer with `Resolve this approval request to continue`.
Approving the command succeeds and produces `t3code-dev`. Full access remains
selected afterward.

The displayed permission mode does not match the effective behavior.
`ZedAdapter.ts` stores `input.runtimeMode` on the session, but its permission
callback always opens a request and waits for a decision. The adapter does not
otherwise reference `runtimeMode`.

Acceptance: map supported permission modes to Zed's actual behavior, or clearly
show the provider's limitation instead of presenting an ineffective Full access
mode. Verify approval-required behavior separately. Do not bypass permissions
merely to hide the mismatch.

## ZED-004: Completed Zed turns are absent from the usage summary

Status: Open investigation. Observed September 22, 2026.

After the three successful Luna turns in the `ZED_OK` thread, open Usage and
select Tokens with the 90-day period and All environments. The provider summary
lists Codex, Antigravity, and ChatLLM, but no Zed. No Zed entry explains whether
its session usage is unavailable or still loading. The Limits view does show
Zed's dashboard link, so Zed is present elsewhere in Usage.

This concerns session usage visibility, separate from ZED-001's account billing
authentication. No claim is made that ACP supplies itemized token totals or
that its session cost equals account spend. Investigate available bridge events
and the summary's provider coverage before choosing a fix.

Acceptance: show supported Zed session usage, or explicitly identify unavailable
metrics. Keep session usage separate from account limits.

## Desktop verification scope, September 22, 2026

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

## CHATLLM-001: The running desktop server does not refresh its model list

Status: Fix built September 22, 2026. Desktop restart and UI verification remain.

The worktree's desktop server showed seven fixed ChatLLM models after a manual
refresh and omitted `gpt-6-sol` and `gpt-6-luna`. Its running server bundle was
built before the model updater. The older ChatLLM driver contained those seven
models and had no `refreshModels` handler, so the refresh request could report
"Checked just now" without updating ChatLLM.

The RouteLLM `/v1/models` endpoint returned both missing IDs for the configured
API key. The current driver reads that endpoint on manual refresh and checks it
weekly while the server runs. It keeps the previous list if the request fails.
The worktree's desktop and server bundles were rebuilt, but the running desktop
server has not been restarted. After restarting, refresh the provider list and
confirm that both IDs appear in Settings and the model picker.
