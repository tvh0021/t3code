# Personal fork notes

This folder records the changes to the personal T3 Code fork. The latest
recorded release is Personal 0.3.2.

- [Verification record](./VERIFICATION.md) is the canonical record of the latest
  audit, per-item verdicts, revisions, evidence and missing coverage. The latest
  audit was October 11, 2026. A complete cross-client/provider runtime test date
  has not been established.
- [Issue tracker](./ISSUE_TRACKER.md) owns open defects, accepted limitations and
  pending verification. Resolved entries describe only the behavior verified.
- [Changelog](./CHANGELOG.md) preserves dated changes and release evidence.
  Historical limitations may have been superseded by a later entry.
- [Modifications](./MODIFICATIONS.md) describes the current fork behavior and
  constraints without duplicating release test counts.
- [Session handoff](./SESSION_HANDOFF.md) retains historical workflow and provider
  investigation evidence. Its dated state is not current release status.
- [Provider allowance benchmark](./PROVIDER_USAGE_TRACKING.md) preserves the
  September 18 measurements and the rates used then.
- [Upstream sync guide](./UPSTREAM_SYNC.md) describes maintainer sync procedures.

Use `vp run dev:desktop` for desktop development with isolated worktree state.
Follow the root `AGENTS.md` and the client verification skill before runtime
checks. Never start a verification server against live user data. Run only the
focused checks relevant to the changed behavior.

Mobile verification is outside this fork's scope. Follow the
[mobile verification restriction](../../AGENTS.md#verifying); a local fork update
does not deploy server changes to the mobile app's third-party service.
