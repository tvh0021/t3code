# T3 Code Personal

A personal fork of [T3 Code](https://github.com/pingdotgg/t3code) with two extra
providers and deeper usage tracking. It merges upstream regularly; the last sync
was October 17, 2026 (upstream `a7025639c0`).

## Why use it

- **Two more providers.** ChatLLM (Abacus RouteLLM), with its own tool loop, and
  Zed's hosted models through a headless Zed bridge.
- **Usage that shows what your subscriptions are worth.** API-equivalent cost
  for every provider, Codex and ChatLLM credits, an All time view, and Codex
  history including compressed and archived sessions.
- **More in Limits.** Both Antigravity pools (Gemini, and Claude & GPT),
  ChatLLM compute points, and Zed account spend.
- **Quota handoff.** A thread that hits its usage limit continues on the first
  fallback model with quota left (95% threshold by default).
- **Delegation limits.** Per-model limits on how many times an agent may
  resubmit the same child task, and delegated reviews of a chosen commit.
- **LaTeX math and larger default fonts.**

## Install

Download the DMG or ZIP from
[Releases](https://github.com/tvh0021/t3code/releases). Before installing:

- Releases are macOS Apple Silicon only. On other platforms, build from source
  as described in upstream's [development guide](../operations/development.md).
- Builds are signed with a personal identity and are not notarized by Apple.
  The first launch is blocked; allow it in System Settings > Privacy & Security.
- Zed needs `zed-acp-server` from a
  [tvh0021/zed release](https://github.com/tvh0021/zed/releases) (0.2.1 or
  later), or built from that fork's `main`. Set its path as the Zed provider's
  binary path.
- The App Store phone app works with this host, but its Usage tab leaves out
  ChatLLM.

## Notes

- [Changelog](./CHANGELOG.md): what changed in each release.
- [Issue tracker](./ISSUE_TRACKER.md): open issues, known limitations and
  resolved issues.
- [Modifications](./MODIFICATIONS.md): how each fork feature works and why.
- [Provider usage benchmark](./PROVIDER_USAGE_TRACKING.md): measured value of
  each subscription.
