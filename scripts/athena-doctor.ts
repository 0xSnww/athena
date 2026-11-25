// @effect-diagnostics nodeBuiltinImport:off -- Runs before `vp i`, so only Node built-ins exist.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

export type CheckSeverity = "pass" | "warn" | "fail";

export interface CheckResult {
  readonly name: string;
  readonly severity: CheckSeverity;
  readonly detail: string;
  readonly fix?: string;
}

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parseSemver(raw: string | null | undefined): Semver | null {
  if (!raw) return null;
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function parseGitRemotes(output: string): ReadonlyMap<string, string> {
  const remotes = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line.trim());
    if (match?.[1] && match[2]) {
      remotes.set(match[1], match[2]);
    }
  }
  return remotes;
}

export interface DoctorSnapshot {
  readonly expectedNode: string | null;
  readonly actualNode: string;
  readonly expectedPnpm: string | null;
  readonly actualPnpm: string | null;
  readonly vpVersion: string | null;
  readonly cargoVersion: string | null;
  readonly remotes: ReadonlyMap<string, string>;
  readonly hasNodeModules: boolean;
  readonly hasEnvFile: boolean;
  readonly hasPreCommitHook: boolean;
}

export function evaluateEnvironment(snapshot: DoctorSnapshot): ReadonlyArray<CheckResult> {
  const results: CheckResult[] = [];

  const actualNode = parseSemver(snapshot.actualNode);
  const expectedNode = parseSemver(snapshot.expectedNode);
  if (!actualNode) {
    results.push({
      name: "Node.js",
      severity: "fail",
      detail: `Could not parse Node.js version (${snapshot.actualNode})`,
    });
  } else if (expectedNode && compareSemver(actualNode, expectedNode) < 0) {
    results.push({
      name: "Node.js",
      severity: "warn",
      detail: `v${actualNode.major}.${actualNode.minor}.${actualNode.patch} (package.json expects ${snapshot.expectedNode}; vp manages this automatically)`,
      fix: "Run commands through `vp run ...` so Vite+ uses the pinned Node version.",
    });
  } else {
    results.push({
      name: "Node.js",
      severity: "pass",
      detail: `v${actualNode.major}.${actualNode.minor}.${actualNode.patch}`,
    });
  }

  if (snapshot.vpVersion) {
    results.push({
      name: "Vite+ (vp)",
      severity: "pass",
      detail: snapshot.vpVersion,
    });
  } else {
    results.push({
      name: "Vite+ (vp)",
      severity: "fail",
      detail: "vp CLI not found on PATH",
      fix: "Install Vite+ from https://viteplus.dev so `vp i` and `vp run ...` work.",
    });
  }

  const actualPnpm = parseSemver(snapshot.actualPnpm);
  if (actualPnpm) {
    results.push({
      name: "pnpm",
      severity: "pass",
      detail: `v${actualPnpm.major}.${actualPnpm.minor}.${actualPnpm.patch}`,
    });
  } else {
    results.push({
      name: "pnpm",
      severity: "warn",
      detail: `pnpm not found directly on PATH${snapshot.expectedPnpm ? ` (packageManager: ${snapshot.expectedPnpm})` : ""}`,
      fix: "Run package installs through `vp i`, which manages pnpm automatically.",
    });
  }

  if (snapshot.cargoVersion) {
    results.push({
      name: "Rust (cargo)",
      severity: "pass",
      detail: snapshot.cargoVersion,
    });
  } else {
    results.push({
      name: "Rust (cargo)",
      severity: "warn",
      detail: "Not installed (only needed for building desktop native helpers)",
      fix: "Install from https://rustup.rs if you plan to build desktop installers locally.",
    });
  }

  if (snapshot.hasNodeModules) {
    results.push({
      name: "Dependencies",
      severity: "pass",
      detail: "node_modules installed",
    });
  } else {
    results.push({
      name: "Dependencies",
      severity: "fail",
      detail: "node_modules is missing",
      fix: "Run `vp i` to install dependencies.",
    });
  }

  if (snapshot.hasEnvFile) {
    results.push({
      name: "Local .env",
      severity: "pass",
      detail: ".env present",
    });
  } else {
    results.push({
      name: "Local .env",
      severity: "warn",
      detail:
        ".env not found (optional for local web dev; needed for desktop updater/cloud config)",
      fix: "Copy the template: `cp .env.example .env`",
    });
  }

  if (snapshot.hasPreCommitHook) {
    results.push({
      name: "Git pre-commit hook",
      severity: "pass",
      detail: ".vite-hooks/pre-commit present",
    });
  } else {
    results.push({
      name: "Git pre-commit hook",
      severity: "warn",
      detail: ".vite-hooks/pre-commit missing",
      fix: "Run `vp config --no-agent` to restore hooks.",
    });
  }

  const originUrl = snapshot.remotes.get("origin");
  const upstreamUrl = snapshot.remotes.get("upstream");
  if (!originUrl) {
    results.push({
      name: "Git origin remote",
      severity: "fail",
      detail: "No `origin` remote configured",
    });
  } else {
    results.push({
      name: "Git origin remote",
      severity: "pass",
      detail: originUrl,
    });
  }

  if (upstreamUrl && upstreamUrl.includes("pingdotgg/t3code")) {
    results.push({
      name: "Git upstream remote",
      severity: "pass",
      detail: upstreamUrl,
    });
  } else if (upstreamUrl) {
    results.push({
      name: "Git upstream remote",
      severity: "warn",
      detail: `Points to ${upstreamUrl} instead of pingdotgg/t3code`,
    });
  } else {
    results.push({
      name: "Git upstream remote",
      severity: "warn",
      detail: "No `upstream` remote configured (helpful for resolving sync conflicts locally)",
      fix: "git remote add upstream https://github.com/pingdotgg/t3code.git",
    });
  }

  return results;
}

