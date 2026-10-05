# Personal Fork of T3 Code

This folder documents the changes, features, and architecture decisions that distinguish this personal fork from the upstream [pingdotgg/t3code](https://github.com/pingdotgg/t3code) repository.

---

## Table of Contents

- [Overview](#overview)
- [Key Modifications](#key-modifications)
  - [1. Branding & Header Typography](#1-branding--header-typography)
  - [2. Default Font Sizes & Typography](#2-default-font-sizes--typography)
  - [3. Abacus AI (RouteLLM) Agentic Provider](#3-abacus-ai-routellm-agentic-provider)
  - [4. Agent-created threads and workflows](#4-agent-created-threads-and-workflows)
  - [5. Antigravity full access](#5-antigravity-full-access)
- [Project Documentation](#project-documentation)
- [Development & Verification](#development--verification)

---

## Overview

- **Base Repository**: `https://github.com/pingdotgg/t3code`
- **Active Branch**: `feat/zed-integration`
- **Core Goal**: Maintain a personalized, powerful engineering harness in T3 Code that includes:
  - Custom visual identity and layout tweaks.
  - Personalized font and readability defaults configured out-of-the-box.
  - RouteLLM / Abacus AI integrated not just as a simple text completion bot, but as a fully autonomous software engineering agent with filesystem and command tool execution.

---

## Key Modifications

### 1. Branding & Header Typography

- Replaced the hyphenated `"T3 Code - personal"` title in the top-left sidebar header with a clean two-line layout.
- Placed `personal` directly below `T3 Code` in italics at matching font size (`text-lg`).
- Adjusted font baseline and bottom padding (`pb-0.5 leading-none`) to prevent font descenders (such as the tail of the letter `p`) from getting clipped by container borders.

### 2. Default Font Sizes & Typography

- Modified the default appearance configuration in `@t3tools/contracts` so that preferred font sizes are loaded automatically without needing manual adjustment in Settings after reloads or fresh installs:
  - **Message Font Size**: `20px` (standard default was `13px`)
  - **Input Prompt Font Size**: `18px` (standard default was `14px`)
  - **Terminal Font Size**: `18px` (standard default was `14px`)
  - **UI Font Size**: `17px` (standard default was `13px`)

### 3. Abacus AI (RouteLLM) Agentic Provider

- Added a built-in provider driver for Abacus AI RouteLLM (`abacus`).
- Configured static model catalog (`route-llm`, `abacus-route`).
- Built a full agentic execution loop with OpenAI-compatible tool calling:
  - **Tools Provided**: `read_file`, `write_file`, `edit_file`, `list_directory`, `execute_command`.
  - **Autonomous Loop**: Streams SSE deltas, accumulates fragmented tool calls, dispatches native UI cards (`command_execution`, `file_change`, `dynamic_tool_call`), executes actions, feeds results back to the model, and repeats until task completion.
  - **Safety Filter**: Blocks destructive commands (`sudo`, `rm -rf /`, `rm -rf ~`, `curl | bash`, `wget | sh`, `git push --force`, `git clean -fxd`, `mkfs`, `dd if=`).
  - **Sandboxing**: Restricts file writes and modifications strictly to the active workspace directory (`isInsideWorkspace`), while permitting workspace and system reads.
  - **Command Timeout**: 60-second execution ceiling on shell commands with cancellation propagation (`SIGTERM`).
  - **20-Step Loop Ceiling**: Caps autonomous tool calls to 20 steps per turn, prompting the user interactively before proceeding further.
  - **Review workers**: Workflow reviews expose only file reads and directory listing. The dispatcher also rejects write and command calls. Ordinary sessions retain the agent tool loop.

---

### 4. Agent-created threads and workflows

Included in Personal 0.1.1. Some provider and remote flows remain to be verified.

Agents can create handoff threads with a different model or provider. T3
orchestration layers add queued child assignments, durable reports, shared model budgets,
and parent wakeups after reports. Web, desktop, and mobile have workflow controls
and model-limit settings. Monthly maintenance refreshes catalogs and pricing
without changing active session budgets.

An isolated desktop pass confirmed ordinary Sol threads and a Sol parent with
two Luna and two Gemini children. All four children produced findings, the
parent used them to repair a fixture, and its tests passed 10/10. A live
Gemini parent completed a Codex-to-Gemini quota handoff and received the child
report. A Zed Luna review child also reported through T3. Zed parent startup,
mobile UI, and remote flows remain pending. An opted-in layer can hand off
near a quota limit or resume after reset.
GPT-6 Astra, Sol, and Luna are classified as
current models; GPT-5.6 Sol and Luna are legacy.

See [workflow capabilities and limits](./MODIFICATIONS.md#21-agent-created-threads-and-flat-workflows),
[open verification work](./ISSUE_TRACKER.md#workflow-001-finish-client-and-native-provider-verification),
and the [current session handoff](./SESSION_HANDOFF.md).

### 5. Antigravity full access

Antigravity runs every model with full access when a new session starts or
resumes. Existing turns are not interrupted. Web, desktop, and mobile show only
Full access in Antigravity permission selectors. T3 retains the thread or draft
permission preference so switching providers restores it. GPT review and edit
children inherit their parent's mode.

---

## Project Documentation

Detailed guides and notes are available in this directory:

- [**MODIFICATIONS.md**](./MODIFICATIONS.md): Exhaustive file-by-file breakdown of changes, newly introduced modules, and their design details.
- [**SESSION_HANDOFF.md**](./SESSION_HANDOFF.md): Current work, evidence, constraints, and pending verification.
- [**ISSUE_TRACKER.md**](./ISSUE_TRACKER.md): Unresolved integration and verification work.
- [**UPSTREAM_SYNC.md**](./UPSTREAM_SYNC.md): Step-by-step guide for pulling upstream updates, rebasing, resolving potential merge conflicts, and verifying fork integrity.

---

## Development & Verification

### Running the Desktop App in Development

```bash
vp run dev:desktop
```

### Running the Abacus Adapter Test Suite

```bash
vp test run apps/server/src/provider/Layers/AbacusAdapter.test.ts
```

### Building the Entire Monorepo

```bash
vp run build
```
