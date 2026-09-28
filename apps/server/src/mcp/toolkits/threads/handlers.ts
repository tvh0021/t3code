import { coordinationProviderIssue } from "../../../provider/coordinationWorkerPolicy.ts";
import { CoordinationPolicy } from "../../../orchestration/CoordinationPolicy.ts";
import {
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ServerConfig } from "../../../config.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../../orchestration/Services/ThreadDeletionReactor.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { ServerRuntimeStartup } from "../../../serverRuntimeStartup.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import { ThreadToolError, ThreadsToolkit } from "./tools.ts";
import { ProcessRunner } from "../../../processRunner.ts";

const isThreadToolError = Schema.is(ThreadToolError);

const unavailableReason = (provider: ServerProvider): string | undefined => {
  if (!provider.enabled || provider.status === "disabled") return "Provider is disabled.";
  if (provider.availability === "unavailable")
    return provider.unavailableReason ?? "Provider is unavailable.";
  if (!provider.installed) return "Provider is not installed.";
  if (provider.auth.status === "unauthenticated") return "Provider needs authentication.";
  if (provider.status === "error") return provider.message ?? "Provider is not ready.";
  return undefined;
};

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providers = yield* ProviderRegistry;
  const startup = yield* ServerRuntimeStartup;
  const deletion = yield* ThreadDeletionReactor;
  const policy = yield* CoordinationPolicy;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const processes = yield* ProcessRunner;
  const crypto = yield* Crypto.Crypto;
  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const commandId = uuid.pipe(Effect.map((id) => CommandId.make(`mcp:${id}`)));
  const failed =
    (operation: string) =>
    <E extends { readonly _tag: string }>(cause: E) =>
      isThreadToolError(cause)
        ? cause
        : new ThreadToolError({
            message: `Could not ${operation}: ${"message" in cause && typeof cause.message === "string" ? cause.message : cause._tag}.`,
          });

  const requireThread = Effect.fn("ThreadsToolkit.requireThread")(function* (id?: ThreadId) {
    const scope = yield* requireMcpCapability("threads");
    const parent = yield* snapshots
      .getThreadShellById(scope.threadId)
      .pipe(Effect.mapError(failed("read the calling thread")));
    if (Option.isNone(parent))
      return yield* new ThreadToolError({ message: "The calling thread no longer exists." });
    if (id === undefined || id === parent.value.id) return parent.value;
    const target = yield* snapshots
      .getThreadShellById(id)
      .pipe(Effect.mapError(failed("read the target thread")));
    if (Option.isNone(target) || target.value.projectId !== parent.value.projectId) {
      return yield* new ThreadToolError({
        message: "The target thread was not found in this project.",
      });
    }
    return target.value;
  });

  const resolveSelection = Effect.fn("ThreadsToolkit.resolveSelection")(function* (
    inherited: ModelSelection,
    requested?: ModelSelection,
  ) {
    const selection = requested ?? inherited;
    const catalog = yield* providers.getProviders;
    const provider = catalog.find((entry) => entry.instanceId === selection.instanceId);
    if (!provider)
      return yield* new ThreadToolError({
        message: "Unknown provider instance. Use list_thread_models.",
      });
    const reason = unavailableReason(provider);
    if (reason) return yield* new ThreadToolError({ message: reason });
    if (requested) {
      const model = provider.models.find((entry) => entry.slug === selection.model);
      if (!model)
        return yield* new ThreadToolError({
          message:
            "Unknown model for this provider instance. Use list_thread_models and copy its model slug.",
        });
      for (const option of selection.options ?? []) {
        const descriptor = model.capabilities?.optionDescriptors?.find(
          (entry) => entry.id === option.id,
        );
        const valid =
          descriptor?.type === "boolean"
            ? typeof option.value === "boolean"
            : descriptor?.type === "select" &&
              descriptor.options.some((choice) => choice.id === option.value);
        if (!valid)
          return yield* new ThreadToolError({
            message: `Invalid option ${option.id} for ${selection.model}. Use the capabilities in list_thread_models.`,
          });
      }
    }
    return selection;
  });

  const startTurn = Effect.fn("ThreadsToolkit.startTurn")(function* (
    thread: Pick<OrchestrationThreadShell, "id" | "runtimeMode" | "interactionMode">,
    prompt: string,
    modelSelection?: ModelSelection,
  ) {
    yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: yield* commandId,
        threadId: thread.id,
        message: {
          messageId: MessageId.make(yield* uuid),
          role: "user",
          text: prompt,
          attachments: [],
        },
        ...(modelSelection ? { modelSelection } : {}),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: yield* now,
      })
      .pipe(Effect.mapError(failed(`start a turn in thread ${thread.id}`)));
  });

  const coordinate = Effect.fn("ThreadsToolkit.coordinate")(function* (
    action: Extract<
      Parameters<typeof engine.dispatch>[0],
      { type: "thread.coordination" }
    >["action"],
  ) {
    const caller = yield* requireThread();
    yield* engine
      .dispatch({
        type: "thread.coordination",
        commandId: yield* commandId,
        threadId: caller.id,
        action,
        createdAt: yield* now,
      })
      .pipe(Effect.mapError(failed("coordinate the workflow")));
    return { threadId: caller.id };
  });

  return ThreadsToolkit.of({
    start_orchestration_layer: (input) =>
      Effect.gen(function* () {
        const caller = yield* requireThread();
        if (caller.coordination?.role === "child")
          return yield* new ThreadToolError({
            message: "T3 orchestration layer children cannot start another layer.",
          });
        const provider = (yield* providers.getProviders).find(
          (entry) => entry.instanceId === caller.modelSelection.instanceId,
        );
        const issue = provider
          ? coordinationProviderIssue(provider.driver, "parent")
          : "Unknown provider instance.";
        if (issue) return yield* new ThreadToolError({ message: issue });
        const rules = yield* policy.read().pipe(Effect.mapError(failed("read model policy")));
        yield* coordinate({
          type: "start",
          budgets: rules.budgets,
          policyUpdatedAt: rules.updatedAt,
          ...(input?.quotaHandoff === true ? { quotaHandoffEnabled: true } : {}),
        });
        const updated = yield* requireThread();
        if (!updated.coordination || updated.coordination.role !== "parent")
          return yield* new ThreadToolError({
            message: "T3 orchestration layer state is unavailable.",
          });
        return { threadId: caller.id, coordination: updated.coordination };
      }),
    spawn_child: (input) =>
      Effect.gen(function* () {
        const parent = yield* requireThread();
        if (parent.coordination?.role === "child")
          return yield* new ThreadToolError({
            message: "Only the orchestration layer parent can create T3 child threads.",
          });
        const modelSelection = yield* resolveSelection(parent.modelSelection, input.modelSelection);
        const provider = (yield* providers.getProviders).find(
          (entry) => entry.instanceId === modelSelection.instanceId,
        );
        const issue = provider
          ? coordinationProviderIssue(provider.driver, "child")
          : "Unknown provider instance.";
        if (issue) return yield* new ThreadToolError({ message: issue });
        const id = ThreadId.make(yield* uuid);
        const project = yield* snapshots
          .getProjectShellById(parent.projectId)
          .pipe(Effect.mapError(failed("read project")));
        if (Option.isNone(project))
          return yield* new ThreadToolError({ message: "The project no longer exists." });
        const cwd = parent.worktreePath ?? project.value.workspaceRoot;
        let worktreePath = parent.worktreePath;
        let reviewRef: string | null = null;
        if (input.mode === "review") {
          if (!input.reviewRef)
            return yield* new ThreadToolError({
              message: "Choose a Git revision or checkpoint to review.",
            });
          const revision = yield* processes
            .run({
              command: "git",
              args: ["rev-parse", "--verify", "--end-of-options", `${input.reviewRef}^{commit}`],
              cwd,
              timeout: "10 seconds",
            })
            .pipe(Effect.mapError(failed("resolve review revision")));
          reviewRef = revision.stdout.trim();
          if (revision.code !== 0 || !/^[a-f0-9]{40,64}$/.test(reviewRef))
            return yield* new ThreadToolError({
              message: "The review revision is not an existing Git commit.",
            });
        } else {
          if (!input.worktreePath)
            return yield* new ThreadToolError({
              message: "Editing children require an existing separate Git worktree.",
            });
          worktreePath = yield* fs
            .realPath(input.worktreePath)
            .pipe(Effect.mapError(failed("resolve child worktree")));
          const parentPath = yield* fs
            .realPath(cwd)
            .pipe(Effect.mapError(failed("resolve parent worktree")));
          const listed = yield* processes
            .run({
              command: "git",
              args: ["worktree", "list", "--porcelain"],
              cwd,
              timeout: "10 seconds",
            })
            .pipe(Effect.mapError(failed("list worktrees")));
          const registered = yield* Effect.forEach(
            listed.stdout
              .split("\n")
              .filter((line) => line.startsWith("worktree "))
              .map((line) => line.slice(9)),
            (path) => fs.realPath(path).pipe(Effect.catch(() => Effect.succeed(path))),
          );
          if (
            listed.code !== 0 ||
            worktreePath === parentPath ||
            !registered.includes(worktreePath)
          )
            return yield* new ThreadToolError({
              message: "Use a separate registered worktree of the parent's repository.",
            });
        }
        if (input.mode === "review") {
          // Each reviewer reads a detached commit, never the parent's changing files.
          // A local clone keeps its own Git objects without inheriting hooks/config.
          worktreePath = path.join(config.worktreesDir, "coordination-reviews", id);
          yield* fs
            .makeDirectory(path.dirname(worktreePath), { recursive: true })
            .pipe(Effect.mapError(failed("prepare review directory")));
          const snapshotPath = worktreePath;
          yield* Effect.gen(function* () {
            const cloned = yield* processes.run({
              command: "git",
              args: [
                "clone",
                "--local",
                "--no-hardlinks",
                "--no-checkout",
                "--",
                cwd,
                snapshotPath,
              ],
              cwd,
              timeout: "30 seconds",
            });
            if (cloned.code !== 0)
              return yield* new ThreadToolError({
                message: `Could not clone the review revision: ${cloned.stderr.slice(0, 500)}`,
              });
            const checkout = yield* processes.run({
              command: "git",
              args: ["checkout", "--detach", reviewRef!],
              cwd: snapshotPath,
              timeout: "30 seconds",
            });
            if (checkout.code !== 0)
              return yield* new ThreadToolError({
                message: "Could not check out the review revision.",
              });
          }).pipe(
            Effect.onError(() => fs.remove(snapshotPath, { recursive: true }).pipe(Effect.ignore)),
            Effect.mapError(failed("prepare fixed review snapshot")),
          );
        }
        yield* coordinate({
          type: "spawn",
          child: {
            type: "thread.create",
            commandId: yield* commandId,
            threadId: id,
            projectId: parent.projectId,
            title: input.title,
            modelSelection,
            runtimeMode: input.mode === "review" ? "approval-required" : parent.runtimeMode,
            interactionMode: parent.interactionMode,
            branch: input.mode === "review" ? null : (input.branch ?? parent.branch),
            worktreePath,
            createdAt: yield* now,
          },
          prompt: input.prompt,
          mode: input.mode,
          reviewRef,
        }).pipe(
          Effect.onError(() =>
            input.mode === "review" && worktreePath
              ? fs.remove(worktreePath, { recursive: true }).pipe(Effect.ignore)
              : Effect.void,
          ),
        );
        return { threadId: id, modelSelection };
      }),
    assign_child: (input) =>
      coordinate({ type: "assign", childId: input.threadId, prompt: input.prompt }).pipe(
        Effect.as({ threadId: input.threadId }),
      ),
    report_to_parent: (input) =>
      coordinate({ type: "report", assignmentId: input.assignmentId, text: input.text }),
    wait_for_children: () => coordinate({ type: "wait" }),
    control_orchestration_layer: (input) =>
      Effect.gen(function* () {
        const parent = yield* requireThread();
        yield* engine
          .dispatch({
            type: "thread.coordination.control",
            commandId: yield* commandId,
            threadId: parent.id,
            action: input.action,
            createdAt: yield* now,
          })
          .pipe(Effect.mapError(failed("control the workflow")));
        return { threadId: parent.id };
      }),
    read_orchestration_layer: () =>
      Effect.gen(function* () {
        const caller = yield* requireThread();
        const parentId =
          caller.coordination?.role === "child" ? caller.coordination.parentId : caller.id;
        const parent = yield* requireThread(parentId);
        if (!parent.coordination || parent.coordination.role !== "parent")
          return yield* new ThreadToolError({ message: "Start a T3 orchestration layer first." });
        const snapshot = yield* snapshots
          .getShellSnapshot()
          .pipe(Effect.mapError(failed("read workflow")));
        return {
          parentId,
          coordination: parent.coordination,
          children: snapshot.threads.flatMap((child) =>
            child.coordination?.role === "child" && child.coordination.parentId === parentId
              ? [
                  {
                    threadId: child.id,
                    title: child.title,
                    modelSelection: child.modelSelection,
                    coordination: child.coordination,
                  },
                ]
              : [],
          ),
        };
      }),
    refresh_coordination_policy: () =>
      Effect.gen(function* () {
        const caller = yield* requireThread();
        if (caller.coordination?.role === "child")
          return yield* new ThreadToolError({
            message: "Only the parent can refresh model policy.",
          });
        return yield* policy.read(true).pipe(Effect.mapError(failed("refresh model policy")));
      }),

    list_thread_models: () =>
      Effect.gen(function* () {
        const parent = yield* requireThread();
        const catalog = yield* providers.getProviders;
        return {
          current: parent.modelSelection,
          providers: catalog.map((provider) => {
            const reason = unavailableReason(provider);
            const workflowReason = coordinationProviderIssue(provider.driver, "child");
            return {
              instanceId: provider.instanceId,
              driver: provider.driver,
              name: provider.displayName ?? provider.driver,
              available: reason === undefined,
              workflowSupported: workflowReason === undefined,
              ...(workflowReason ? { workflowReason } : {}),
              ...(reason ? { reason } : {}),
              models: provider.models.map((model) => ({
                model: model.slug,
                name: model.name,
                capabilities: model.capabilities,
              })),
            };
          }),
        };
      }),
    create_thread: (input) =>
      Effect.gen(function* () {
        const parent = yield* requireThread();
        if (
          parent.coordination?.role === "child" ||
          (parent.coordination?.role === "parent" &&
            ["active", "paused"].includes(parent.coordination.status))
        )
          return yield* new ThreadToolError({
            message:
              "T3 orchestration layer threads must use spawn_child. Child threads cannot create threads.",
          });
        const modelSelection = yield* resolveSelection(parent.modelSelection, input.modelSelection);
        const id = ThreadId.make(yield* uuid);
        const child = { ...parent, id, modelSelection };
        // Keep the initial prompt attached if an MCP client disconnects after creation.
        yield* startup
          .enqueueCommand(
            Effect.gen(function* () {
              const created = yield* engine
                .dispatch({
                  type: "thread.create",
                  commandId: yield* commandId,
                  threadId: id,
                  projectId: parent.projectId,
                  title: input.title,
                  modelSelection,
                  runtimeMode: parent.runtimeMode,
                  interactionMode: parent.interactionMode,
                  branch: parent.branch,
                  worktreePath: parent.worktreePath,
                  createdAt: yield* now,
                })
                .pipe(Effect.mapError(failed("create the thread")));
              yield* deletion.drainThrough(created.sequence);
              yield* startTurn(child, input.prompt, modelSelection);
            }).pipe(Effect.uninterruptible),
          )
          .pipe(Effect.mapError(failed("queue thread creation")));
        return { threadId: id, modelSelection };
      }),
    read_thread: (input) =>
      Effect.gen(function* () {
        const caller = yield* requireThread();
        if (
          caller.coordination?.role === "child" &&
          input.threadId !== undefined &&
          input.threadId !== caller.id
        )
          return yield* new ThreadToolError({
            message:
              "T3 orchestration layer children may read only their own thread. The parent supplies assignment context.",
          });
        const thread = yield* requireThread(input.threadId);
        const detail = yield* snapshots
          .getThreadDetailSnapshot(thread.id, {
            turnLimit: 3,
            ...(input.beforeCursor ? { beforeCursor: input.beforeCursor } : {}),
          })
          .pipe(Effect.mapError(failed("read thread history")));
        if (Option.isNone(detail))
          return yield* new ThreadToolError({ message: "The thread no longer exists." });
        let remaining = 48_000;
        const messages = detail.value.thread.messages
          .toReversed()
          .map((message) => {
            const text = message.text.slice(0, Math.min(16_000, remaining));
            remaining -= text.length;
            return { role: message.role, text, truncated: text.length !== message.text.length };
          })
          .toReversed();
        return {
          threadId: thread.id,
          title: thread.title,
          modelSelection: thread.modelSelection,
          coordination: detail.value.thread.coordination ?? null,
          latestTurn: thread.latestTurn,
          hasPendingApprovals: thread.hasPendingApprovals,
          hasPendingUserInput: thread.hasPendingUserInput,
          messages,
          beforeCursor: detail.value.page?.beforeCursor ?? null,
        };
      }),
    send_message_to_thread: (input) =>
      Effect.gen(function* () {
        const caller = yield* requireThread();
        if (caller.coordination)
          return yield* new ThreadToolError({
            message:
              "Use assign_child as the parent or report_to_parent as a child. Direct follow-ups bypass orchestration layer budgets.",
          });
        const thread = yield* requireThread(input.threadId);
        if (thread.latestTurn?.state === "running")
          return yield* new ThreadToolError({
            message:
              "The target thread is busy. Read its result or interrupt it before sending another turn.",
          });
        yield* startup
          .enqueueCommand(startTurn(thread, input.prompt))
          .pipe(Effect.mapError(failed("queue a follow-up turn")));
        return { threadId: thread.id };
      }),
    interrupt_thread: (input) =>
      Effect.gen(function* () {
        const caller = yield* requireThread();
        if (caller.coordination?.role === "child")
          return yield* new ThreadToolError({
            message: "Only the parent can interrupt orchestration layer threads.",
          });
        const thread = yield* requireThread(input.threadId);
        yield* startup
          .enqueueCommand(
            engine.dispatch({
              type: "thread.turn.interrupt",
              commandId: yield* commandId,
              threadId: thread.id,
              createdAt: yield* now,
            }),
          )
          .pipe(Effect.mapError(failed("interrupt the thread")));
        return { threadId: thread.id };
      }),
  });
});

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(make);
