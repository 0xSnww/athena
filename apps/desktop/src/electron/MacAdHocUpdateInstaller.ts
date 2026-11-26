// @effect-diagnostics nodeBuiltinImport:off -- Runs detached macOS bundle swap at the Electron updater boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface MacAdHocCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error | undefined;
}

export interface MacAdHocInstallerDeps {
  readonly execPath: string;
  readonly pid: number;
  readonly runCommand: (
    command: string,
    args: ReadonlyArray<string>,
    timeoutMs: number,
  ) => Promise<MacAdHocCommandResult>;
  readonly spawnDetached: (command: string, args: ReadonlyArray<string>) => void;
  readonly closeUpdaterServer: () => void;
  readonly emitBeforeQuitForUpdate: () => void;
  readonly quitApp: () => void;
}

const CODESIGN_TIMEOUT_MS = 15_000;
const EXTRACT_TIMEOUT_MS = 180_000;
const XATTR_TIMEOUT_MS = 30_000;

// Runs detached after the current Electron process exits: waits for the old PID,
// swaps the verified .app bundle atomically with rollback on failure, clears quarantine,
// and relaunches via LaunchServices so the new app inherits no descriptors.
export const MAC_ADHOC_SWAP_SCRIPT = [
  'pid="$1"',
  'target_app="$2"',
  'staged_app="$3"',
  'stage_dir="$4"',
  'relaunch="$5"',
  'backup_app="${target_app}.athena-backup.$$"',
  "i=0",
  'while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 300 ]; do',
  "  sleep 0.1",
  "  i=$((i + 1))",
  "done",
  'if kill -0 "$pid" 2>/dev/null; then',
  '  rm -rf "$stage_dir"',
  "  exit 1",
  "fi",
  'if ! mv "$target_app" "$backup_app"; then',
  '  rm -rf "$stage_dir"',
  "  exit 1",
  "fi",
  'if mv "$staged_app" "$target_app"; then',
  '  /usr/bin/xattr -cr "$target_app" 2>/dev/null || true',
  '  rm -rf "$backup_app" "$stage_dir"',
  "else",
  '  rm -rf "$target_app" 2>/dev/null || true',
  '  mv "$backup_app" "$target_app" 2>/dev/null || true',
  '  rm -rf "$stage_dir"',
  "  exit 1",
  "fi",
  'if [ "$relaunch" = "1" ]; then',
  "  sleep 0.2",
  '  /usr/bin/open "$target_app" || /usr/bin/open -n "$target_app"',
  "fi",
].join("\n");

/**
 * Resolves the enclosing `.app` bundle directory from a macOS Electron executable path
 * (e.g. `/Applications/Athena.app/Contents/MacOS/Athena` -> `/Applications/Athena.app`).
 */
export function resolveMacAppBundlePath(execPath: string): string | null {
  const normalized = execPath.replace(/\\/g, "/");
  const macosDir = NodePath.posix.dirname(normalized);
  if (NodePath.posix.basename(macosDir) !== "MacOS") return null;
  const contentsDir = NodePath.posix.dirname(macosDir);
  if (NodePath.posix.basename(contentsDir) !== "Contents") return null;
  const appBundlePath = NodePath.posix.dirname(contentsDir);
  if (!appBundlePath.endsWith(".app") || appBundlePath === ".app") return null;
  return appBundlePath;
}

/**
 * Squirrel.Mac requires a real signing authority (Developer ID) to install updates.
 * Ad-hoc (`Signature=adhoc`) or unsigned bundles have no certificate authority and fail validation.
 */
export function isAdHocOrUnsignedCodesignResult(result: MacAdHocCommandResult): boolean {
  if (result.error !== undefined || result.status !== 0) return true;
  const combined = `${result.stdout}\n${result.stderr}`;
  if (/^Signature=adhoc$/m.test(combined)) return true;
  return !/^Authority=/m.test(combined);
}

export function buildMacAdHocSwapArgs(input: {
  readonly pid: number;
  readonly targetAppPath: string;
  readonly stagedAppPath: string;
  readonly stageDir: string;
  readonly isForceRunAfter: boolean;
}): ReadonlyArray<string> {
  return [
    "-c",
    MAC_ADHOC_SWAP_SCRIPT,
    "athena-mac-updater",
    String(input.pid),
    input.targetAppPath,
    input.stagedAppPath,
    input.stageDir,
    input.isForceRunAfter ? "1" : "0",
  ];
}

function runCommandAsync(
  command: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
): Promise<MacAdHocCommandResult> {
  return new Promise((resolve) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ status: 0, stdout, stderr });
          return;
        }
        const status =
          typeof (error as NodeJS.ErrnoException & { status?: unknown }).code === "number"
            ? ((error as unknown as { code: number }).code ?? 1)
            : typeof (error as unknown as { status?: unknown }).status === "number"
              ? ((error as unknown as { status: number }).status ?? 1)
              : null;
        resolve({
          status,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          error,
        });
      },
    );
  });
}

function computeFileSha512Base64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = NodeCrypto.createHash("sha512");
    const stream = NodeFS.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("error", reject);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", () => {
      resolve(hash.digest("base64"));
    });
  });
}

