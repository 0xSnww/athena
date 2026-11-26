// @effect-diagnostics nodeBuiltinImport:off -- Uses temporary local directories and SHA-512 fixtures to test the macOS bundle swapper.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import {
  buildMacAdHocSwapArgs,
  isAdHocOrUnsignedCodesignResult,
  MAC_ADHOC_SWAP_SCRIPT,
  resolveMacAppBundlePath,
  tryInstallAdHocMacUpdate,
  type MacAdHocCommandResult,
} from "./MacAdHocUpdateInstaller.ts";

function makeTempDir(prefix: string): string {
  return NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
}

function sha512Base64(content: string): string {
  return NodeCrypto.createHash("sha512").update(content).digest("base64");
}

describe("MacAdHocUpdateInstaller", () => {
  it("resolves enclosing .app bundle paths from macOS executable paths", () => {
    assert.equal(
      resolveMacAppBundlePath("/Applications/Athena.app/Contents/MacOS/Athena"),
      "/Applications/Athena.app",
    );
    assert.equal(
      resolveMacAppBundlePath("/Users/seb/Applications/Athena Beta.app/Contents/MacOS/Athena"),
      "/Users/seb/Applications/Athena Beta.app",
    );
    assert.equal(resolveMacAppBundlePath("/usr/local/bin/electron"), null);
    assert.equal(resolveMacAppBundlePath(""), null);
  });

  it("distinguishes ad-hoc or unsigned bundles from Developer ID signed bundles", () => {
    assert.isTrue(
      isAdHocOrUnsignedCodesignResult({
        status: 0,
        stdout: "",
        stderr: [
          "Executable=/Applications/Athena.app/Contents/MacOS/Athena",
          "Identifier=com.t3tools.t3code",
          "CodeDirectory v=20400 size=412 flags=0x2(adhoc) hashes=7+2 location=embedded",
          "Signature=adhoc",
        ].join("\n"),
      }),
    );

    assert.isTrue(
      isAdHocOrUnsignedCodesignResult({
        status: 1,
        stdout: "",
        stderr: "/Applications/Athena.app: code object is not signed at all",
      }),
    );

    assert.isFalse(
      isAdHocOrUnsignedCodesignResult({
        status: 0,
        stdout: "",
        stderr: [
          "Executable=/Applications/Athena.app/Contents/MacOS/Athena",
          "Identifier=com.t3tools.t3code",
          "Authority=Developer ID Application: Example Corp (TEAMID1234)",
          "Authority=Developer ID Certification Authority",
          "Authority=Apple Root CA",
        ].join("\n"),
      }),
    );
  });

  it("builds positional arguments without interpolating paths into shell code", () => {
    const args = buildMacAdHocSwapArgs({
      pid: 4242,
      targetAppPath: "/Applications/Athena (Dev).app",
      stagedAppPath: "/Applications/.athena-update-abc/Athena.app",
      stageDir: "/Applications/.athena-update-abc",
      isForceRunAfter: true,
    });

    assert.deepEqual(args, [
      "-c",
      MAC_ADHOC_SWAP_SCRIPT,
      "athena-mac-updater",
      "4242",
      "/Applications/Athena (Dev).app",
      "/Applications/.athena-update-abc/Athena.app",
      "/Applications/.athena-update-abc",
      "1",
    ]);
  });

  it("defers to Squirrel.Mac when the running bundle has a Developer ID authority", async () => {
    const events: string[] = [];
    const handled = await tryInstallAdHocMacUpdate({
      zipPath: "/tmp/unused.zip",
      isForceRunAfter: true,
      deps: {
        execPath: "/Applications/Athena.app/Contents/MacOS/Athena",
        pid: 1234,
        runCommand: async (command) => {
          events.push(command);
          return {
            status: 0,
            stdout: "",
            stderr: "Authority=Developer ID Application: Example Corp (TEAMID1234)\n",
          };
        },
        spawnDetached: () => {
          events.push("spawn");
        },
        closeUpdaterServer: () => {
          events.push("closeServer");
        },
        emitBeforeQuitForUpdate: () => {
          events.push("beforeQuitForUpdate");
        },
        quitApp: () => {
          events.push("quit");
        },
      },
    });

    assert.isFalse(handled);
    assert.deepEqual(events, ["/usr/bin/codesign"]);
  });

  it("extracts, clears quarantine, spawns detached swapper, and quits for ad-hoc builds", async () => {
    const root = makeTempDir("athena-mac-adhoc-test-");
    try {
      const appsDir = NodePath.join(root, "Applications");
      const targetApp = NodePath.join(appsDir, "Athena.app");
      const execPath = NodePath.join(targetApp, "Contents", "MacOS", "Athena");
      NodeFS.mkdirSync(NodePath.dirname(execPath), { recursive: true });
      NodeFS.writeFileSync(execPath, "old-binary");

      const zipContent = "fake-zip-bytes-for-v1.0.4";
      const zipPath = NodePath.join(root, "Athena-1.0.4-arm64.zip");
      NodeFS.writeFileSync(zipPath, zipContent);

      const commands: Array<{ command: string; args: ReadonlyArray<string> }> = [];
      const spawned: Array<{ command: string; args: ReadonlyArray<string> }> = [];
      const lifecycle: string[] = [];

      const handled = await tryInstallAdHocMacUpdate({
        zipPath,
        expectedSha512: sha512Base64(zipContent),
        isForceRunAfter: true,
        deps: {
          execPath,
          pid: 9876,
          runCommand: async (command, args): Promise<MacAdHocCommandResult> => {
            commands.push({ command, args });
            if (command === "/usr/bin/codesign") {
              return { status: 0, stdout: "", stderr: "Signature=adhoc\n" };
            }
            if (command === "/usr/bin/ditto") {
              const stageDir = args[2]!;
              const extractedApp = NodePath.join(stageDir, "Athena.app");
              NodeFS.mkdirSync(NodePath.join(extractedApp, "Contents", "MacOS"), {
                recursive: true,
              });
              NodeFS.writeFileSync(
                NodePath.join(extractedApp, "Contents", "Info.plist"),
                "<plist/>",
              );
              return { status: 0, stdout: "", stderr: "" };
            }
            return { status: 0, stdout: "", stderr: "" };
          },
          spawnDetached: (command, args) => {
            spawned.push({ command, args });
            lifecycle.push("spawnDetached");
          },
          closeUpdaterServer: () => {
            lifecycle.push("closeUpdaterServer");
          },
          emitBeforeQuitForUpdate: () => {
            lifecycle.push("emitBeforeQuitForUpdate");
          },
          quitApp: () => {
            lifecycle.push("quitApp");
          },
        },
      });

      assert.isTrue(handled);
      assert.deepEqual(
        commands.map((entry) => entry.command),
        ["/usr/bin/codesign", "/usr/bin/ditto", "/usr/bin/xattr"],
      );
      assert.equal(spawned.length, 1);
      assert.equal(spawned[0]!.command, "/bin/sh");
      assert.equal(spawned[0]!.args[3], "9876");
      assert.equal(spawned[0]!.args[4], targetApp.replace(/\\/g, "/"));
      assert.equal(spawned[0]!.args[7], "1");
      assert.deepEqual(lifecycle, [
        "spawnDetached",
        "closeUpdaterServer",
        "emitBeforeQuitForUpdate",
        "quitApp",
      ]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to quit and cleans up when SHA-512 verification fails", async () => {
    const root = makeTempDir("athena-mac-adhoc-sha-");
    try {
      const targetApp = NodePath.join(root, "Athena.app");
      const execPath = NodePath.join(targetApp, "Contents", "MacOS", "Athena");
      NodeFS.mkdirSync(NodePath.dirname(execPath), { recursive: true });
      const zipPath = NodePath.join(root, "Athena-1.0.4-arm64.zip");
      NodeFS.writeFileSync(zipPath, "corrupted-zip");

      let quitCalled = false;
      let threw = false;
      try {
        await tryInstallAdHocMacUpdate({
          zipPath,
          expectedSha512: sha512Base64("different-content"),
          isForceRunAfter: true,
          deps: {
            execPath,
            pid: 5555,
            runCommand: async () => ({ status: 0, stdout: "", stderr: "Signature=adhoc\n" }),
            spawnDetached: () => {
              throw new Error("should not spawn");
            },
            closeUpdaterServer: () => {},
            emitBeforeQuitForUpdate: () => {},
            quitApp: () => {
              quitCalled = true;
            },
          },
        });
      } catch (error) {
        threw = true;
        assert.include((error as Error).message, "SHA-512");
      }

      assert.isTrue(threw);
      assert.isFalse(quitCalled);
      assert.deepEqual(
        NodeFS.readdirSync(root).filter((entry) => entry.startsWith(".athena-update-")),
        [],
      );
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans up the staging directory and does not quit when ditto fails", async () => {
    const root = makeTempDir("athena-mac-adhoc-ditto-");
    try {
      const targetApp = NodePath.join(root, "Athena.app");
      const execPath = NodePath.join(targetApp, "Contents", "MacOS", "Athena");
      NodeFS.mkdirSync(NodePath.dirname(execPath), { recursive: true });
      const zipPath = NodePath.join(root, "Athena-1.0.4-arm64.zip");
      NodeFS.writeFileSync(zipPath, "zip-bytes");

      let quitCalled = false;
      let threw = false;
      try {
        await tryInstallAdHocMacUpdate({
          zipPath,
          isForceRunAfter: true,
          deps: {
            execPath,
            pid: 5555,
            runCommand: async (command) => {
              if (command === "/usr/bin/codesign") {
                return { status: 0, stdout: "", stderr: "Signature=adhoc\n" };
              }
              return { status: 1, stdout: "", stderr: "ditto: bad archive" };
            },
            spawnDetached: () => {
              throw new Error("should not spawn");
            },
            closeUpdaterServer: () => {},
            emitBeforeQuitForUpdate: () => {},
            quitApp: () => {
              quitCalled = true;
            },
          },
        });
      } catch (error) {
        threw = true;
        assert.include((error as Error).message, "Failed to extract macOS update archive");
      }

      assert.isTrue(threw);
      assert.isFalse(quitCalled);
      assert.deepEqual(
        NodeFS.readdirSync(root).filter((entry) => entry.startsWith(".athena-update-")),
        [],
      );
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to self-update an App Translocation bundle", async () => {
    let threw = false;
    try {
      await tryInstallAdHocMacUpdate({
        zipPath: "/tmp/Athena.zip",
        isForceRunAfter: true,
        deps: {
          execPath:
            "/private/var/folders/xx/yy/T/AppTranslocation/ABC/d/Athena.app/Contents/MacOS/Athena",
          pid: 5555,
          runCommand: async () => ({ status: 0, stdout: "", stderr: "Signature=adhoc\n" }),
          spawnDetached: () => {},
          closeUpdaterServer: () => {},
          emitBeforeQuitForUpdate: () => {},
          quitApp: () => {},
        },
      });
    } catch (error) {
      threw = true;
      assert.include((error as Error).message, "translocated");
    }
    assert.isTrue(threw);
  });
});
