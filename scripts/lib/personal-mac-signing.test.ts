// @effect-diagnostics nodeBuiltinImport:off - Verify macOS signing identity across real binaries with native codesign.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { expect, it } from "vite-plus/test";
import { withPersonalSigningIdentity } from "./personal-mac-signing.ts";

const run = (command: string, args: string[]) =>
  NodeChildProcess.execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

it.skipIf(HostProcessPlatform.defaultValue() !== "darwin")(
  "recognizes a rebuilt binary, rejects another signer, and cleans up the signing keychain",
  async () => {
    const temporary = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-signing-regression-"),
    );
    const searchList = run("/usr/bin/security", ["list-keychains", "-d", "user"]);
    const first = NodePath.join(temporary, "first");
    const second = NodePath.join(temporary, "second");
    const foreign = NodePath.join(temporary, "foreign");
    const directory = NodePath.join(temporary, "identity");
    let identity = "";
    let removedKeychain = "";
    try {
      await NodeFSP.copyFile("/usr/bin/true", first);
      await NodeFSP.copyFile("/usr/bin/false", second);
      await NodeFSP.copyFile("/usr/bin/true", foreign);
      await withPersonalSigningIdentity(directory, async (signer) => {
        identity = signer.identity;
        removedKeychain = signer.keychain;
        run("/usr/bin/codesign", [
          "--force",
          "--sign",
          signer.identity,
          "--keychain",
          signer.keychain,
          "--identifier",
          "com.t3tools.t3code.personal",
          first,
        ]);
      });
      await expect(NodeFSP.access(removedKeychain)).rejects.toThrow();
      const requirement = run("/usr/bin/codesign", ["-d", "-r-", first])
        .split("designated => ")[1]!
        .trim();
      expect(requirement).toContain("certificate leaf");
      expect(requirement).not.toContain("cdhash");
      await withPersonalSigningIdentity(directory, async (signer) => {
        expect(signer.identity).toBe(identity);
        run("/usr/bin/codesign", [
          "--force",
          "--sign",
          signer.identity,
          "--keychain",
          signer.keychain,
          "--identifier",
          "com.t3tools.t3code.personal",
          second,
        ]);
      });
      run("/usr/bin/codesign", ["--verify", "-R", `=${requirement}`, second]);
      run("/usr/bin/codesign", [
        "--force",
        "--sign",
        "-",
        "--identifier",
        "com.t3tools.t3code.personal",
        foreign,
      ]);
      expect(() =>
        run("/usr/bin/codesign", ["--verify", "-R", `=${requirement}`, foreign]),
      ).toThrow();
      expect((await NodeFSP.stat(NodePath.join(directory, "private-key.pem"))).mode & 0o777).toBe(
        0o600,
      );
      await expect(
        withPersonalSigningIdentity(directory, async (signer) => {
          removedKeychain = signer.keychain;
          throw new Error("build failed");
        }),
      ).rejects.toThrow("build failed");
      await expect(NodeFSP.access(removedKeychain)).rejects.toThrow();
      expect(run("/usr/bin/security", ["list-keychains", "-d", "user"])).toBe(searchList);
    } finally {
      await NodeFSP.rm(temporary, { recursive: true, force: true });
    }
  },
  30_000,
);
