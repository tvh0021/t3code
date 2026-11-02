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

it("fails automatic credential reads without a dialog while allowing explicit cookie imports", async () => {
  disableAutomaticKeychainPrompts();
  const readProtectedKey = async () => {
    if (!nativeState.allowed) throw new Error("interaction not allowed");
    return "test-key";
  };
  await expect(readProtectedKey()).rejects.toThrow("interaction not allowed");
  await expect(withKeychainUserInteraction(readProtectedKey)).resolves.toBe("test-key");
  await expect(readProtectedKey()).rejects.toThrow("interaction not allowed");
});

it("restores noninteractive access when an explicit import is denied", async () => {
  disableAutomaticKeychainPrompts();
  await expect(
    withKeychainUserInteraction(async () => {
      expect(nativeState.allowed).toBe(true);
      throw new Error("user denied access");
    }),
  ).rejects.toThrow("user denied access");
  expect(nativeState.allowed).toBe(false);
});

it("keeps interaction allowed until the last overlapping import settles", async () => {
  disableAutomaticKeychainPrompts();
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const firstRead = withKeychainUserInteraction(() => first.promise);
  const secondRead = withKeychainUserInteraction(() => second.promise);

  first.resolve("first-key");
  await expect(firstRead).resolves.toBe("first-key");
  expect(nativeState.allowed).toBe(true);
  second.resolve("second-key");
  await expect(secondRead).resolves.toBe("second-key");
  expect(nativeState.allowed).toBe(false);

  const denied = Promise.withResolvers<string>();
  const pending = Promise.withResolvers<string>();
  const deniedRead = withKeychainUserInteraction(() => denied.promise);
  const pendingRead = withKeychainUserInteraction(() => pending.promise);
  denied.reject(new Error("user denied access"));
  await expect(deniedRead).rejects.toThrow("user denied access");
  expect(nativeState.allowed).toBe(true);
  pending.resolve("pending-key");
  await expect(pendingRead).resolves.toBe("pending-key");
  expect(nativeState.allowed).toBe(false);
});

it("a failure to allow interaction leaves later imports working", async () => {
  disableAutomaticKeychainPrompts();
  loadMock.mockReturnValueOnce(-25);
  const read = vi.fn(async () => "never-read");
  await expect(withKeychainUserInteraction(read)).rejects.toThrow("(-25)");
  expect(read).not.toHaveBeenCalled();
  await expect(withKeychainUserInteraction(async () => nativeState.allowed)).resolves.toBe(true);
  expect(nativeState.allowed).toBe(false);
});

it("reports a failure to disable prompts instead of pretending it succeeded", () => {
  loadMock.mockReturnValue(-50);
  expect(disableAutomaticKeychainPrompts).toThrow("(-50)");
});
