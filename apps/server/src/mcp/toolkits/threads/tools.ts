import {
  McpCapabilityUnavailableError,
  ModelCapabilities,
  ModelSelection,
  OrchestrationLatestTurn,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderOptionSelections,
  ThreadId,
  ThreadCoordination,
  ThreadCoordinationSummary,
  CoordinationBudget,
  CoordinationControl,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import { McpInvocationContext } from "../../McpInvocationContext.ts";

export class ThreadToolError extends Schema.TaggedError<ThreadToolError>()("ThreadToolError", {
  message: Schema.String,
}) {}

const failure = Schema.Union([McpCapabilityUnavailableError, ThreadToolError]);
const dependencies = [McpInvocationContext];
const threadId = Schema.optional(
  ThreadId.annotate({
    description:
      "Thread to read. Omit to read the calling thread. Use the ID returned by create_thread for a child.",
  }),
);
const selection = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
}).annotate({
  description:
    "Copy an instanceId and model slug from list_thread_models. Omit to inherit the parent's model and options. An explicit selection may use another model or provider instance.",
});

export const ThreadCreatedResult = Schema.Struct({
  threadId: ThreadId,
  modelSelection: ModelSelection,
});
export const ThreadModelsResult = Schema.Struct({
  current: ModelSelection,
  providers: Schema.Array(
    Schema.Struct({
      instanceId: ProviderInstanceId,
      driver: ProviderDriverKind,
      name: Schema.String,
      available: Schema.Boolean,
      workflowSupported: Schema.Boolean,
      workflowReason: Schema.optional(Schema.String),
      reason: Schema.optional(Schema.String),
      models: Schema.Array(
        Schema.Struct({
          model: Schema.String,
          name: Schema.String,
          capabilities: Schema.NullOr(ModelCapabilities),
        }),
      ),
    }),
  ),
});
export const ThreadReadResult = Schema.Struct({
  coordination: Schema.optional(Schema.NullOr(ThreadCoordination)),
  threadId: ThreadId,
  title: Schema.String,
  modelSelection: ModelSelection,
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      text: Schema.String,
      truncated: Schema.Boolean,
    }),
  ),
  beforeCursor: Schema.NullOr(Schema.String),
});

