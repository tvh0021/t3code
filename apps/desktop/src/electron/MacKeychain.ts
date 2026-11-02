// @effect-diagnostics nodeBuiltinImport:off - Load the existing native binding synchronously before Electron initializes its macOS encryption key.
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(import.meta.url);
let binding: typeof import("ffi-rs") | undefined;
let automaticPromptsDisabled = false;
let interactiveReads = 0;

function setUserInteractionAllowed(allowed: boolean) {
  if (binding === undefined) {
    binding = require("ffi-rs") as typeof import("ffi-rs");
    binding.open({
      library: "t3-mac-security",
      path: "/System/Library/Frameworks/Security.framework/Security",
    });
  }
  const status = binding.load({
    library: "t3-mac-security",
    funcName: "SecKeychainSetUserInteractionAllowed",
    retType: binding.DataType.I32,
    paramsType: [binding.DataType.Boolean],
    paramsValue: [allowed],
  });
  if (status !== 0) throw new Error(`Could not configure macOS Keychain interaction (${status}).`);
}

/** Locked or unapproved keys must fail normally instead of interrupting app launch. */
export function disableAutomaticKeychainPrompts() {
  setUserInteractionAllowed(false);
  automaticPromptsDisabled = true;
}

/** A browser-cookie import is an explicit request to access another app's key. */
export async function withKeychainUserInteraction<A>(read: () => Promise<A>): Promise<A> {
  if (!automaticPromptsDisabled) return read();
  // The setting is process-wide, so the last of overlapping reads turns it off.
  if (interactiveReads === 0) setUserInteractionAllowed(true);
  interactiveReads += 1;
  try {
    return await read();
  } finally {
    interactiveReads -= 1;
    if (interactiveReads === 0) setUserInteractionAllowed(false);
  }
}