function runCommand(command: string, args: ReadonlyArray<string>, cwd: string): string | null {
  const result = NodeChildProcess.spawnSync([command, ...args].join(" "), {
    cwd,
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout) return null;
  const firstLine = result.stdout.trim().split(/\r?\n/)[0];
  return firstLine ? firstLine.trim() : null;
}

function collectSnapshot(repoRoot: string): DoctorSnapshot {
  const pkgPath = NodePath.join(repoRoot, "package.json");
  const pkg = JSON.parse(NodeFS.readFileSync(pkgPath, "utf8")) as {
    engines?: { node?: string };
    packageManager?: string;
  };
  const remoteResult = NodeChildProcess.spawnSync("git", ["remote", "-v"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const remotes =
    remoteResult.status === 0 && remoteResult.stdout
      ? parseGitRemotes(remoteResult.stdout)
      : new Map<string, string>();

  return {
    expectedNode: pkg.engines?.node ?? null,
    actualNode: process.version,
    expectedPnpm: pkg.packageManager ?? null,
    actualPnpm: runCommand("pnpm", ["--version"], repoRoot),
    vpVersion: runCommand("vp", ["--version"], repoRoot),
    cargoVersion: runCommand("cargo", ["--version"], repoRoot),
    remotes,
    hasNodeModules: NodeFS.existsSync(NodePath.join(repoRoot, "node_modules")),
    hasEnvFile: NodeFS.existsSync(NodePath.join(repoRoot, ".env")),
    hasPreCommitHook: NodeFS.existsSync(NodePath.join(repoRoot, ".vite-hooks", "pre-commit")),
  };
}

function main(): void {
  const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
  const results = evaluateEnvironment(collectSnapshot(repoRoot));

  const icons: Record<CheckSeverity, string> = {
    pass: "[OK]  ",
    warn: "[WARN]",
    fail: "[FAIL]",
  };

  process.stdout.write("\nAthena Environment Doctor\n=========================\n");
  for (const result of results) {
    process.stdout.write(`${icons[result.severity]} ${result.name}: ${result.detail}\n`);
    if (result.fix) {
      process.stdout.write(`       -> ${result.fix}\n`);
    }
  }

  const failures = results.filter((r) => r.severity === "fail").length;
  const warnings = results.filter((r) => r.severity === "warn").length;
  process.stdout.write(
    `\nSummary: ${results.length - failures - warnings} passed, ${warnings} warning(s), ${failures} failure(s).\n`,
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  NodePath.resolve(process.argv[1]) === NodePath.resolve(NodeURL.fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main();
}
