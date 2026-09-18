// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off cryptoRandomUUID:off cryptoRandomUUIDInEffect:off globalDate:off globalTimersInEffect:off unknownInEffectCatch:off anyUnknownInErrorContext:off
/**
 * Antigravity subscription usage limits.
 *
 * Antigravity connects to Google Cloud Code Private API (CCPA) to retrieve
 * user quota summaries. The official Antigravity ACP binary (`agy_acp_server`)
 * restricts model selection exclusively to Gemini models; third-party models
 * (Claude / GPT-OSS) are not usable through ACP sessions. Therefore, this module
 * filters the quota summary down to available Gemini quota windows.
 *
 * This module authenticates using stored OAuth credentials from `acp_token.json`,
 * performs token refresh when needed, resolves the Google-managed companion
 * project via `loadCodeAssist`, queries `retrieveUserQuotaSummary`, and maps
 * the Gemini quota buckets into T3 Code's standardized `ServerProviderUsageLimits`
 * windows.
 *
 * @module provider/Layers/antigravityUsageLimits
 */
import type {
  AntigravityAuthMethod,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../providerUsageLimits.ts";

export const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID ?? "";
export const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET ?? "";

const PROD_CCPA_BASE_URL = "https://cloudcode-pa.googleapis.com";
const DAILY_CCPA_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
const TOKEN_REFRESH_URL = "https://oauth2.googleapis.com/token";

class AntigravityUsageLimitsError extends Data.TaggedError("AntigravityUsageLimitsError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export const AntigravityQuotaBucket = Schema.Struct({
  bucketId: Schema.String,
  displayName: Schema.optional(Schema.String),
  window: Schema.optional(Schema.String),
  resetTime: Schema.optional(Schema.String),
  remainingFraction: Schema.optional(Schema.Finite),
  description: Schema.optional(Schema.String),
});
export type AntigravityQuotaBucket = typeof AntigravityQuotaBucket.Type;

export const AntigravityQuotaGroup = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  buckets: Schema.optional(Schema.Array(AntigravityQuotaBucket)),
});
export type AntigravityQuotaGroup = typeof AntigravityQuotaGroup.Type;

export const AntigravityRetrieveUserQuotaSummaryResponse = Schema.Struct({
  groups: Schema.optional(Schema.Array(AntigravityQuotaGroup)),
  buckets: Schema.optional(Schema.Array(AntigravityQuotaBucket)),
  description: Schema.optional(Schema.String),
});
export type AntigravityRetrieveUserQuotaSummaryResponse =
  typeof AntigravityRetrieveUserQuotaSummaryResponse.Type;

export const AntigravityTokenFile = Schema.Struct({
  client_id: Schema.optional(Schema.String),
  client_secret: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  access_token: Schema.optional(Schema.String),
  token_uri: Schema.optional(Schema.String),
  scopes: Schema.optional(Schema.Array(Schema.String)),
  project_id: Schema.optional(Schema.String),
});
export type AntigravityTokenFile = typeof AntigravityTokenFile.Type;

const decodeTokenFile = Schema.decodeUnknownEffect(Schema.fromJsonString(AntigravityTokenFile));

function resolveBucketKind(bucket: AntigravityQuotaBucket): ServerProviderUsageWindow["kind"] {
  const windowStr = (bucket.window || bucket.bucketId).toLowerCase();
  if (windowStr.includes("5h") || windowStr.includes("session")) return "session";
  if (windowStr.includes("week")) return "weekly";
  if (windowStr.includes("month")) return "monthly";
  return "other";
}

function resolveBucketLabel(bucket: AntigravityQuotaBucket): string {
  const kind = resolveBucketKind(bucket);
  if (kind === "session") return "Session";
  if (kind === "weekly") return "Weekly";
  if (kind === "monthly") return "Monthly";
  return bucket.displayName || bucket.bucketId || "Limit";
}

function resolveBucketDurationMins(bucket: AntigravityQuotaBucket): number | undefined {
  const windowStr = (bucket.window || bucket.bucketId).toLowerCase();
  if (windowStr.includes("5h") || windowStr.includes("session")) return 300; // 5 hours in minutes
  if (windowStr.includes("week")) return 10080; // 7 days in minutes
  if (windowStr.includes("month")) return 43200; // 30 days in minutes
  return undefined;
}

