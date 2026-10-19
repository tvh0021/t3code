import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const state = vi.hoisted(() => ({
  persist: vi.fn(),
  refresh: vi.fn(),
  settings: {
    coordinationModelLimits: { "gpt-6-sol": 2 },
    coordinationQuotaHandoffThresholdPercent: 95,
    coordinationQuotaHandoffFallbacks: {
      "gpt-6-sol": ["claude-opus-5"],
      "gpt-6-astra": ["claude-fable-5-1"],
      "gpt-6-luna": ["gemini-3.8-flash-high"],
    },
  },
}));
vi.mock("../../hooks/useSettings", () => ({ useEnvironmentSettings: () => state.settings }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { updateSettings: "save", refreshProviders: "refresh" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "save" ? state.persist : state.refresh),
}));
import { CoordinationPolicySettings } from "./CoordinationPolicySettings";

let root: Root;
let container: HTMLDivElement;
const environmentId = EnvironmentId.make("remote-environment");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.persist.mockReset().mockResolvedValue({ _tag: "Success" });
  state.refresh.mockReset().mockResolvedValue({ _tag: "Failure" });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = async (readOnly = false) => {
  await act(async () => {
    root.render(<CoordinationPolicySettings environmentId={environmentId} readOnly={readOnly} />);
  });
};
const save = async () => {
  await act(async () => {
    await userEvent.click(page.getByRole("button", { name: "Save limits" }));
  });
};
const edit = async (value: string) => {
  await act(async () => userEvent.fill(page.getByRole("textbox").first(), value));
};

it("keeps invalid edits visible, then saves canonical limits for the selected environment", async () => {
  await render();
  await edit("gpt-6-sol=2\nopenai/gpt-6-sol=4");
  await save();
  expect(state.persist).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("already has a limit");
  expect(
    container.querySelector<HTMLTextAreaElement>("#coordination-model-limits")?.value,
  ).toContain("openai/gpt-6-sol=4");
  await edit("openai/gpt-6-sol=2\nglm-5.3-flash=unlimited");
  await save();
  expect(state.persist).toHaveBeenCalledWith({
    environmentId,
    input: {
      patch: {
        coordinationModelLimits: { "gpt-sol": 2, "glm-flash": null },
        coordinationQuotaHandoffFallbacks: state.settings.coordinationQuotaHandoffFallbacks,
        coordinationQuotaHandoffThresholdPercent: 95,
      },
    },
  });
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "New delegated tasks use these limits",
  );
});

it("blocks edits without admin access and reports a failed maintenance refresh", async () => {
  await render(true);
  expect(container.querySelector<HTMLTextAreaElement>("#coordination-model-limits")?.disabled).toBe(
    true,
  );
  expect([...container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  await act(async () =>
    root.render(<CoordinationPolicySettings environmentId={environmentId} readOnly={false} />),
  );
  await act(async () => {
    await userEvent.click(page.getByRole("button", { name: "Refresh model policy" }));
  });
  expect(state.refresh).toHaveBeenCalledWith({
    environmentId,
    input: { refreshModels: true, refreshCoordinationPolicy: true },
  });
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "previous policy remains available",
  );
});

it("saves the environment quota threshold and ordered fallback mappings", async () => {
  await render();
  await act(async () => {
    await userEvent.fill(page.getByRole("spinbutton"), "90");
    await userEvent.fill(
      page.getByRole("textbox").last(),
      "gpt-6-sol=claude-opus-5.5,claude-opus-5",
    );
  });
  await save();
  expect(state.persist).toHaveBeenCalledWith({
    environmentId,
    input: {
      patch: {
        coordinationModelLimits: { "gpt-sol": 2 },
        coordinationQuotaHandoffThresholdPercent: 90,
        coordinationQuotaHandoffFallbacks: {
          "gpt-6-sol": ["claude-opus-5.5", "claude-opus-5"],
        },
      },
    },
  });
});
