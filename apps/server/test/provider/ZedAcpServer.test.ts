import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const ZED_ACP_SERVER_BIN = "/Users/tvh0021/git_repos/zed-dev/target/debug/zed-acp-server";

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

class ZedAcpTestClient {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number | string, (res: JsonRpcMessage) => void>();
  private notifications: JsonRpcMessage[] = [];
  private serverRequests: JsonRpcMessage[] = [];

  async start(worktree?: string, dataDir?: string) {
    const args: string[] = [];
    if (worktree) {
      args.push("--worktree", worktree);
    }
    if (dataDir) {
      args.push("--data-dir", dataDir);
    }

    this.proc = spawn(ZED_ACP_SERVER_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stderr?.on("data", (data) => {
      const text = data.toString();
      if (process.env.DEBUG_TEST) {
        console.error("[zed-acp-server stderr]", text);
      }
    });

    this.rl = readline.createInterface({
      input: this.proc.stdout!,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage;
        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
          const resolver = this.pendingRequests.get(msg.id);
          if (resolver) {
            this.pendingRequests.delete(msg.id);
            resolver(msg);
          }
        } else if (msg.id !== undefined && msg.method) {
          // Inbound request from server (e.g. session/request_permission or elicitation/create)
          this.serverRequests.push(msg);
        } else if (msg.method) {
          // Notification (e.g. session/update)
          this.notifications.push(msg);
        }
      } catch (err) {
        console.error("Failed to parse JSON-RPC message:", line, err);
      }
    });
  }

  async request(method: string, params?: Record<string, unknown>): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise((resolve) => {
      this.pendingRequests.set(id, resolve);
      this.proc?.stdin?.write(JSON.stringify(payload) + "\n");
    });
  }

  sendResponse(id: number | string, result: Record<string, unknown>) {
    const payload = {
      jsonrpc: "2.0",
      id,
      result,
    };
    this.proc?.stdin?.write(JSON.stringify(payload) + "\n");
  }

  getNotifications(): JsonRpcMessage[] {
    return [...this.notifications];
  }

  getServerRequests(): JsonRpcMessage[] {
    return [...this.serverRequests];
  }

  async stop(): Promise<number | null> {
    if (!this.proc) {
      return null;
    }
    if (this.proc.exitCode !== null) {
      return this.proc.exitCode;
    }

    return new Promise((resolve) => {
      this.proc!.once("exit", (code) => {
        resolve(code);
      });
      this.proc!.stdin?.end();
    });
  }
}

describe("ZedAcpServer Harness (Milestone 2)", () => {
  let client: ZedAcpTestClient;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zed-acp-test-"));
    await fs.writeFile(path.join(tempDir, "test.txt"), "Hello Zed Agent!");
    client = new ZedAcpTestClient();
  });

  afterEach(async () => {
    await client.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("performs capability negotiation via initialize", async () => {
    await client.start();
    const response = await client.request("initialize", { protocolVersion: 1 });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    expect(response.result?.protocolVersion).toBe(1);
    expect(response.result?.serverInfo).toEqual({
      name: "zed-acp-server",
      version: "0.1.0",
    });
    expect(response.result?.capabilities).toEqual({
      elicitation: { form: true },
      tools: true,
    });
  });

  it("creates a worktree session via session/new", async () => {
    await client.start(tempDir);
    await client.request("initialize", { protocolVersion: 1 });

    const sessionRes = await client.request("session/new", { cwd: tempDir });
    expect(sessionRes.error).toBeUndefined();
    expect(sessionRes.result).toBeDefined();
    expect(typeof sessionRes.result?.sessionId).toBe("string");
    expect((sessionRes.result?.sessionId as string).length).toBeGreaterThan(0);
  });

  it("streams notifications and completes a prompt turn", async () => {
    await client.start(tempDir);
    await client.request("initialize", { protocolVersion: 1 });

    const sessionRes = await client.request("session/new", { cwd: tempDir });
    const sessionId = sessionRes.result?.sessionId as string;

    const promptRes = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "test prompt" }],
    });

    expect(promptRes.error).toBeUndefined();
    expect(promptRes.result).toBeDefined();
    expect(promptRes.result?.stopReason).toBeDefined();

    // Verify session/update notifications were streamed
    const notifs = client.getNotifications();
    expect(notifs.length).toBeGreaterThan(0);
    const updateNotif = notifs.find((n) => n.method === "session/update");
    expect(updateNotif).toBeDefined();
    expect(updateNotif?.params?.sessionId).toBe(sessionId);
  });

  it("supports session cancellation via session/cancel", async () => {
    await client.start(tempDir);
    await client.request("initialize", { protocolVersion: 1 });

    const sessionRes = await client.request("session/new", { cwd: tempDir });
    const sessionId = sessionRes.result?.sessionId as string;

    const cancelRes = await client.request("session/cancel", { sessionId });
    expect(cancelRes.error).toBeUndefined();
    expect(cancelRes.result).toEqual({});
  });

  it("supports explicit skill invocation via zed/invoke_skill", async () => {
    await client.start(tempDir);
    await client.request("initialize", { protocolVersion: 1 });

    const sessionRes = await client.request("session/new", { cwd: tempDir });
    const sessionId = sessionRes.result?.sessionId as string;

    const skillRes = await client.request("zed/invoke_skill", {
      sessionId,
      skillName: "compact",
      prompt: "",
    });

    expect(skillRes.error).toBeUndefined();
    expect(skillRes.result).toBeDefined();
    expect(skillRes.result?.stopReason).toBeDefined();
  });

  it("shuts down cleanly when stdin is closed", async () => {
    await client.start(tempDir);
    await client.request("initialize", { protocolVersion: 1 });

    const exitCode = await client.stop();
    expect(exitCode).toBe(0);
  });
});
