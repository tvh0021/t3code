// @effect-diagnostics nodeBuiltinImport:off - Build-time macOS signing uses native tools and an isolated temporary keychain.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export function personalSigningDirectory() {
  return (
    process.env.T3CODE_PERSONAL_SIGNING_DIR ||
    NodePath.join(NodeOS.homedir(), "Library", "Application Support", "T3 Code Personal Signing")
  );
}

function run(executable: string, args: string[], env?: NodeJS.ProcessEnv) {
  try {
    return NodeChildProcess.execFileSync(executable, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: env ?? process.env,
    });
  } catch {
    // Native command errors include argv, which can contain the temporary
    // keychain password. Do not attach them as causes or log them.
    throw new Error(
      `Personal macOS signing failed while running ${NodePath.basename(executable)} ${args[0]}.`,
    );
  }
}

async function ensureCertificate(directory: string) {
  try {
    await NodeFSP.access(directory);
  } catch {
    const parent = NodePath.dirname(directory);
    await NodeFSP.mkdir(parent, { recursive: true });
    const staging = await NodeFSP.mkdtemp(NodePath.join(parent, ".t3-signing-"));
    try {
      run("/usr/bin/openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "3650",
        "-subj",
        "/CN=T3 Code Personal Local Signing/",
        "-addext",
        "extendedKeyUsage=codeSigning",
        "-addext",
        "keyUsage=critical,digitalSignature",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-keyout",
        NodePath.join(staging, "private-key.pem"),
        "-out",
        NodePath.join(staging, "certificate.pem"),
      ]);
      await NodeFSP.chmod(NodePath.join(staging, "private-key.pem"), 0o600);
      await NodeFSP.chmod(NodePath.join(staging, "certificate.pem"), 0o600);
      try {
        await NodeFSP.rename(staging, directory);
      } catch (error) {
        // Another build may have created the same identity while openssl ran.
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          (error.code !== "EEXIST" && error.code !== "ENOTEMPTY")
        )
          throw error;
      }
    } finally {
      await NodeFSP.rm(staging, { recursive: true, force: true });
    }
  }
  // Never silently rotate an incomplete or expired identity. That would
  // invalidate the permissions this certificate is meant to preserve.
  const certificate = new NodeCrypto.X509Certificate(
    await NodeFSP.readFile(NodePath.join(directory, "certificate.pem")),
  );
  await NodeFSP.access(NodePath.join(directory, "private-key.pem"));
  run("/usr/bin/openssl", [
    "x509",
    "-checkend",
    "0",
    "-noout",
    "-in",
    NodePath.join(directory, "certificate.pem"),
  ]);
  return certificate.fingerprint.replaceAll(":", "");
}

/** Reuse a per-machine certificate without accessing the user's login keychain. */
export async function withPersonalSigningIdentity<A>(
  directory: string,
  use: (identity: { identity: string; keychain: string }) => Promise<A>,
): Promise<A> {
  const identity = await ensureCertificate(directory);
  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-personal-signing-"));
  const keychain = NodePath.join(temporary, "signing.keychain-db");
  const password = NodeCrypto.randomBytes(32).toString("hex");
  let created = false;
  try {
    run(
      "/usr/bin/openssl",
      [
        "pkcs12",
        "-export",
        "-inkey",
        NodePath.join(directory, "private-key.pem"),
        "-in",
        NodePath.join(directory, "certificate.pem"),
        "-out",
        NodePath.join(temporary, "identity.p12"),
        "-passout",
        "env:T3CODE_TEMP_SIGNING_PASSWORD",
      ],
      { ...process.env, T3CODE_TEMP_SIGNING_PASSWORD: password },
    );
    run("/usr/bin/security", ["create-keychain", "-p", password, keychain]);
    created = true;
    run("/usr/bin/security", ["unlock-keychain", "-p", password, keychain]);
    run("/usr/bin/security", [
      "import",
      NodePath.join(temporary, "identity.p12"),
      "-k",
      keychain,
      "-P",
      password,
      "-T",
      "/usr/bin/codesign",
    ]);
    run("/usr/bin/security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      password,
      keychain,
    ]);
    return await use({ identity, keychain });
  } finally {
    try {
      if (created) run("/usr/bin/security", ["delete-keychain", keychain]);
    } finally {
      await NodeFSP.rm(temporary, { recursive: true, force: true });
    }
  }
}