function findSingleExtractedAppBundle(stageDir: string): string {
  const appEntries = NodeFS.readdirSync(stageDir).filter((entry) => entry.endsWith(".app"));
  if (appEntries.length !== 1 || !appEntries[0]) {
    throw new Error(
      `Expected exactly one .app bundle in update archive, found ${appEntries.length}.`,
    );
  }
  const stagedAppPath = NodePath.join(stageDir, appEntries[0]);
  const infoPlistPath = NodePath.join(stagedAppPath, "Contents", "Info.plist");
  const macosDirPath = NodePath.join(stagedAppPath, "Contents", "MacOS");
  if (!NodeFS.existsSync(infoPlistPath) || !NodeFS.existsSync(macosDirPath)) {
    throw new Error(`Extracted macOS app bundle is incomplete at ${stagedAppPath}.`);
  }
  return stagedAppPath;
}

export interface InstallAdHocMacUpdateInput {
  readonly zipPath: string | null | undefined;
  readonly expectedSha512?: string | null | undefined;
  readonly isForceRunAfter: boolean;
  readonly deps: MacAdHocInstallerDeps;
}

/**
 * Installs a downloaded macOS `.zip` update in place when the running `.app` is ad-hoc signed
 * or unsigned (where Squirrel.Mac rejects the update). Returns `false` for Developer ID signed
 * builds or non-bundle runs so the caller falls back to native `autoUpdater.quitAndInstall`.
 */
export async function tryInstallAdHocMacUpdate(
  input: InstallAdHocMacUpdateInput,
): Promise<boolean> {
  const appBundlePath = resolveMacAppBundlePath(input.deps.execPath);
  if (appBundlePath === null) {
    return false;
  }

  const codesignResult = await input.deps.runCommand(
    "/usr/bin/codesign",
    ["-dvv", appBundlePath],
    CODESIGN_TIMEOUT_MS,
  );
  if (!isAdHocOrUnsignedCodesignResult(codesignResult)) {
    return false;
  }

  if (appBundlePath.includes("/AppTranslocation/")) {
    throw new Error(
      "Cannot auto-update a translocated macOS app bundle. Move Athena.app to /Applications and relaunch.",
    );
  }

  const zipPath = input.zipPath?.trim();
  if (!zipPath || !zipPath.endsWith(".zip") || !NodeFS.existsSync(zipPath)) {
    throw new Error("Downloaded macOS update archive is missing.");
  }

  if (input.expectedSha512) {
    const actualSha512 = await computeFileSha512Base64(zipPath);
    if (actualSha512 !== input.expectedSha512) {
      throw new Error("Downloaded macOS update archive failed SHA-512 verification.");
    }
  }

  // Stage inside the app bundle's parent directory so the final mv is same-filesystem and atomic,
  // and write permission failures surface before we quit the running app.
  const parentDir = NodePath.dirname(appBundlePath);
  const stageDir = NodeFS.mkdtempSync(NodePath.join(parentDir, ".athena-update-"));

  try {
    const extractResult = await input.deps.runCommand(
      "/usr/bin/ditto",
      ["-xk", zipPath, stageDir],
      EXTRACT_TIMEOUT_MS,
    );
    if (extractResult.status !== 0) {
      throw new Error(
        `Failed to extract macOS update archive (exit ${String(extractResult.status)}): ${extractResult.stderr.trim() || extractResult.error?.message || "unknown error"}`,
      );
    }

    const stagedAppPath = findSingleExtractedAppBundle(stageDir);

    await input.deps.runCommand("/usr/bin/xattr", ["-cr", stagedAppPath], XATTR_TIMEOUT_MS);

    const swapArgs = buildMacAdHocSwapArgs({
      pid: input.deps.pid,
      targetAppPath: appBundlePath,
      stagedAppPath,
      stageDir,
      isForceRunAfter: input.isForceRunAfter,
    });
    input.deps.spawnDetached("/bin/sh", swapArgs);
  } catch (error) {
    NodeFS.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }

  input.deps.closeUpdaterServer();
  input.deps.emitBeforeQuitForUpdate();
  input.deps.quitApp();
  return true;
}

export function createDefaultMacAdHocInstallerDeps(input: {
  readonly execPath: string;
  readonly pid: number;
  readonly closeUpdaterServer: () => void;
  readonly emitBeforeQuitForUpdate: () => void;
  readonly quitApp: () => void;
}): MacAdHocInstallerDeps {
  return {
    execPath: input.execPath,
    pid: input.pid,
    runCommand: runCommandAsync,
    spawnDetached: (command, args) => {
      const child = NodeChildProcess.spawn(command, [...args], {
        detached: true,
        stdio: "ignore",
      });
      if (child.pid === undefined) {
        throw new Error(`Failed to spawn detached macOS update helper (${command}).`);
      }
      child.unref();
    },
    closeUpdaterServer: input.closeUpdaterServer,
    emitBeforeQuitForUpdate: input.emitBeforeQuitForUpdate,
    quitApp: input.quitApp,
  };
}
