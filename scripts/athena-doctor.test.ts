import { describe, expect, it } from "vite-plus/test";

import {
  compareSemver,
  evaluateEnvironment,
  parseGitRemotes,
  parseSemver,
  type DoctorSnapshot,
} from "./athena-doctor.ts";

describe("athena-doctor", () => {
  it("parses and compares semver strings with prefixes", () => {
    const older = parseSemver("v24.22.1");
    const newer = parseSemver("26.13.1");
    expect(older).toEqual({ major: 24, minor: 22, patch: 1 });
    expect(newer).toEqual({ major: 26, minor: 13, patch: 1 });
    expect(older && newer && compareSemver(older, newer)).toBeLessThan(0);
    expect(newer && older && compareSemver(newer, older)).toBeGreaterThan(0);
    expect(parseSemver("not-a-version")).toBeNull();
  });

  it("extracts fetch URLs from git remote -v output", () => {
    const remotes = parseGitRemotes(
      [
        "origin\thttps://github.com/0xSnww/athena.git (fetch) [tree:0]",
        "origin\thttps://github.com/0xSnww/athena.git (push)",
        "upstream\thttps://github.com/pingdotgg/t3code.git (fetch)",
        "upstream\thttps://github.com/pingdotgg/t3code.git (push)",
      ].join("\n"),
    );
    expect(remotes.get("origin")).toBe("https://github.com/0xSnww/athena.git");
    expect(remotes.get("upstream")).toBe("https://github.com/pingdotgg/t3code.git");
  });

  it("passes cleanly when all tools, files, and remotes are configured", () => {
    const snapshot: DoctorSnapshot = {
      expectedNode: "26.13.1",
      actualNode: "v26.13.1",
      expectedPnpm: "pnpm@12.14.0",
      actualPnpm: "12.14.0",
      vpVersion: "vp v1.7.0",
      cargoVersion: "cargo 1.85.0",
      remotes: new Map([
        ["origin", "https://github.com/0xSnww/athena.git"],
        ["upstream", "https://github.com/pingdotgg/t3code.git"],
      ]),
      hasNodeModules: true,
      hasEnvFile: true,
      hasPreCommitHook: true,
    };

    const results = evaluateEnvironment(snapshot);
    expect(results.every((r) => r.severity === "pass")).toBe(true);
  });

  it("flags missing vp or node_modules as failures and missing optional tools as warnings", () => {
    const snapshot: DoctorSnapshot = {
      expectedNode: "26.13.1",
      actualNode: "v24.22.1",
      expectedPnpm: "pnpm@12.14.0",
      actualPnpm: null,
      vpVersion: null,
      cargoVersion: null,
      remotes: new Map([["origin", "https://github.com/0xSnww/athena.git"]]),
      hasNodeModules: false,
      hasEnvFile: false,
      hasPreCommitHook: false,
    };

    const results = evaluateEnvironment(snapshot);
    const byName = new Map(results.map((r) => [r.name, r]));

    expect(byName.get("Vite+ (vp)")?.severity).toBe("fail");
    expect(byName.get("Dependencies")?.severity).toBe("fail");
    expect(byName.get("Node.js")?.severity).toBe("warn");
    expect(byName.get("Rust (cargo)")?.severity).toBe("warn");
    expect(byName.get("Local .env")?.severity).toBe("warn");
    expect(byName.get("Git upstream remote")?.severity).toBe("warn");
  });
});
