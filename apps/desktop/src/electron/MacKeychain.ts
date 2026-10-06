// @effect-diagnostics nodeBuiltinImport:off - Load the existing native binding synchronously before Electron initializes its macOS encryption key.
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(import.meta.url);
let binding: typeof import("ffi-rs") | undefined;
let automaticPromptsDisabled = false;

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
export function withKeychainUserInteraction<A>(read: () => A): A {
  if (!automaticPromptsDisabled) return read();
  setUserInteractionAllowed(true);
  try {
    return read();
  } finally {
    setUserInteractionAllowed(false);
  }
}