/**
 * Transforms Antigravity quota summary response into standardized `ServerProviderUsageLimits`.
 *
 * Excludes third-party models (Claude / GPT-OSS) since the official Antigravity ACP binary
 * explicitly restricts model selection to Gemini models.
 */
export function antigravityQuotaSummaryToLimits(
  response: AntigravityRetrieveUserQuotaSummaryResponse,
  checkedAt: string,
): ServerProviderUsageLimits {
  const windows: ServerProviderUsageWindow[] = [];

  const processBucket = (bucket: AntigravityQuotaBucket, groupName?: string) => {
    if (bucket.remainingFraction === undefined || !Number.isFinite(bucket.remainingFraction)) {
      return;
    }

    const bucketId = bucket.bucketId ?? "";
    const lowerGroup = (groupName ?? "").toLowerCase();

    // Skip third-party (Claude / GPT) models: they are not usable through Antigravity ACP.
    if (lowerGroup.includes("claude") || lowerGroup.includes("gpt") || bucketId.startsWith("3p")) {
      return;
    }

    const remaining = Math.max(0, Math.min(1, bucket.remainingFraction));
    const usedPercent = clampPercent((1 - remaining) * 100);

    let resetsAt: string | undefined;
    if (bucket.resetTime) {
      const parsedEpoch = Date.parse(bucket.resetTime);
      if (Number.isFinite(parsedEpoch)) {
        const dt = DateTime.make(parsedEpoch);
        if (Option.isSome(dt)) {
          resetsAt = DateTime.formatIso(dt.value);
        }
      }
    }

    const durationMins = resolveBucketDurationMins(bucket);

    windows.push({
      id: bucket.bucketId,
      kind: resolveBucketKind(bucket),
      label: resolveBucketLabel(bucket),
      usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
      ...(durationMins !== undefined ? { windowDurationMins: durationMins } : {}),
    });
  };

  if (response.groups && response.groups.length > 0) {
    for (const group of response.groups) {
      if (group.buckets) {
        for (const bucket of group.buckets) {
          processBucket(bucket, group.displayName);
        }
      }
    }
  } else if (response.buckets && response.buckets.length > 0) {
    for (const bucket of response.buckets) {
      processBucket(bucket);
    }
  }

  windows.sort((a, b) => (a.windowDurationMins ?? 0) - (b.windowDurationMins ?? 0));

  return windows.length > 0
    ? makeUsageLimits({ checkedAt, windows })
    : makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
}

interface CachedTokenInfo {
  readonly accessToken: string;
  readonly expiresAtEpochMs: number;
  readonly projectId?: string | undefined;
  readonly endpoint?: string | undefined;
}

const tokenCache = new Map<string, CachedTokenInfo>();

