import type { ProviderDriverKind } from "@t3tools/contracts";

import {
  AcpRegistryAdapterV2Driver,
  type AcpRegistryAdapterV2DriverEnv,
} from "@t3tools/provider-acp-registry/server";
import {
  AbacusAdapterV2Driver,
  type AbacusAdapterV2DriverEnv,
} from "./Adapters/AbacusAdapterV2.ts";
import {
  ClaudeAdapterV2Driver,
  type ClaudeAdapterV2DriverEnv,
} from "./Adapters/ClaudeAdapterV2.ts";
import { CodexAdapterV2Driver, type CodexAdapterV2DriverEnv } from "./Adapters/CodexAdapterV2.ts";
import {
  CursorAdapterV2Driver,
  type CursorAdapterV2DriverEnv,
} from "@t3tools/provider-cursor/server";
import { GrokAdapterV2Driver, type GrokAdapterV2DriverEnv } from "@t3tools/provider-grok/server";
import {
  OpenCodeAdapterV2Driver,
  type OpenCodeAdapterV2DriverEnv,
} from "@t3tools/provider-opencode/server";
import { PiAdapterV2Driver, type PiAdapterV2DriverEnv } from "@t3tools/provider-pi/server";
import {
  ZedAdapterV2Driver,
  type ZedAdapterV2DriverEnv,
} from "./Adapters/ZedAdapterV2.ts";
import type { AnyProviderAdapterDriver } from "@t3tools/provider-core/server/adapterDriver";

export type BuiltInProviderAdapterDriversV2Env =
  | AbacusAdapterV2DriverEnv
  | AcpRegistryAdapterV2DriverEnv
  | ClaudeAdapterV2DriverEnv
  | CodexAdapterV2DriverEnv
  | CursorAdapterV2DriverEnv
  | GrokAdapterV2DriverEnv
  | OpenCodeAdapterV2DriverEnv
  | PiAdapterV2DriverEnv
  | ZedAdapterV2DriverEnv;

const BUILT_IN_PROVIDER_ADAPTER_DRIVERS_V2: ReadonlyArray<
  AnyProviderAdapterDriver<BuiltInProviderAdapterDriversV2Env>
> = [
  CodexAdapterV2Driver,
  ClaudeAdapterV2Driver,
  CursorAdapterV2Driver,
  OpenCodeAdapterV2Driver,
  GrokAdapterV2Driver,
  PiAdapterV2Driver,
  AcpRegistryAdapterV2Driver,
  ZedAdapterV2Driver,
  AbacusAdapterV2Driver,
];

export const BUILT_IN_PROVIDER_ADAPTER_DRIVER_KINDS_V2: ReadonlySet<ProviderDriverKind> = new Set(
  BUILT_IN_PROVIDER_ADAPTER_DRIVERS_V2.map((driver) => driver.driverKind),
);
