import {
  AbacusSettings,
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
  ZedSettings,
} from "@t3tools/contracts";
import { acpRegistryClient } from "@t3tools/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@t3tools/provider-core/client";
import { cursorClient } from "@t3tools/provider-cursor/client";
import { grokClient } from "@t3tools/provider-grok/client";
import { museClient } from "@t3tools/provider-muse/client";
import { openCodeClient } from "@t3tools/provider-opencode/client";
import { piClient } from "@t3tools/provider-pi/client";

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
  },
  {
    driverKind: ProviderDriverKind.make("abacus"),
    label: "ChatLLM",
    settingsSchema: AbacusSettings,
    // The server redacts the saved key; the field lets users set it per instance.
    environmentFields: [{ name: "ABACUS_API_KEY", label: "Abacus API key", sensitive: true }],
  },
  {
    driverKind: ProviderDriverKind.make("zed"),
    label: "Zed",
    badgeLabel: "Early Access",
    settingsSchema: ZedSettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);