export interface ReadAntigravityUsageLimitsOptions {
  readonly tokenPath: string;
  readonly authMethod?: AntigravityAuthMethod | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

export const readAntigravityUsageLimits = Effect.fn("readAntigravityUsageLimits")(function* (
  options: ReadAntigravityUsageLimitsOptions,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);

  if (options.authMethod && options.authMethod !== "oauth-personal") {
    return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
  }

  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcessPlatform.pipe(Effect.orElseSucceed(() => process.platform));
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const exists = yield* fs.exists(options.tokenPath).pipe(Effect.orElseSucceed(() => false));
  if (!exists) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: "No Antigravity credentials file found.",
    });
  }

  const rawTokenContent = yield* fs.readFileString(options.tokenPath).pipe(
    Effect.mapError(
      (err) =>
        new AntigravityUsageLimitsError({
          detail: `Failed to read Antigravity token file: ${err instanceof Error ? err.message : String(err)}`,
        }),
    ),
    Effect.result,
  );

  if (rawTokenContent._tag === "Failure") {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: rawTokenContent.failure.detail,
    });
  }

  const parsedToken = yield* decodeTokenFile(rawTokenContent.success).pipe(
    Effect.mapError(
      (err) =>
        new AntigravityUsageLimitsError({
          detail: `Failed to parse Antigravity token JSON: ${err instanceof Error ? err.message : String(err)}`,
        }),
    ),
    Effect.result,
  );

  if (parsedToken._tag === "Failure") {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: parsedToken.failure.detail,
    });
  }

  const tokenData = parsedToken.success;
  const refreshToken = tokenData.refresh_token?.trim();
  if (!refreshToken) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: "Antigravity credentials missing refresh token.",
    });
  }

  const clientId = tokenData.client_id?.trim() || ANTIGRAVITY_CLIENT_ID;
  const clientSecret = tokenData.client_secret?.trim() || ANTIGRAVITY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: "Antigravity credentials missing client ID or secret.",
    });
  }
  const tokenUri = tokenData.token_uri?.trim() || TOKEN_REFRESH_URL;

  const cached = tokenCache.get(options.tokenPath);
  const now = yield* Clock.currentTimeMillis;

  return yield* Effect.promise(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let accessToken: string;
        let projectId: string | undefined = cached?.projectId ?? tokenData.project_id?.trim();
        let endpoint: string = cached?.endpoint ?? DAILY_CCPA_BASE_URL;

        if (cached && now < cached.expiresAtEpochMs - 60_000) {
          accessToken = cached.accessToken;
        } else {
          // 1. Refresh OAuth access token
          const refreshResp = await fetchFn(tokenUri, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
              grant_type: "refresh_token",
            }),
            signal: controller.signal,
          });

          if (!refreshResp.ok) {
            const errBody = await refreshResp.text().catch(() => "");
            return makeUnavailableUsageLimits({
              checkedAt,
              reason: "probeFailed",
              message: `OAuth token refresh failed with HTTP ${refreshResp.status}: ${errBody}`,
            });
          }

          const refreshJson = (await refreshResp.json()) as {
            access_token?: string;
            expires_in?: number;
          };
          if (!refreshJson.access_token) {
            return makeUnavailableUsageLimits({
              checkedAt,
              reason: "probeFailed",
              message: "OAuth token refresh returned no access token.",
            });
          }

          accessToken = refreshJson.access_token;
          const expiresInSec = refreshJson.expires_in ?? 3600;
          tokenCache.set(options.tokenPath, {
            accessToken,
            expiresAtEpochMs: now + expiresInSec * 1000,
            projectId,
            endpoint,
          });
        }

        const userAgent = `antigravity/acp/0.1.0 (aidev_client; os_type=${platform}; arch=${process.arch}; host_path=t3code/0.1.0; proxy_client=antigravity/sdk)`;
        const authHeaders: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": userAgent,
        };

        // 2. If project or endpoint not resolved, call loadCodeAssist
        if (!projectId || !cached?.endpoint) {
          const loadResp = await fetchFn(`${PROD_CCPA_BASE_URL}/v1internal:loadCodeAssist`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
            signal: controller.signal,
          });

          if (loadResp.ok) {
            const loadJson = (await loadResp.json()) as {
              cloudaicompanionProject?: string;
              paidTier?: { usesGcpTos?: boolean };
            };
            projectId = loadJson.cloudaicompanionProject || projectId || "aicode-consumers";
            const usesGcpTos = loadJson.paidTier?.usesGcpTos ?? false;
            endpoint = usesGcpTos ? PROD_CCPA_BASE_URL : DAILY_CCPA_BASE_URL;

            const existing = tokenCache.get(options.tokenPath);
            if (existing) {
              tokenCache.set(options.tokenPath, {
                ...existing,
                projectId,
                endpoint,
              });
            }
          } else {
            // Fallback defaults
            projectId = projectId || "aicode-consumers";
            endpoint = DAILY_CCPA_BASE_URL;
          }
        }

        // 3. Call retrieveUserQuotaSummary
        const quotaResp = await fetchFn(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ project: projectId }),
          signal: controller.signal,
        });

        if (!quotaResp.ok) {
          const errBody = await quotaResp.text().catch(() => "");
          return makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            message: `Quota summary request failed with HTTP ${quotaResp.status}: ${errBody}`,
          });
        }

        const quotaJson = (await quotaResp.json()) as AntigravityRetrieveUserQuotaSummaryResponse;
        return antigravityQuotaSummaryToLimits(quotaJson, checkedAt);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: `Failed to retrieve Antigravity usage limits: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
});
