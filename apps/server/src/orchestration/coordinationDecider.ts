import {
  CommandId,
  MessageId,
  coordinationModelKey,
  type OrchestrationCommand,
  type OrchestrationThread,
  type ThreadCoordination,
} from "@t3tools/contracts";

type Command = Extract<
  OrchestrationCommand,
  { type: "thread.coordination" | "thread.coordination.control" }
>;
type Parent = Extract<ThreadCoordination, { role: "parent" }>;
type Child = Extract<ThreadCoordination, { role: "child" }>;

function handoffContextForThread(
  source: OrchestrationThread,
  threads: ReadonlyArray<OrchestrationThread>,
  successorId?: OrchestrationThread["id"],
): string {
  const messages = source.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-80)
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .join("\n\n");
  const reports =
    source.coordination?.role === "parent"
      ? threads
          .filter(
            (thread) =>
              thread.coordination?.role === "child" &&
              (thread.coordination.parentId === source.id ||
                thread.coordination.parentId === successorId),
          )
          .flatMap((thread) => {
            const child = thread.coordination;
            return child?.role === "child" && child.report
              ? [
                  `Child report from ${thread.title} (${thread.modelSelection.model}):\n${child.report.text}`,
                ]
              : [];
          })
      : [];
  return [
    `Source orchestration layer thread: ${source.title} (${source.id})`,
    `Model: ${source.modelSelection.model}`,
    messages,
    ...(reports.length > 0 ? [`Current child reports:\n${reports.join("\n\n")}`] : []),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(-40_000);
}

function withModelBudget(
  budgets: Parent["budgets"],
  model: string,
  limit: number | null | undefined,
): Parent["budgets"] {
  const key = coordinationModelKey(model);
  return budgets.some((budget) => budget.model === key)
    ? budgets
    : [...budgets, { model: key, limit: limit ?? null, used: 0 }];
}

