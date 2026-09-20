# Issue tracker

Updated September 19, 2026.

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

Status: Implemented, pending live-client verification

The composer now shows a circular context-window meter when a provider reports
the current context token count. The meter shows the used share of the model's
context window and exposes the token counts on hover.

The server converts Codex, Claude, and Zed runtime usage events into the shared
`context-window.updated` activity. Zed ACP `usage_update` reports `used` and
`size`, so it can feed the meter without being treated as billing data.

The meter is enabled by default. Users can turn it off in Settings under
Legacy features. Providers that do not report context usage do not reserve a
meter slot.
