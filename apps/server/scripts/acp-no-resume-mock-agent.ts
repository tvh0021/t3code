// @effect-diagnostics nodeBuiltinImport:off
import * as NodeReadline from "node:readline";

// Zed's v1 bridge can create sessions but advertises no load or resume support.
const responses = {
  initialize: { protocolVersion: 1 },
  "session/new": { sessionId: "replacement-session" },
  "session/prompt": { stopReason: "end_turn" },
} as const;

const lines = NodeReadline.createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line) as { id?: number; method: string };
  if (request.id === undefined) continue;
  const result = responses[request.method as keyof typeof responses];
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      ...(result === undefined
        ? { error: { code: -32601, message: "Method not found" } }
        : { result }),
    })}\n`,
  );
}
