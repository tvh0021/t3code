import {
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { ACP_STDERR_TAIL_MAX_CHARS, sanitizeAcpStderrExcerpt } from "./AcpStderr.ts";
const isAcpProcessExitedError = Schema.is(EffectAcpErrors.AcpProcessExitedError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);
const isAcpTransportError = Schema.is(EffectAcpErrors.AcpTransportError);

export function mapAcpToAdapterError(
  provider: ProviderDriverKind,
  threadId: ThreadId,
  method: string,
  error: EffectAcpErrors.AcpError,
): ProviderAdapterError {
  if (isAcpProcessExitedError(error)) {
    return new ProviderAdapterProcessError({
      provider,
      threadId,
      detail: error.message,
      cause: error,
    });
  }
  if (isAcpRequestError(error)) {
    const nativeDetail =
      Predicate.isObject(error.data) &&
      "details" in error.data &&
      typeof error.data.details === "string"
        ? sanitizeAcpStderrExcerpt(error.data.details).slice(0, ACP_STDERR_TAIL_MAX_CHARS)
        : "";
    return new ProviderAdapterRequestError({
      provider,
      method: error.method ?? method,
      detail: nativeDetail ? `${error.message}: ${nativeDetail}` : error.message,
      cause: error,
    });
  }
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail:
      isAcpTransportError(error) && error.detail?.trim()
        ? `${error.message} ${error.detail.trim()}`
        : error.message,
    cause: error,
  });
}

export function acpPermissionOutcome(decision: ProviderApprovalDecision): string {
  switch (decision) {
    case "acceptForSession":
      return "allow-always";
    case "accept":
      return "allow-once";
    case "decline":
    default:
      return "reject-once";
  }
}
