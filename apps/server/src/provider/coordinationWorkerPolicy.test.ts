import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { coordinationProviderIssue } from "./coordinationWorkerPolicy.ts";

describe("coordination provider roles", () => {
  it("allows Antigravity as a child while keeping it unavailable as a parent", () => {
    const antigravity = ProviderDriverKind.make("antigravity");

    expect(coordinationProviderIssue(antigravity, "child")).toBeUndefined();
    expect(coordinationProviderIssue(antigravity, "parent")).toMatch(
      /does not forward T3 workflow tools/,
    );
  });

  it("keeps recursive workflow creation behind supported parent providers", () => {
    expect(coordinationProviderIssue(ProviderDriverKind.make("codex"), "parent")).toBeUndefined();
    expect(coordinationProviderIssue(ProviderDriverKind.make("cursor"), "child")).toMatch(
      /cannot safely run as a workflow child/,
    );
  });
});
