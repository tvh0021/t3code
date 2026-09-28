import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId, ThreadId, type ThreadCoordinationSummary } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  snapshot: undefined as unknown,
  control: vi.fn(),
  toast: vi.fn(),
  report: undefined as unknown,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.snapshot }));
vi.mock("../../state/threads", () => ({
  threadEnvironment: { snapshotAtom: () => null, controlCoordination: "control" },
  useEnvironmentThread: () => ({ data: Option.fromNullishOr(state.report) }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.control }));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("../ui/dialog", () => {
  const Content = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Content,
    DialogPopup: Content,
    DialogHeader: Content,
    DialogTitle: Content,
    DialogDescription: Content,
    DialogTrigger: Content,
  };
});
import { ThreadCoordinationControl } from "./ThreadCoordinationControl";

const environmentId = EnvironmentId.make("remote");
const parentId = ThreadId.make("parent");
const childId = ThreadId.make("child");
const parent: ThreadCoordinationSummary = {
  role: "parent",
  status: "active",
  waiting: true,
  maxChildren: 4,
  budgets: [{ model: "gpt-6-sol", limit: 2, used: 1 }],
  policyUpdatedAt: "2026-09-27T00:00:00.000Z",
  blockedReason: null,
};
const snapshot = (
  status = parent.status,
  adopted = false,
  quotaHandoff?: Extract<ThreadCoordinationSummary, { role: "parent" }>["quotaHandoff"],
) => ({
  threads: [
    {
      id: parentId,
      title: "Parent",
      modelSelection: { instanceId: "codex", model: "gpt-6-sol" },
      coordination: { ...parent, status, ...(quotaHandoff ? { quotaHandoff } : {}) },
    },
    {
      id: childId,
      title: "Reviewer",
      modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
      coordination: {
        role: "child",
        parentId,
        assignmentId: "assignment",
        phase: "reported",
        report: { id: "assignment" },
        adopted,
        mode: "review",
        reviewRef: "revision",
      },
    },
  ],
});
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.snapshot = snapshot();
  state.report = undefined;
  state.control.mockReset();
  state.toast.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
const render = async (threadId = parentId) => {
  await act(async () => {
    renderer = create(
      <ThreadCoordinationControl environmentId={environmentId} threadId={threadId} />,
    );
  });
};
const button = (label: string) =>
  renderer.root.findAllByType("button").find((node) => node.children.join("") === label)!;

it("preserves reports after a failed pause, then follows persisted pause and completion states", async () => {
  state.control
    .mockResolvedValueOnce({ _tag: "Failure", cause: Cause.fail(new Error("Disconnected")) })
    .mockResolvedValue({ _tag: "Success" });
  await render();
  await act(async () => {
    button("Pause").props.onClick();
  });
  expect(state.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "Could not update T3 orchestration layer",
      description: "Error: Disconnected",
    }),
  );
  expect(button("Pause")).toBeDefined();
  await act(async () => {
    button("Pause").props.onClick();
  });
  expect(state.control).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: parentId, action: "pause" },
  });
  state.snapshot = snapshot("paused");
  await act(async () =>
    renderer.update(
      <ThreadCoordinationControl environmentId={environmentId} threadId={parentId} />,
    ),
  );
  expect(button("Resume")).toBeDefined();
  state.snapshot = snapshot("completed");
  await act(async () =>
    renderer.update(
      <ThreadCoordinationControl environmentId={environmentId} threadId={parentId} />,
    ),
  );
  expect(button("Resume")).toBeUndefined();
  expect(button("Complete")).toBeUndefined();
  expect(
    renderer.root
      .findAllByType("p")
      .some((node) => node.children.join("").includes("report assignment saved")),
  ).toBe(true);
  expect(
    renderer.root.findAllByType("a").some((node) => node.children.join("") === "Reviewer"),
  ).toBe(true);
});

it("shows a child report and parent navigation without exposing parent controls", async () => {
  state.report = {
    coordination: { role: "child", report: { id: "assignment", text: "Review result retained" } },
  };
  await render(childId);
  expect(button("Pause")).toBeUndefined();
  expect(button("Cancel")).toBeUndefined();
  expect(
    renderer.root
      .findAllByType("p")
      .some((node) => node.children.join("") === "Review result retained"),
  ).toBe(true);
  expect(
    renderer.root
      .findAllByType("a")
      .some((node) => node.children.join("").includes("Return to Parent")),
  ).toBe(true);
});

it("opts a parent into quota handoff and shows reset status with a source link", async () => {
  state.control.mockResolvedValue({ _tag: "Success" });
  await render();
  await act(async () => button("Enable quota handoff").props.onClick());
  expect(state.control).toHaveBeenCalledWith({
    environmentId,
    input: { threadId: parentId, action: "enable-quota-handoff" },
  });

  state.snapshot = snapshot("paused", false, {
    enabled: true,
    switchCount: 0,
    status: "waiting-reset",
    affectedThreadId: childId,
    sourceThreadId: childId,
    resetAt: "2026-09-27T01:00:00.000Z",
    reason: "Waiting for quota to reset.",
  });
  await act(async () =>
    renderer.update(
      <ThreadCoordinationControl environmentId={environmentId} threadId={parentId} />,
    ),
  );
  expect(button("Disable quota handoff")).toBeDefined();
  expect(
    renderer.root
      .findAllByProps({ role: "status" })
      .some((node) => node.children.join("").includes("Waiting for quota to reset.")),
  ).toBe(true);
  expect(
    renderer.root
      .findAllByType("a")
      .some((node) => node.children.join("").includes("Open source thread for this handoff")),
  ).toBe(true);
});
