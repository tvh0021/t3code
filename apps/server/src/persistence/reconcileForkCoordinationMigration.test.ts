import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

describe("personal ThreadCoordination migration upgrade", () => {
  it.effect("runs main's migration 54 for databases that recorded the personal one", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });
      yield* Migrator.make({})({
        loader: Migrator.fromRecord({
          "54_ThreadCoordination": Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`ALTER TABLE projection_threads ADD COLUMN coordination_json TEXT`;
          }),
        }),
      });

      const executed = yield* runMigrations();
      assert.deepStrictEqual(executed[0], [54, "ProjectionThreadsAutoSettleDisabledAt"]);
      assert.deepStrictEqual(yield* runMigrations(), []);

      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        history.map((row) => [row.migration_id, row.name] as const),
        migrationManifest,
      );
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
      assert.isTrue(columns.some((column) => column.name === "auto_settle_disabled_at"));
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
