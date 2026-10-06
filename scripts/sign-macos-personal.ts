import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import {
  personalSigningDirectory,
  withPersonalSigningIdentity,
} from "./lib/personal-mac-signing.ts";

/** Keep Personal updates recognizable to macOS privacy grants and Keychain ACLs. */
export default async function sign(options: SignOptions): Promise<void> {
  await withPersonalSigningIdentity(personalSigningDirectory(), async ({ identity, keychain }) => {
    await signApplication({
      ...options,
      identity,
      keychain,
      identityValidation: false,
      preAutoEntitlements: false,
      batchCodesignCalls: true,
    });
  });
}
