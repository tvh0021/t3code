import type { ThreadId } from "@t3tools/contracts";
import type * as Path from "effect/Path";
import type { ServerDerivedPaths } from "../config.ts";

export function coordinationReviewDir(
  config: Pick<ServerDerivedPaths, "worktreesDir">,
  id: ThreadId,
  path: Pick<Path.Path, "join">,
): string {
  return path.join(config.worktreesDir, "coordination-reviews", id);
}
