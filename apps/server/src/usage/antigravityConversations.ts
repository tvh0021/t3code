// @effect-diagnostics nodeBuiltinImport:off - reads provider-owned SQLite files without modifying them
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

import type { UsageRecord } from "./usageTranscripts.ts";

interface FieldMap extends Map<number, number | Buffer> {}

function readVarint(bytes: Buffer, offset: number): [number, number] | null {
  let value = 0;
  let shift = 0;
  while (offset < bytes.length && shift <= 49) {
    const byte = bytes[offset++]!;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, offset];
    shift += 7;
  }
  return null;
}

function fields(bytes: Buffer): FieldMap {
  const result: FieldMap = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    if (!tag) break;
    offset = tag[1];
    const number = Math.floor(tag[0] / 8);
    const wire = tag[0] & 7;
    if (number === 0) break;
    if (wire === 0) {
      const value = readVarint(bytes, offset);
      if (!value) break;
      result.set(number, value[0]);
      offset = value[1];
    } else if (wire === 2) {
      const length = readVarint(bytes, offset);
      if (!length || length[0] > bytes.length - length[1]) break;
      result.set(number, bytes.subarray(length[1], length[1] + length[0]));
      offset = length[1] + length[0];
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
    } else {
      break;
    }
  }
  return result;
}

const nested = (value: number | Buffer | undefined): FieldMap =>
  Buffer.isBuffer(value) ? fields(value) : new Map();
const count = (value: number | Buffer | undefined): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const MODEL =
  /(?:claude-opus-\d+-\d+(?:-thinking)?|claude[-_]v\d+[-_]\d+[-_][a-z0-9_-]+|gemini-\d+(?:\.\d+)?-[a-z0-9-]+|gpt-\d+(?:\.\d+)?-[a-z0-9-]+)/i;
const BOT_ID = /bot-[0-9a-f]{8}-[0-9a-f-]{27,}/gi;

function selectedModels(db: NodeSqlite.DatabaseSync): {
  byBot: Map<string, string>;
  fallback: string;
} {
  const byBot = new Map<string, string>();
  let fallback = "unknown-antigravity-model";
  try {
    const rows = db.prepare("SELECT data FROM gen_metadata ORDER BY idx").all() as Array<{
      data: Uint8Array;
    }>;
    for (const row of rows) {
      if (!(row.data instanceof Uint8Array)) continue;
      const text = Buffer.from(row.data).toString("latin1");
      const model = text.match(MODEL)?.[0];
      if (!model) continue;
      if (fallback === "unknown-antigravity-model") fallback = model;
      for (const bot of text.match(BOT_ID) ?? []) byBot.set(bot, model);
    }
  } catch {
    // Older conversations do not have generation metadata.
  }
  return { byBot, fallback };
}

/** Exact per-generation usage from Antigravity's conversation database. */
export function readAntigravityConversation(dbPath: string): UsageRecord[] | null {
  const read = (databasePath: string): UsageRecord[] | null => {
    let db: NodeSqlite.DatabaseSync;
    try {
      db = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
    } catch {
      return null;
    }
    try {
      const sessionId = NodePath.basename(dbPath, ".db");
      const models = selectedModels(db);
      const rows = db
        .prepare("SELECT idx, step_type, metadata FROM steps ORDER BY idx")
        .all() as Array<{ idx: number; step_type: number; metadata: Uint8Array | null }>;
      const records: UsageRecord[] = [];
      for (const row of rows) {
        if (row.step_type !== 15 || !(row.metadata instanceof Uint8Array)) continue;
        const step = fields(Buffer.from(row.metadata));
        const metrics = nested(step.get(9));
        const input = count(metrics.get(2));
        const cached = count(metrics.get(5));
        const output = count(metrics.get(3));
        if (input + cached + output === 0) continue;
        const started = nested(step.get(6));
        const seconds = count(started.get(1));
        if (seconds === 0) continue;
        const timestampMs = seconds * 1000 + Math.floor(count(started.get(2)) / 1_000_000);
        const bot = metrics.get(7);
        const stepModel = nested(step.get(24)).get(8);
        const model =
          (Buffer.isBuffer(bot) ? models.byBot.get(bot.toString("utf8")) : undefined) ??
          (Buffer.isBuffer(stepModel) ? stepModel.toString("utf8") : undefined) ??
          models.fallback;
        records.push({
          provider: "antigravity",
          timestampMs,
          model,
          sessionId,
          totals: {
            uncachedInputTokens: input,
            cachedInputTokens: cached,
            cacheCreationTokens: 0,
            outputTokens: output,
            reasoningTokens: count(metrics.get(9)),
          },
          reportedCostUsd: null,
          dedupeKey: `antigravity-db:${sessionId}:${row.idx}`,
        });
      }
      return records;
    } catch {
      return null;
    } finally {
      db.close();
    }
  };

  const normal = read(dbPath);
  if (normal !== null) return normal;
  try {
    // SQLite cannot create shared memory for an archived WAL database in a
    // read-only directory. An immutable open reads its checkpointed main file.
    // Never use it while a nonempty WAL may contain newer generations.
    if (NodeFS.statSync(`${dbPath}-wal`).size > 0) return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }
  return read(`${NodeURL.pathToFileURL(dbPath).href}?immutable=1`);
}

export async function listAntigravityConversationDirs(
  stateDir: string,
  home: string,
): Promise<string[]> {
  const dirs = [NodePath.join(home, ".gemini", "antigravity", "conversations")];
  const profiles = [NodePath.join(stateDir, "providers", "antigravity")];
  if (NodePath.resolve(stateDir) === NodePath.join(home, ".t3-personal", "userdata")) {
    // The Personal desktop app moved from ~/.t3; old conversations still count
    // within the 90-day window even though new sessions use a separate home.
    profiles.push(NodePath.join(home, ".t3", "userdata", "providers", "antigravity"));
  }
  for (const root of profiles) {
    try {
      for (const entry of await NodeFSP.readdir(root, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          dirs.push(NodePath.join(root, entry.name, "antigravity-acp", "conversations"));
        }
      }
    } catch {
      // No managed Antigravity profile exists at this home.
    }
  }
  return dirs;
}

export async function listAntigravityConversationFiles(dir: string, sinceMs: number) {
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
  try {
    for (const entry of await NodeFSP.readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".db")) continue;
      const path = NodePath.join(dir, entry.name);
      try {
        const stat = await NodeFSP.stat(path);
        if (stat.mtimeMs >= sinceMs) files.push({ path, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // A conversation may be removed during the scan.
      }
    }
  } catch {
    // A missing source is reported by the caller.
  }
  return files;
}
