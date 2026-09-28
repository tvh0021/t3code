import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  persist: vi.fn(),
  refresh: vi.fn(),
  settings: { coordinationModelLimits: { "gpt-6-sol": 2 } },
}));
vi.mock("../../hooks/useSettings", () => ({ useEnvironmentSettings: () => state.settings }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { updateSettings: "save", refreshProviders: "refresh" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "save" ? state.persist : state.refresh),
}));
vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("../ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));
import { CoordinationPolicySettings } from "./CoordinationPolicySettings";

let renderer: ReactTestRenderer;
const environmentId = EnvironmentId.make("remote-environment");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.persist.mockReset().mockResolvedValue({ _tag: "Success" });
  state.refresh.mockReset().mockResolvedValue({ _tag: "Failure" });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
const render = async (readOnly = false) => {
  await act(async () => {
    renderer = create(
      <CoordinationPolicySettings environmentId={environmentId} readOnly={readOnly} />,
    );
  });
};
const save = async () => {
  await act(async () => {
    await renderer.root.findAllByType("button")[0]!.props.onClick();
  });
};
const edit = async (value: string) => {
  await act(async () => renderer.root.findByType("textarea").props.onChange({ target: { value } }));
};

it("keeps invalid edits visible, then saves canonical limits for the selected environment", async () => {
  await render();
  await edit("gpt-6-sol=2\nopenai/gpt-6-sol=4");
  await save();
  expect(state.persist).not.toHaveBeenCalled();
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
    "already has a limit",
  );
  expect(renderer.root.findByType("textarea").props.value).toContain("openai/gpt-6-sol=4");
  await edit("openai/gpt-6-sol=2\nglm-5.3-flash=unlimited");
  await save();
  expect(state.persist).toHaveBeenCalledWith({
    environmentId,
    input: { patch: { coordinationModelLimits: { "gpt-6-sol": 2, "glm-5.3-flash": null } } },
  });
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
    "Active session budgets are unchanged",
  );
});

it("blocks edits without admin access and reports a failed maintenance refresh", async () => {
  await render(true);
  expect(renderer.root.findByType("textarea").props.disabled).toBe(true);
  expect(renderer.root.findAllByType("button").every((button) => button.props.disabled)).toBe(true);
  await act(async () =>
    renderer.update(<CoordinationPolicySettings environmentId={environmentId} readOnly={false} />),
  );
  await act(async () => {
    await renderer.root.findAllByType("button")[1]!.props.onClick();
  });
  expect(state.refresh).toHaveBeenCalledWith({
    environmentId,
    input: { refreshModels: true, refreshCoordinationPolicy: true },
  });
  expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
    "previous policy remains available",
  );
});
