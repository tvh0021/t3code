import { beforeEach, expect, it, vi } from "vite-plus/test";

const { loadMock, openMock, nativeState } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  openMock: vi.fn(),
  nativeState: { allowed: true },
}));

vi.mock("node:module", () => ({
  createRequire: () => () => ({
    open: openMock,
    load: loadMock,
    DataType: { I32: 1, Boolean: 6 },
  }),
}));

import { disableAutomaticKeychainPrompts, withKeychainUserInteraction } from "./MacKeychain.ts";

beforeEach(() => {
  nativeState.allowed = true;
  loadMock.mockImplementation(({ paramsValue }) => {
    nativeState.allowed = paramsValue[0];
    return 0;
  });
});

it("fails automatic credential reads without a dialog while allowing explicit cookie imports", () => {
  disableAutomaticKeychainPrompts();
  const readProtectedKey = () => {
    if (!nativeState.allowed) throw new Error("interaction not allowed");
    return "test-key";
  };
  expect(readProtectedKey).toThrow("interaction not allowed");
  expect(withKeychainUserInteraction(readProtectedKey)).toBe("test-key");
  expect(readProtectedKey).toThrow("interaction not allowed");
});

it("restores noninteractive access when an explicit import is denied", () => {
  disableAutomaticKeychainPrompts();
  expect(() =>
    withKeychainUserInteraction(() => {
      expect(nativeState.allowed).toBe(true);
      throw new Error("user denied access");
    }),
  ).toThrow("user denied access");
  expect(nativeState.allowed).toBe(false);
});

it("reports a failure to disable prompts instead of pretending it succeeded", () => {
  loadMock.mockReturnValue(-50);
  expect(disableAutomaticKeychainPrompts).toThrow("(-50)");
});
