# Personal Fork of T3 Code

This folder documents the changes, features, and architecture decisions that distinguish this personal fork from the upstream [pingdotgg/t3code](https://github.com/pingdotgg/t3code) repository.

---

## Table of Contents

- [Overview](#overview)
- [Key Modifications](#key-modifications)
  - [1. Branding & Header Typography](#1-branding--header-typography)
  - [2. Default Font Sizes & Typography](#2-default-font-sizes--typography)
  - [3. Abacus AI (RouteLLM) Agentic Provider](#3-abacus-ai-routellm-agentic-provider)
- [Project Documentation](#project-documentation)
- [Development & Verification](#development--verification)

---

## Overview

- **Base Repository**: `https://github.com/pingdotgg/t3code`
- **Active Branch**: `integration/zed-abacus`
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
  - **Unit Test Coverage**: Comprehensive suite in `AbacusAdapter.test.ts` (11 passing tests).

---

## Project Documentation

Detailed guides and notes are available in this directory:

- [**MODIFICATIONS.md**](./MODIFICATIONS.md): Exhaustive file-by-file breakdown of changes, newly introduced modules, and their design details.
- [**UPSTREAM_SYNC.md**](./UPSTREAM_SYNC.md): Step-by-step guide for pulling upstream updates, rebasing, resolving potential merge conflicts, and verifying fork integrity.

---

## Development & Verification

### Running the Desktop App in Development

```bash
vp run dev:desktop
```

### Running the Abacus Adapter Test Suite

```bash
pnpm --filter t3 test src/provider/Layers/AbacusAdapter.test.ts
```

### Building the Entire Monorepo

```bash
vp run build
```