/** Plans commands inside the engine's transaction, including the budget debit and turn start. */
export function planCoordination(
  command: Command,
  threads: ReadonlyArray<OrchestrationThread>,
  busy: (thread: OrchestrationThread) => boolean,
  needsInput: (thread: OrchestrationThread) => boolean,
): ReadonlyArray<OrchestrationCommand> | string {
  const caller = threads.find((thread) => thread.id === command.threadId && !thread.deletedAt);
  if (!caller) return "The calling thread no longer exists.";
  const commands: OrchestrationCommand[] = [];
  const set = (thread: OrchestrationThread, coordination: ThreadCoordination) => {
    commands.push({
      type: "thread.coordination.set",
      commandId: command.commandId,
      threadId: thread.id,
      coordination,
      createdAt: command.createdAt,
    });
  };
  const children = threads.filter(
    (thread) =>
      !thread.deletedAt &&
      thread.coordination?.role === "child" &&
      thread.coordination.parentId === caller.id,
  );
  const state = caller.coordination;
  if (command.type === "thread.coordination.control") {
    if (state?.role !== "parent") return "Only the parent controls this workflow.";
    if (state.status === "completed" || state.status === "cancelled")
      return "This workflow has ended.";
    if (command.action === "enable-quota-handoff" || command.action === "disable-quota-handoff") {
      const enabled = command.action === "enable-quota-handoff";
      const current = state.quotaHandoff;
      const prior = current ?? {
        enabled: false,
        switchCount: 0,
        status: "paused" as const,
      };
      const { reason: _reason, resetAt: _resetAt, ...preserved } = prior;
      const handoffStatus =
        current?.status === "handing-off" || current?.status === "summarizing"
          ? current.status
          : undefined;
      set(caller, {
        ...state,
        quotaHandoff: {
          ...preserved,
          enabled,
          switchCount: prior.switchCount,
          status: handoffStatus ?? (enabled ? "watching" : "paused"),
          ...(!enabled
            ? {
                reason: handoffStatus
                  ? "Quota handoff is off after the current handoff."
                  : "Quota handoff is off.",
              }
            : {}),
        },
      });
      return commands;
    }
    const status =
      command.action === "pause"
        ? "paused"
        : command.action === "resume"
          ? "active"
          : command.action === "complete"
            ? "completed"
            : "cancelled";
    const quota = state.quotaHandoff;
    const cancelsPendingQuotaAction =
      (command.action === "pause" ||
        command.action === "complete" ||
        command.action === "cancel") &&
      (quota?.status === "waiting-reset" ||
        quota?.status === "handing-off" ||
        quota?.status === "summarizing");
    const {
      reason: _reason,
      resetAt: _resetAt,
      ...resumedQuota
    } = state.quotaHandoff ?? {
      enabled: false,
      switchCount: 0,
      status: "paused" as const,
    };
    set(caller, {
      ...state,
      status,
      blockedReason: null,
      ...(command.action === "resume" && state.quotaHandoff?.enabled
        ? {
            quotaHandoff: {
              ...resumedQuota,
              status: "watching" as const,
            },
          }
        : {}),
      ...(cancelsPendingQuotaAction && quota
        ? {
            quotaHandoff: {
              ...quota,
              status: "paused" as const,
              reason:
                command.action === "pause" ? "Paused by the user." : "Canceled by user activity.",
            },
          }
        : {}),
    });
    if (status === "cancelled" || status === "completed") {
      for (const child of children) {
        const childState = child.coordination as Child;
        if (
          childState.phase === "queued" ||
          (status === "cancelled" && childState.phase === "running")
        ) {
          set(child, { ...childState, phase: "cancelled" });
          if (busy(child))
            commands.push({
              type: "thread.turn.interrupt",
              commandId: command.commandId,
              threadId: child.id,
              createdAt: command.createdAt,
            });
        }
      }
    }
    return commands;
  }
  const action = command.action;
  if (action.type === "start") {
    if (state)
      return "This thread already belongs to a workflow. Start a new parent thread for a new session.";
    const keys = action.budgets.map((budget) => coordinationModelKey(budget.model));
    if (new Set(keys).size !== keys.length || action.budgets.some((budget) => budget.used !== 0))
      return "Initial budgets must be unique and unused.";
    if (!keys.includes(coordinationModelKey(caller.modelSelection.model)))
      return "Configure a budget for the parent model before starting a workflow.";
    set(caller, {
      role: "parent",
      status: "active",
      waiting: true,
      activating: busy(caller),
      maxChildren: 4,
      budgets: action.budgets.map((budget) => ({
        ...budget,
        model: coordinationModelKey(budget.model),
      })),
      policyUpdatedAt: action.policyUpdatedAt,
      blockedReason: null,
      ...(action.quotaHandoffEnabled
        ? {
            quotaHandoff: {
              enabled: true,
              switchCount: 0,
              status: "watching" as const,
            },
          }
        : {}),
    });
    return commands;
  }
  if (
    action.type === "report" ||
    action.type === "finish" ||
    action.type === "bind" ||
    action.type === "disconnect" ||
    action.type === "handoff-summary-complete"
  ) {
    if (action.type === "handoff-summary-complete") {
      if (
        state?.role === "parent" &&
        (state.status === "active" || state.status === "paused") &&
        state.quotaHandoff?.status === "summarizing"
      ) {
        const model = coordinationModelKey(caller.modelSelection.model);
        const budget = state.budgets.find((entry) => entry.model === model);
        if (!budget || (budget.limit !== null && budget.used >= budget.limit)) {
          set(caller, {
            ...state,
            status: "paused",
            blockedReason: `Automatic turn limit reached for ${model}; the handoff summary is ready, but continuation needs another turn.`,
            quotaHandoff: { ...state.quotaHandoff, status: "paused" },
          });
          return commands;
        }
        const quota = state.quotaHandoff;
        set(caller, {
          ...state,
          budgets: state.budgets.map((entry) =>
            entry.model === model ? { ...entry, used: entry.used + 1 } : entry,
          ),
          quotaHandoff: {
            ...quota,
            sourceThreadId: caller.id,
            status: "watching",
          },
        });
        commands.push({
          type: "thread.turn.start",
          coordinationAutomatic: true,
          commandId: CommandId.make(`${command.commandId}:continue`),
          threadId: caller.id,
          message: {
            messageId: MessageId.make(
              `quota-continue:${quota.sourceThreadId ?? quota.affectedThreadId ?? caller.id}`,
            ),
            role: "user",
            text: `Continue the unfinished orchestration layer task using the handoff summary below. Inspect the current workspace first because the interrupted turn may have left partial edits. Preserve child assignments and reports, and avoid repeating completed work.\n\nDestination model handoff summary:\n${action.text}`,
            attachments: [],
          },
          runtimeMode: caller.runtimeMode,
          interactionMode: caller.interactionMode,
          createdAt: command.createdAt,
        });
        return commands;
      }
      if (
        state?.role !== "child" ||
        state.phase !== "running" ||
        state.handoffStage !== "summarize"
      )
        return "This child is not waiting for a quota handoff summary.";
      const continuationAssignmentId = `${state.assignmentId}:continue`;
      const { handoffContext: _handoffContext, ...stateWithoutContext } = state;
      set(caller, {
        ...stateWithoutContext,
        assignmentId: continuationAssignmentId,
        phase: "queued",
        turnId: null,
        handoffStage: "continue",
        prompt: `Continue the original assignment below. First inspect the current workspace and the handoff summary to see what the previous provider completed. Continue from the actual files and avoid repeating completed work.\n\nOriginal assignment:\n${state.prompt.slice(0, 4_000)}\n\nHandoff summary:\n${action.text}`,
        report: null,
        adopted: false,
      });
      return commands;
    }
    if (state?.role !== "child" || state.assignmentId !== action.assignmentId)
      return "The report does not match this child's current assignment.";
    if (action.type === "disconnect") {
      if (state.phase !== "running") return [];
      const parent = threads.find((thread) => thread.id === state.parentId);
      if (
        parent?.coordination?.role === "parent" &&
        ["active", "paused"].includes(parent.coordination.status)
      ) {
        set(parent, {
          ...parent.coordination,
          status: "paused",
          blockedReason: `Child ${caller.title} lost an uncorrelated provider connection. Inspect the child, then cancel this workflow if its turn cannot recover. No automatic work was replayed.`,
        });
      }
      if (
        parent?.coordination?.role === "parent" &&
        ["completed", "cancelled"].includes(parent.coordination.status)
      )
        set(caller, { ...state, phase: "cancelled" });
      return commands;
    }
    if (action.type === "bind") {
      if (state.phase !== "running" || state.turnId === action.turnId) return [];
      if (state.turnId) return "This assignment already has a provider turn.";
      set(caller, { ...state, turnId: action.turnId });
      return commands;
    }
    if (action.type === "finish") {
      if (state.phase !== "running") return [];
      set(caller, {
        ...state,
        phase: "reported",
        report: state.report ?? { id: state.assignmentId, text: action.text.slice(0, 8_000) },
      });
      return commands;
    }
    if (state.report !== null)
      return state.report.text === action.text ? [] : "This assignment already has a report.";
    if (state.phase !== "running" && state.phase !== "cancelled")
      return "This assignment has not started.";
    if (action.text.length > 8_000)
      return "Keep the report within 8,000 characters. Put full details in the child thread.";
    // Keep the slot occupied until the provider turn has actually ended.
    set(caller, {
      ...state,
      report: { id: state.assignmentId, text: action.text },
      adopted: false,
    });
    return commands;
  }

  if (action.type === "quota-wait" || action.type === "quota-trigger") {
    if (state?.role !== "parent")
      return "Only an orchestration layer parent can route quota-limited work.";
    const quota = state.quotaHandoff;
    if (!quota?.enabled) return "Enable quota handoff for this orchestration layer first.";
    const source = threads.find((thread) => thread.id === action.affectedThreadId);
    if (!source || source.deletedAt) return "The quota-limited thread no longer exists.";
    const childSource = source.coordination?.role === "child";
    if (source.id !== caller.id && (!childSource || source.coordination.parentId !== caller.id))
      return "The quota-limited thread is not part of this orchestration layer.";
    if (action.type === "quota-wait") {
      const { resetAt: _previousResetAt, ...quotaWithoutReset } = quota;
      const nextQuota = {
        ...quotaWithoutReset,
        status: action.resetAt ? ("waiting-reset" as const) : ("paused" as const),
        affectedThreadId: source.id,
        sourceModel: source.modelSelection.model,
        ...(action.resetAt ? { resetAt: action.resetAt } : {}),
        reason: action.reason,
      };
      set(caller, {
        ...state,
        status: "paused",
        waiting: false,
        blockedReason: action.reason,
        quotaHandoff: nextQuota,
      });
      if (childSource) {
        set(source, { ...source.coordination, phase: "cancelled" });
      }
      if (busy(source))
        commands.push({
          type: "thread.turn.interrupt",
          commandId: CommandId.make(`${command.commandId}:interrupt`),
          threadId: source.id,
          createdAt: command.createdAt,
        });
      return commands;
    }
    const isResetResume = !action.switchProvider;
    if (!isResetResume && quota.switchCount >= 1)
      return "This orchestration layer already used its automatic provider switch.";
    if (state.status !== "active" && quota.status !== "waiting-reset")
      return "This orchestration layer is not active for quota handoff.";
    if (childSource && source.coordination?.phase !== "running" && !isResetResume)
      return "The quota-limited child is no longer running.";
    const replacementState = source.coordination;
    const { resetAt: _previousResetAt, reason: _previousReason, ...quotaWithoutWait } = quota;
    const destinationThreadId = action.destinationThreadId;
    const handoffTitle = `${source.title} (quota handoff)`.slice(0, 120);
    if (source.id === caller.id) {
      const nextQuota = {
        ...quotaWithoutWait,
        enabled: true,
        switchCount: quota.switchCount + (action.switchProvider ? 1 : 0),
        status: "handing-off" as const,
        affectedThreadId: source.id,
        sourceModel: source.modelSelection.model,
        destinationThreadId,
        destinationInstanceId: action.destinationModelSelection.instanceId,
        destinationModel: action.destinationModelSelection.model,
      };
      const successor: Parent = {
        ...state,
        budgets: withModelBudget(
          state.budgets,
          action.destinationModelSelection.model,
          action.destinationBudgetLimit,
        ),
        status: "paused",
        waiting: false,
        activating: true,
        blockedReason: "Preparing a quota handoff.",
        quotaHandoff: {
          ...nextQuota,
          sourceThreadId: source.id,
          destinationThreadId,
          status: "handing-off",
        },
      };
      commands.push(
        {
          type: "thread.create",
          commandId: CommandId.make(`${command.commandId}:create`),
          threadId: destinationThreadId,
          projectId: source.projectId,
          title: handoffTitle,
          modelSelection: action.destinationModelSelection,
          runtimeMode: source.runtimeMode,
          interactionMode: source.interactionMode,
          branch: source.branch,
          worktreePath: source.worktreePath,
          createdAt: command.createdAt,
        },
        {
          type: "thread.coordination.set",
          commandId: CommandId.make(`${command.commandId}:successor`),
          threadId: destinationThreadId,
          coordination: successor,
          createdAt: command.createdAt,
        },
        {
          type: "thread.coordination.set",
          commandId: CommandId.make(`${command.commandId}:source`),
          threadId: source.id,
          coordination: {
            ...state,
            status: "completed",
            waiting: false,
            blockedReason: `Continued in ${destinationThreadId} after a quota handoff.`,
            quotaHandoff: { ...nextQuota, status: "handed-off" },
          },
          createdAt: command.createdAt,
        },
      );
      for (const thread of threads) {
        if (thread.coordination?.role !== "child" || thread.coordination.parentId !== caller.id)
          continue;
        commands.push({
          type: "thread.coordination.set",
          commandId: CommandId.make(`${command.commandId}:reparent:${thread.id}`),
          threadId: thread.id,
          coordination: { ...thread.coordination, parentId: destinationThreadId },
          createdAt: command.createdAt,
        });
      }
      if (busy(source))
        commands.push({
          type: "thread.turn.interrupt",
          commandId: CommandId.make(`${command.commandId}:interrupt`),
          threadId: source.id,
          createdAt: command.createdAt,
        });
      return commands;
    }
    if (!childSource || replacementState?.role !== "child")
      return "Only parent and child turns can be handed off.";
    const nextQuota = {
      ...quotaWithoutWait,
      enabled: true,
      switchCount: quota.switchCount + (action.switchProvider ? 1 : 0),
      status: "handing-off" as const,
      affectedThreadId: source.id,
      sourceModel: source.modelSelection.model,
      destinationThreadId,
      destinationInstanceId: action.destinationModelSelection.instanceId,
      destinationModel: action.destinationModelSelection.model,
    };
    set(caller, {
      ...state,
      budgets: withModelBudget(
        state.budgets,
        action.destinationModelSelection.model,
        action.destinationBudgetLimit,
      ),
      status: "paused",
      waiting: false,
      blockedReason: "Waiting for the quota handoff to finish.",
      quotaHandoff: nextQuota,
    });
    set(source, { ...replacementState, phase: "cancelled" });
    commands.push({
      type: "thread.create",
      commandId: CommandId.make(`${command.commandId}:create`),
      threadId: destinationThreadId,
      projectId: source.projectId,
      title: handoffTitle,
      modelSelection: action.destinationModelSelection,
      runtimeMode: source.runtimeMode,
      interactionMode: source.interactionMode,
      branch: source.branch,
      worktreePath: source.worktreePath,
      createdAt: command.createdAt,
    });
    commands.push({
      type: "thread.coordination.set",
      commandId: CommandId.make(`${command.commandId}:replacement`),
      threadId: destinationThreadId,
      createdAt: command.createdAt,
      coordination: {
        ...replacementState,
        assignmentId: `${replacementState.assignmentId}:quota:${destinationThreadId}`,
        phase: "queued",
        turnId: null,
        prompt: replacementState.prompt,
        report: null,
        adopted: false,
        handoffFromThreadId: source.id,
        handoffStage: "summarize",
      },
    });
    if (busy(source))
      commands.push({
        type: "thread.turn.interrupt",
        commandId: CommandId.make(`${command.commandId}:interrupt`),
        threadId: source.id,
        createdAt: command.createdAt,
      });
    return commands;
  }
  if (action.type === "quota-settle") {
    if (state?.role !== "parent" || state.quotaHandoff?.status !== "handing-off") return [];
    if (state.quotaHandoff.destinationThreadId !== action.destinationThreadId)
      return "The quota handoff destination changed.";
    if (caller.id !== action.destinationThreadId) {
      const source = threads.find((thread) => thread.id === state.quotaHandoff?.affectedThreadId);
      const replacement = threads.find((thread) => thread.id === action.destinationThreadId);
      if (source && replacement?.coordination?.role === "child")
        set(replacement, {
          ...replacement.coordination,
          handoffContext: handoffContextForThread(source, threads, action.destinationThreadId),
        });
      set(caller, {
        ...state,
        status: "active",
        blockedReason: null,
        quotaHandoff: {
          ...state.quotaHandoff,
          enabled: state.quotaHandoff.enabled,
          status: "watching",
        },
      });
      return commands;
    }
    const quotaState = state.quotaHandoff;
    if (quotaState.sourceThreadId) {
      const source = threads.find((thread) => thread.id === quotaState.sourceThreadId);
      const handoffContext = source
        ? handoffContextForThread(source, threads, caller.id)
        : `Source orchestration layer thread ${quotaState.sourceThreadId} is no longer available.`;
      set(caller, {
        ...state,
        status: "active",
        activating: false,
        blockedReason: null,
        quotaHandoff: { ...quotaState, status: "summarizing" },
      });
      commands.push({
        type: "thread.turn.start",
        coordinationAutomatic: true,
        commandId: CommandId.make(`${command.commandId}:summary`),
        threadId: caller.id,
        message: {
          messageId: MessageId.make(`quota-summary:${quotaState.sourceThreadId}`),
          role: "user",
          text: `Summarize the source orchestration layer history below in a concise handoff. Include the user's goal, decisions, completed work, open work, important file or branch state, partial edits, and current child reports. Do not continue implementation in this turn.\n\n${handoffContext}`,
          attachments: [],
        },
        runtimeMode: caller.runtimeMode,
        interactionMode: caller.interactionMode,
        createdAt: command.createdAt,
      });
      return commands;
    }
    set(caller, {
      ...state,
      status: "active",
      activating: false,
      blockedReason: null,
      quotaHandoff: {
        enabled: state.quotaHandoff.enabled,
        switchCount: state.quotaHandoff.switchCount,
        status: "watching",
      },
    });
    return commands;
  }
  if (state?.role !== "parent")
    return "Children cannot create threads, assign work, or coordinate another workflow.";
  if (state.status !== "active")
    return action.type === "advance" ? [] : "Resume the workflow before assigning work.";
  let parent: Parent = state;
  // Queue assignments during the initial planning turn, but start workers only
  // after it ends so their child role and shared budget apply before work begins.
  if (action.type === "advance" && parent.activating) {
    if (busy(caller) || needsInput(caller)) return [];
    parent = { ...parent, activating: false };
  }
  const budgetFor = (model: string) =>
    parent.budgets.find((budget) => budget.model === coordinationModelKey(model));
  if (action.type === "spawn") {
    const child = action.child;
    if (
      child.projectId !== caller.projectId ||
      child.threadId === caller.id ||
      threads.some((thread) => thread.id === child.threadId)
    )
      return "A child must be a new thread in the parent's project.";
    if (!budgetFor(child.modelSelection.model))
      return "Configure a budget for this model before assigning automatic work.";
    if (
      action.mode === "edit" &&
      (!child.worktreePath ||
        child.worktreePath === caller.worktreePath ||
        children.some((thread) => thread.worktreePath === child.worktreePath))
    )
      return "Editing children need separate worktrees. The parent integrates their changes.";
    if (action.mode === "review" && !action.reviewRef)
      return "Read-only reviews need a revision or checkpoint to review.";
    commands.push(child);
    commands.push({
      type: "thread.coordination.set",
      commandId: command.commandId,
      threadId: child.threadId,
      createdAt: command.createdAt,
      coordination: {
        role: "child",
        parentId: caller.id,
        phase: "queued",
        assignmentId: command.commandId,
        prompt: action.prompt,
        report: null,
        adopted: false,
        mode: action.mode,
        reviewRef: action.reviewRef,
      },
    });
    return commands;
  }
  if (action.type === "assign") {
    const child = children.find((thread) => thread.id === action.childId);
    if (!child || child.coordination?.role !== "child")
      return "Only this parent's children can receive assignments.";
    const childState = child.coordination;
    if (
      busy(child) ||
      childState.phase === "queued" ||
      childState.phase === "running" ||
      (childState.report && !childState.adopted)
    )
      return "Wait for the previous assignment to finish and adopt its report first.";
    set(child, {
      ...childState,
      phase: "queued",
      assignmentId: command.commandId,
      turnId: null,
      prompt: action.prompt,
      report: null,
      adopted: false,
    });
    return commands;
  }
  if (action.type === "wait") {
    if (!parent.waiting) set(caller, { ...parent, waiting: true });
    return commands;
  }
  const debit = (model: string): boolean => {
    const budget = budgetFor(model);
    if (!budget || (budget.limit !== null && budget.used >= budget.limit)) return false;
    parent = {
      ...parent,
      budgets: parent.budgets.map((entry) =>
        entry.model === budget.model ? { ...entry, used: entry.used + 1 } : entry,
      ),
      blockedReason: null,
    };
    return true;
  };
  const start = (thread: OrchestrationThread, prompt: string, id: string) => {
    commands.push({
      type: "thread.turn.start",
      coordinationAutomatic: true,
      commandId: CommandId.make(`${command.commandId}:turn:${thread.id}`),
      threadId: thread.id,
      message: {
        messageId: MessageId.make(`coordination:${id}`),
        role: "user",
        text: prompt,
        attachments: [],
      },
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: command.createdAt,
    });
  };
  let active = children.filter(
    (thread) => thread.coordination?.role === "child" && thread.coordination.phase === "running",
  ).length;
  for (const child of children) {
    const childState = child.coordination as Child;
    if (
      childState.phase !== "queued" ||
      active >= parent.maxChildren ||
      busy(child) ||
      needsInput(child)
    )
      continue;
    const isHandoffSummary = childState.handoffStage === "summarize";
    if (!isHandoffSummary && !debit(child.modelSelection.model)) {
      parent = {
        ...parent,
        blockedReason: `Automatic turn limit reached for ${coordinationModelKey(child.modelSelection.model)}.`,
      };
      continue;
    }
    set(child, { ...childState, phase: "running" });
    const assignmentPrompt =
      childState.handoffStage === "summarize"
        ? `Summarize the source thread below in a concise handoff for continuing the assigned task. Include the user's goal, decisions, completed work, open work, relevant file state, and partial edits. Do not continue implementation in this turn.\n\nSource thread history:\n${childState.handoffContext ?? ""}\n\nOriginal assignment:\n${childState.prompt}`
        : childState.prompt;
    start(
      child,
      `You are a child worker in a T3 orchestration layer. You may use provider-native subagents. Do not start another T3 orchestration layer, create T3 threads, or assign T3 work; only the parent can assign T3 follow-ups. ${childState.mode === "review" ? `Your working directory is a detached snapshot of revision ${childState.reviewRef}. Read its files or Git history to review that commit. Do not edit files.` : "Edit only in your assigned worktree. The parent will integrate changes."}\n\n${assignmentPrompt}\n\nWhen finished, send report_to_parent with assignmentId ${childState.assignmentId} if that tool is available. Otherwise give your result as the final answer; T3 records it when the turn ends.`,
      childState.assignmentId,
    );
    active += 1;
  }
  const reports = children.filter(
    (thread) =>
      thread.coordination?.role === "child" &&
      thread.coordination.report &&
      !thread.coordination.adopted,
  );
  if (reports.length > 0 && !busy(caller) && !needsInput(caller)) {
    if (debit(caller.modelSelection.model)) {
      const text = reports
        .map((thread) => {
          const childState = thread.coordination as Child;
          set(thread, { ...childState, adopted: true });
          return `Report ${childState.report!.id} from child ${thread.id} (${thread.modelSelection.model}):\n${childState.report!.text}`;
        })
        .join("\n\n");
      parent = { ...parent, waiting: false };
      start(
        caller,
        `Child reports arrived. Use useful results now; other children may still be working. You may assign more T3 child work within the remaining model budgets, wait_for_children and end this turn, or complete the workflow. Do not poll or use create_thread to bypass this workflow.\n\n${text}`,
        command.commandId,
      );
    } else
      parent = {
        ...parent,
        blockedReason: `Automatic turn limit reached for ${coordinationModelKey(caller.modelSelection.model)}. Reports remain in the inbox.`,
      };
  }
  if (JSON.stringify(parent) !== JSON.stringify(state))
    commands.unshift({
      type: "thread.coordination.set",
      commandId: command.commandId,
      threadId: caller.id,
      coordination: parent,
      createdAt: command.createdAt,
    });
  return commands;
}
