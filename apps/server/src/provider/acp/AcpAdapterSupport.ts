import {
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  type ProviderAdapterError,
} from "../Errors.ts";
const isAcpProcessExitedError = Schema.is(EffectAcpErrors.AcpProcessExitedError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

export function mapAcpToAdapterError(
  provider: ProviderDriverKind,
  threadId: ThreadId,
  method: string,
  error: EffectAcpErrors.AcpError,
): ProviderAdapterError {
  if (isAcpProcessExitedError(error)) {
    return new ProviderAdapterSessionClosedError({
      provider,
      threadId,
      cause: error,
    });
  }
  if (isAcpRequestError(error)) {
    return new ProviderAdapterRequestError({
      provider,
      method,
      detail: error.message,
      cause: error,
    });
  }
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail: error.message,
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

export function selectAcpPermissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: ProviderApprovalDecision,
): string | undefined {
  const preferredKinds: ReadonlyArray<EffectAcpSchema.PermissionOption["kind"]> = (() => {
    switch (decision) {
      case "accept":
        return ["allow_once", "allow_always"];
      case "acceptForSession":
      case "acceptAlways":
        return ["allow_always", "allow_once"];
      case "decline":
        return ["reject_once", "reject_always"];
      case "cancel":
        return [];
    }
  })();

  for (const kind of preferredKinds) {
    const option = request.options.find(
      (candidate) => candidate.kind === kind && candidate.optionId.trim().length > 0,
    );
    if (option) return option.optionId;
  }
  return undefined;
}
