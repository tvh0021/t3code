# Issue tracker

Updated September 21, 2026.

## ZED-001: Read Zed account usage from the billing service

Status: Open

The Zed entry in Limits must show the account's actual spend for the current
Zed billing period. It must not estimate account spend from one or more T3
sessions.

### Observed behavior

The previous implementation built a `$10` monthly bar from ACP
`usage_update.cost` values. ACP reports cumulative cost for one session. It does
not report the account total shown by `dashboard.zed.dev`. A fresh provider
snapshot also showed `$0 / $10` before any session reported a cost.

### Required work

1. Identify the supported Zed billing or dashboard endpoint.
2. Determine how the endpoint authenticates without copying a browser-only
   cookie into server state.
3. Confirm whether the response is account-wide and which billing period it
   covers.
4. Add a server-side provider read with explicit loading, failure, and stale
   data behavior.
5. Use the returned billing-period end time for the reset date.

Until that work lands, T3 does not publish a Zed account usage bar. ACP session
cost must not be labeled as account spend.

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

Status: Open for Zed, live-client verification failed September 21, 2026

The composer now shows a circular context-window meter when a provider reports
the current context token count. The meter shows the used share of the model's
context window and exposes the token counts on hover.

The server converts provider usage events into the shared
`context-window.updated` activity. The Zed adapter accepts ACP `usage_update`
with `used` and `size`, but the current headless Zed bridge does not emit it.

Enable the meter in Settings under Legacy features. The isolated browser
initially had it disabled. After enabling it and completing a real
`zed.dev/gpt-5.6-luna` turn, the meter was absent and the thread had zero
context-usage activities.

Forward real context usage from the headless Zed ACP bridge, rebuild that
binary, and verify the displayed token count and capacity in the client.
Do not substitute billing cost or character estimates for context tokens.