export const ThreadsToolkit = Toolkit.make(
  Tool.make("start_thread_workflow", {
    description:
      "Start a flat parent-child workflow authorized by the user. Any model may be the parent. Captures model limits for this session; initial user planning is excluded. Automatic child starts, follow-ups, and parent report wakes share these counters. Queue assignments during this planning turn, then end it. Four T3 child threads can run concurrently; excess work queues. Provider-native subagents are allowed, but a T3 child cannot start or assign another T3 workflow. Use spawn_child, report_to_parent, wait_for_children, read_thread_workflow, and control_thread_workflow.",
    success: Schema.Struct({ threadId: ThreadId, coordination: ThreadCoordination }),
    failure,
    dependencies,
  }),
  Tool.make("spawn_child", {
    description:
      "Queue a T3 child assignment in your active workflow. Choose any available model/provider from list_thread_models. Child has no prior history; include full instructions. Read-only reviews require a Git revision/checkpoint. Editing requires an existing separate worktreePath; the parent integrates changes. Provider-native subagents are allowed, but T3 workflow children cannot create or assign more T3 threads. Provider completion automatically reports; children can send a concise report_to_parent first. Do not poll. Use wait_for_children and end your turn.",
    parameters: Schema.Struct({
      title: TrimmedNonEmptyString,
      prompt: TrimmedNonEmptyString,
      modelSelection: Schema.optional(selection),
      mode: Schema.Literals(["review", "edit"]),
      reviewRef: Schema.optional(TrimmedNonEmptyString),
      worktreePath: Schema.optional(TrimmedNonEmptyString),
      branch: Schema.optional(TrimmedNonEmptyString),
    }),
    success: ThreadCreatedResult,
    failure,
    dependencies,
  }),
  Tool.make("assign_child", {
    description:
      "Queue another assignment for one of your idle children after its previous report was adopted. Uses the same model and shared session budget. Only the parent may assign follow-ups.",
    parameters: Schema.Struct({ threadId: ThreadId, prompt: TrimmedNonEmptyString }),
    success: Schema.Struct({ threadId: ThreadId }),
    failure,
    dependencies,
  }),
  Tool.make("report_to_parent", {
    description:
      "Send your concise assignment result to your parent. Use the assignmentId in your initial prompt. Reports persist even while the parent is busy or paused. Keep within 8,000 characters; put full details in your thread. One report per assignment; retry the same report safely. End your turn after reporting. Never send a new user turn to the parent.",
    parameters: Schema.Struct({ assignmentId: TrimmedNonEmptyString, text: TrimmedNonEmptyString }),
    success: Schema.Struct({ threadId: ThreadId }),
    failure,
    dependencies,
  }),
  Tool.make("wait_for_children", {
    description:
      "Persist your intent to wait, then end this provider turn immediately. A report resumes you when idle and within budget; you do not need to poll or wait for every child. Reports already pending can arrive together with their individual IDs. Do not keep thinking or running tools after this call.",
    success: Schema.Struct({ threadId: ThreadId }),
    failure,
    dependencies,
  }),
  Tool.make("read_thread_workflow", {
    description:
      "Inspect your parent-child workflow, reports, assignment status and shared model budgets. Read child threads for full results. Reading does not start turns or reset limits.",
    success: Schema.Struct({
      parentId: ThreadId,
      coordination: ThreadCoordination,
      children: Schema.Array(
        Schema.Struct({
          threadId: ThreadId,
          title: Schema.String,
          modelSelection: ModelSelection,
          coordination: ThreadCoordinationSummary,
        }),
      ),
    }),
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("control_thread_workflow", {
    description:
      "Pause, resume, cancel, or complete your workflow. Pause prevents automatic starts while running children may report. Resume keeps used budgets. Cancel interrupts owned children and cancels queued work. Complete ends automatic work; late reports remain inspectable. Completed/cancelled sessions cannot restart or reset counters. Only the parent controls the workflow.",
    parameters: Schema.Struct({ action: CoordinationControl }),
    success: Schema.Struct({ threadId: ThreadId }),
    failure,
    dependencies,
  }),
  Tool.make("refresh_coordination_policy", {
    description:
      "Refresh available models, output pricing and automatic-turn defaults now. Maintenance also runs monthly. Explicit named-model and user overrides survive refresh. Active sessions keep captured limits and used counters. Unknown prices require a configured limit before automatic work.",
    success: Schema.Struct({ updatedAt: Schema.String, budgets: Schema.Array(CoordinationBudget) }),
    failure,
    dependencies,
  }),

  Tool.make("list_thread_models", {
    description:
      "List this environment's configured provider instances and their model slugs and options before selecting a model for create_thread. Includes unavailable providers with a reason. Do not guess model IDs.",
    success: ThreadModelsResult,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true),
  Tool.make("create_thread", {
    description:
      "Create a fresh T3 Code thread and start its initial prompt. Use for session handoff or delegated reviews when the user requests or authorizes them. The child shares this thread's project, branch, working directory and permission mode. It starts with no conversation history; include the full handoff or review instructions in prompt. Omit modelSelection to inherit the parent's model, or use list_thread_models to choose any available model and provider. Return the threadId to the user. Creation queues the initial turn; use read_thread to inspect progress and results. Never substitute a provider-native subagent for a requested fresh T3 thread.",
    parameters: Schema.Struct({
      title: TrimmedNonEmptyString,
      prompt: TrimmedNonEmptyString,
      modelSelection: Schema.optional(selection),
    }),
    success: ThreadCreatedResult,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("read_thread", {
    description:
      "Read recent prompts and assistant output from a T3 Code thread in this project, including its turn status and whether it needs approval or input. Omit threadId for your own thread. Use beforeCursor to read older pages for a handoff. Message text is bounded and marked when truncated. Read delegated results before deciding whether a follow-up is needed.",
    parameters: Schema.Struct({ threadId, beforeCursor: Schema.optional(TrimmedNonEmptyString) }),
    success: ThreadReadResult,
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true),
  Tool.make("send_message_to_thread", {
    description:
      "Start a follow-up turn in an idle T3 Code thread in this project. Use only when the user authorizes messaging that thread or an ongoing coordination workflow. Keeps the destination's model and permission mode. Read its result with read_thread. A busy thread must finish or be interrupted first.",
    parameters: Schema.Struct({ threadId: ThreadId, prompt: TrimmedNonEmptyString }),
    success: Schema.Struct({ threadId: ThreadId }),
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("interrupt_thread", {
    description:
      "Interrupt an active turn in a T3 Code thread in this project when the user asks to stop it or within an authorized coordination workflow. Preserves the thread and its history. Use read_thread to check its state before sending more work.",
    parameters: Schema.Struct({ threadId: ThreadId }),
    success: Schema.Struct({ threadId: ThreadId }),
    failure,
    dependencies,
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);
