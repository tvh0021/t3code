import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  normalizeProviderAccentColor,
  providerInstanceInitials,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
} from "./providerInstanceDisplay.ts";

const codex = ProviderDriverKind.make("codex");
const claude = ProviderDriverKind.make("claudeAgent");
const abacus = ProviderDriverKind.make("abacus");

describe("resolveProviderInstanceDisplayName", () => {
  it("keeps a snapshot name that differs from the brand label", () => {
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: ProviderInstanceId.make("codex"),
        driver: codex,
        displayName: "Work",
      }),
    ).toBe("Work");
  });

  it("humanizes a custom instance id when the snapshot only carries the brand label", () => {
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: ProviderInstanceId.make("codex_personal"),
        driver: codex,
        displayName: "Codex",
      }),
    ).toBe("Codex Personal");
  });

  it("uses the brand label for the default instance", () => {
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: ProviderInstanceId.make("codex"),
        driver: codex,
      }),
    ).toBe("Codex");
  });

  it("migrates legacy Abacus snapshot displayName to ChatLLM", () => {
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: ProviderInstanceId.make("abacus"),
        driver: abacus,
        displayName: "Abacus",
      }),
    ).toBe("ChatLLM");
  });
});

describe("providerInstanceInitials", () => {
  it("takes the first two characters of a single word", () => {
    expect(providerInstanceInitials("Codex")).toBe("CO");
  });

  it("takes the first character of each of the first two words", () => {
    expect(providerInstanceInitials("Codex Personal")).toBe("CP");
  });

  it("handles empty strings", () => {
    expect(providerInstanceInitials("")).toBe("");
  });

  it("handles single-character labels", () => {
    expect(providerInstanceInitials("X")).toBe("X");
  });
});

describe("normalizeProviderAccentColor", () => {
  it("accepts six-digit hex colors", () => {
    expect(normalizeProviderAccentColor("#ff00aa")).toBe("#ff00aa");
    expect(normalizeProviderAccentColor("#123456")).toBe("#123456");
  });

  it("rejects non-hex or malformed colors", () => {
    expect(normalizeProviderAccentColor("red")).toBeUndefined();
    expect(normalizeProviderAccentColor("#fff")).toBeUndefined();
    expect(normalizeProviderAccentColor("#12345678")).toBeUndefined();
    expect(normalizeProviderAccentColor("")).toBeUndefined();
    expect(normalizeProviderAccentColor(undefined)).toBeUndefined();
  });
});

describe("shouldShowInstanceBadge", () => {
  it("always flags custom instances", () => {
    expect(
      shouldShowInstanceBadge({ instanceId: "codex_personal", isDefault: false }, [
        { instanceId: "codex_personal" },
      ]),
    ).toBe(true);
  });

  it("suppresses the badge on the default instance when alone", () => {
    expect(
      shouldShowInstanceBadge({ instanceId: "codex", isDefault: true }, [{ instanceId: "codex" }]),
    ).toBe(false);
  });

  it("shows the badge on the default instance when siblings exist", () => {
    expect(
      shouldShowInstanceBadge({ instanceId: "codex", isDefault: true }, [
        { instanceId: "codex" },
        { instanceId: "codex_personal" },
      ]),
    ).toBe(true);
  });

  it("suppresses the badge on default instances across different driver kinds", () => {
    expect(
      shouldShowInstanceBadge({ driverKind: codex, isDefault: true }, [
        { driverKind: codex },
        { driverKind: abacus },
        { driverKind: claude },
      ]),
    ).toBe(false);
  });

  it("shows the badge when multiple instances of the same driver kind exist", () => {
    expect(
      shouldShowInstanceBadge({ driverKind: codex, isDefault: true }, [
        { driverKind: codex },
        { driverKind: codex },
        { driverKind: abacus },
      ]),
    ).toBe(true);
  });

  it("shows the badge if accentColor is set", () => {
    expect(
      shouldShowInstanceBadge({ driverKind: codex, accentColor: "#ff0000" }, [
        { driverKind: codex },
      ]),
    ).toBe(true);
  });
});
