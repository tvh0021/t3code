// @effect-diagnostics nodeBuiltinImport:off - exercises provider-owned SQLite files on disk
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";

import {
  listAntigravityConversationDirs,
  readAntigravityConversation,
} from "./antigravityConversations.ts";

function varint(value: number): Buffer {
  const bytes: number[] = [];
  while (value >= 128) {
    bytes.push((value % 128) | 128);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function field(number: number, value: number | Buffer): Buffer {
  return typeof value === "number"
    ? Buffer.concat([varint(number * 8), varint(value)])
    : Buffer.concat([varint(number * 8 + 2), varint(value.length), value]);
}

describe("Antigravity conversation history", () => {
  it("finds the old desktop profile after the Personal state migration", async () => {
    const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ag-history-"));
    try {
      const oldDir = NodePath.join(
        home,
        ".t3",
        "userdata",
        "providers",
        "antigravity",
        "profile",
        "antigravity-acp",
        "conversations",
      );
      await NodeFSP.mkdir(oldDir, { recursive: true });
      const dirs = await listAntigravityConversationDirs(
        NodePath.join(home, ".t3-personal", "userdata"),
        home,
      );
      assert.include(dirs, oldDir);
      assert.notInclude(
        await listAntigravityConversationDirs(
          NodePath.join(home, "worktree", ".t3", "userdata"),
          home,
        ),
        oldDir,
      );
    } finally {
      await NodeFSP.rm(home, { recursive: true, force: true });
    }
  });

  // oxlint-disable-next-line t3code/no-global-process-runtime -- This filesystem fixture relies on Unix directory permissions.
  it.skipIf(NodeOS.platform() === "win32")(
    "reads a checkpointed WAL database with no sidecar files from a read-only directory",
    async () => {
      const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ag-wal-history-"));
      const dbPath = NodePath.join(home, "history.db");
      try {
        const db = new NodeSqlite.DatabaseSync(dbPath);
        db.exec("PRAGMA journal_mode=WAL");
        db.exec("CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB)");
        db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)");
        db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
          1,
          Buffer.from("gemini-3.8-flash-high"),
        );
        db.prepare("INSERT INTO steps VALUES (?, ?, ?)").run(
          1,
          15,
          Buffer.concat([
            field(6, field(1, Math.floor(Date.parse("2026-08-01T10:00:00Z") / 1000))),
            field(9, Buffer.concat([field(2, 100), field(5, 200), field(3, 50)])),
          ]),
        );
        db.close();
        await NodeFSP.rm(`${dbPath}-wal`, { force: true });
        await NodeFSP.rm(`${dbPath}-shm`, { force: true });
        await NodeFSP.chmod(home, 0o555);
        const records = readAntigravityConversation(dbPath);
        assert.equal(records?.length, 1);
        assert.deepEqual(records?.[0]?.totals, {
          uncachedInputTokens: 100,
          cachedInputTokens: 200,
          cacheCreationTokens: 0,
          outputTokens: 50,
          reasoningTokens: 0,
        });
      } finally {
        await NodeFSP.chmod(home, 0o755);
        await NodeFSP.rm(home, { recursive: true, force: true });
      }
    },
  );
});
