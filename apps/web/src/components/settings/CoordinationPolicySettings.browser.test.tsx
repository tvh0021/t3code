import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";

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
import { CoordinationPolicySettings } from "./CoordinationPolicySettings";

const environmentId = EnvironmentId.make("remote-environment");

const setup = async (readOnly = false) => {
  state.persist.mockReset().mockResolvedValue({ _tag: "Success" });
  state.refresh.mockReset().mockResolvedValue({ _tag: "Failure" });
  return render(<CoordinationPolicySettings environmentId={environmentId} readOnly={readOnly} />, {
    router: false, // Isolated settings form has no router links
  });
};

const save = async () => {
  await userEvent.click(page.getByRole("button", { name: "Save limits" }));
};

const edit = async (value: string) => {
  await userEvent.fill(page.getByRole("textbox").first(), value);
};

it("keeps invalid edits visible, then saves canonical limits for the selected environment", async () => {
  await using screen = await setup();
  await edit("gpt-6-sol=2\nopenai/gpt-6-sol=4");
  await save();
  expect(state.persist).not.toHaveBeenCalled();
  expect(screen.container.querySelector('[role="status"]')?.textContent).toContain(
    "already has a limit",
  );
  expect(
    screen.container.querySelector<HTMLTextAreaElement>("#coordination-model-limits")?.value,
  ).toContain("openai/gpt-6-sol=4");
  await edit("openai/gpt-6-sol=2\nglm-5.3-flash=unlimited");
  await save();
  expect(state.persist).toHaveBeenCalledWith({
    environmentId,
    input: {
      patch: {
        coordinationModelLimits: { "gpt-sol": 2, "glm-flash": null },
      },
    },
  });
  expect(screen.container.querySelector('[role="status"]')?.textContent).toContain(
    "New delegated tasks use these limits",
  );
});

it("blocks edits without admin access and reports a failed maintenance refresh", async () => {
  await using screen = await setup(true);
  expect(
    screen.container.querySelector<HTMLTextAreaElement>("#coordination-model-limits")?.disabled,
  ).toBe(true);
  expect([...screen.container.querySelectorAll("button")].every((button) => button.disabled)).toBe(
    true,
  );
  await screen.rerender(
    <CoordinationPolicySettings environmentId={environmentId} readOnly={false} />,
  );
  await userEvent.click(page.getByRole("button", { name: "Refresh model policy" }));
  expect(state.refresh).toHaveBeenCalledWith({
    environmentId,
    input: { refreshModels: true, refreshCoordinationPolicy: true },
  });
  expect(screen.container.querySelector('[role="status"]')?.textContent).toContain(
    "previous policy remains available",
  );
});
