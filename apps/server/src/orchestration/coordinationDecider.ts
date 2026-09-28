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
    const status =
      command.action === "pause"
        ? "paused"
        : command.action === "resume"
          ? "active"
          : command.action === "complete"
            ? "completed"
            : "cancelled";
    set(caller, { ...state, status, blockedReason: null });
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
    });
    return commands;
  }
  if (
    action.type === "report" ||
    action.type === "finish" ||
    action.type === "bind" ||
    action.type === "disconnect"
  ) {
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
    if (!debit(child.modelSelection.model)) {
      parent = {
        ...parent,
        blockedReason: `Automatic turn limit reached for ${coordinationModelKey(child.modelSelection.model)}.`,
      };
      continue;
    }
    set(child, { ...childState, phase: "running" });
    start(
      child,
      `You are a child worker in a flat T3 workflow. You may use provider-native subagents. Do not start a T3 workflow, create T3 threads, or assign T3 work; only the parent can assign T3 follow-ups. ${childState.mode === "review" ? `Your working directory is a detached snapshot of revision ${childState.reviewRef}. Read its files or Git history to review that commit. Do not edit files.` : "Edit only in your assigned worktree. The parent will integrate changes."}\n\n${childState.prompt}\n\nWhen finished, send report_to_parent with assignmentId ${childState.assignmentId} if that tool is available. Otherwise give your result as the final answer; T3 records it when the turn ends.`,
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
