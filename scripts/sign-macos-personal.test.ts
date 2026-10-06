import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { expect, it, vi } from "vite-plus/test";
import { withPersonalSigningIdentity } from "./lib/personal-mac-signing.ts";
import sign from "./sign-macos-personal.ts";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));
vi.mock("./lib/personal-mac-signing.ts", () => ({
  personalSigningDirectory: () => "/personal-signing",
  withPersonalSigningIdentity: vi.fn(async (_directory, use) =>
    use({ identity: "certificate-fingerprint", keychain: "/temporary-signing.keychain-db" }),
  ),
}));

it("signs Personal builds with the persistent certificate and isolated keychain", async () => {
  const options = { app: "/tmp/T3 Code - Personal.app", identity: "-" } satisfies SignOptions;
  await sign(options);
  expect(withPersonalSigningIdentity).toHaveBeenCalledWith(
    "/personal-signing",
    expect.any(Function),
  );
  expect(signApplication).toHaveBeenCalledExactlyOnceWith({
    ...options,
    identity: "certificate-fingerprint",
    keychain: "/temporary-signing.keychain-db",
    identityValidation: false,
    preAutoEntitlements: false,
    batchCodesignCalls: true,
  });
});
