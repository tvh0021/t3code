import {
  CoordinationQuotaHandoff,
  ThreadCoordinationSummary,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  getCoordinationActions,
  getCoordinationChildReportStatus,
  getCoordinationQuotaHandoff,
} from "./coordinationControl.ts";

const parent = ThreadCoordinationSummary.members[0].make({
  role: "parent",
  status: "active",
  waiting: false,
  maxChildren: 3,
  budgets: [],
  policyUpdatedAt: "2026-10-13T00:00:00.000Z",
  blockedReason: null,
});
const child = ThreadCoordinationSummary.members[1].make({
  role: "child",
  parentId: ThreadId.make("parent"),
  assignmentId: TrimmedNonEmptyString.make("assignment"),
  phase: "reported",
  report: { id: TrimmedNonEmptyString.make("report") },
  adopted: false,
  mode: "edit",
  reviewRef: null,
});
const handoff = CoordinationQuotaHandoff.make({
  enabled: true,
  switchCount: 0,
  status: "watching",
});

describe("coordination actions", () => {
  it("offers pause or resume, completion and cancellation for a live parent", () => {
    expect(getCoordinationActions(parent)).toEqual({
      session: ["pause", "complete", "cancel"],
      quotaHandoff: "enable-quota-handoff",
    });
    expect(getCoordinationActions({ ...parent, status: "paused", quotaHandoff: handoff })).toEqual({
      session: ["resume", "complete", "cancel"],
      quotaHandoff: "disable-quota-handoff",
    });
    expect(
      getCoordinationActions({ ...parent, quotaHandoff: { ...handoff, enabled: false } })
        ?.quotaHandoff,
    ).toBe("enable-quota-handoff");
  });

  it("offers no controls for ended parents, children or missing coordination", () => {
    expect(getCoordinationActions({ ...parent, status: "completed" })).toBeNull();
    expect(getCoordinationActions({ ...parent, status: "cancelled" })).toBeNull();
    expect(getCoordinationActions(child)).toBeNull();
    expect(getCoordinationActions(null)).toBeNull();
    expect(getCoordinationActions(undefined)).toBeNull();
  });
});

it("keeps quota state and shows only handoff links away from the parent", () => {
  const parentId = ThreadId.make("parent");
  const otherId = ThreadId.make("other");
  expect(getCoordinationQuotaHandoff(undefined, parentId)).toEqual({
    handoff: undefined,
    enabled: false,
    destinationThreadId: undefined,
    sourceThreadId: undefined,
  });
  const outgoing = { ...handoff, sourceThreadId: parentId, destinationThreadId: otherId };
  expect(getCoordinationQuotaHandoff(outgoing, parentId)).toEqual({
    handoff: outgoing,
    enabled: true,
    destinationThreadId: otherId,
    sourceThreadId: undefined,
  });
  const incoming = { ...handoff, sourceThreadId: otherId, destinationThreadId: parentId };
  expect(getCoordinationQuotaHandoff(incoming, parentId)).toEqual({
    handoff: incoming,
    enabled: true,
    destinationThreadId: undefined,
    sourceThreadId: otherId,
  });
});

it("keeps adopted reports delivered and saves undelivered reports when the layer ends", () => {
  expect(getCoordinationChildReportStatus(child, false)).toBe("waiting");
  expect(getCoordinationChildReportStatus(child, true)).toBe("saved");
  expect(getCoordinationChildReportStatus({ ...child, adopted: true }, false)).toBe("delivered");
  expect(getCoordinationChildReportStatus({ ...child, adopted: true }, true)).toBe("delivered");
  expect(getCoordinationChildReportStatus({ ...child, report: null }, true)).toBeUndefined();
});
