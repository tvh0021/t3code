import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import AutoSettleDisabledAt from "./Migrations/054_ProjectionThreadsAutoSettleDisabledAt.ts";

// Personal builds before the orchestration-v2 sync recorded 54 as ThreadCoordination,
// which would make the migrator skip main's 54. Its coordination_json column is left
// in place and unread.
export const reconcileForkCoordinationMigration = Effect.fn("reconcileForkCoordinationMigration")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
        if (tables.length === 0) return [];
        const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 54
        `;
        const legacy = history.find(
          (row) => row.migration_id === 54 && row.name === "ThreadCoordination",
        );
        if (!legacy) return [];
        if (history.length > 1) {
          return yield* new Migrator.MigrationError({
            kind: "BadState",
            message: "Cannot upgrade personal ThreadCoordination migration with later migrations.",
          });
        }
        yield* AutoSettleDisabledAt;
        yield* sql`UPDATE effect_sql_migrations SET name = 'ProjectionThreadsAutoSettleDisabledAt' WHERE migration_id = 54`;
        return [[54, "ProjectionThreadsAutoSettleDisabledAt"] as const];
      }),
    );
  },
);
