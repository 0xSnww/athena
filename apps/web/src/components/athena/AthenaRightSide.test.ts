import { describe, expect, it } from "vite-plus/test";

import { resolvePortPresentation } from "./AthenaPortIcon";
import { splitAgentTeamLabel } from "./AthenaRightTeamCard";

describe("resolvePortPresentation", () => {
  it("recognizes Vite and common dev servers with clean display brands", () => {
    expect(resolvePortPresentation("vite")).toEqual({ brand: "Vite", kind: "vite" });
    expect(resolvePortPresentation("/usr/local/bin/vite")).toEqual({ brand: "Vite", kind: "vite" });
    expect(resolvePortPresentation("next-server")).toEqual({ brand: "Next.js", kind: "next" });
    expect(resolvePortPresentation("node.exe")).toEqual({ brand: "Node", kind: "node" });
    expect(resolvePortPresentation("python3")).toEqual({ brand: "Python", kind: "python" });
    expect(resolvePortPresentation("postgres")).toEqual({ brand: "Postgres", kind: "database" });
  });

  it("falls back cleanly for unknown or empty process names", () => {
    expect(resolvePortPresentation("my-custom-api")).toEqual({
      brand: "my-custom-api",
      kind: "generic",
    });
    expect(resolvePortPresentation(null)).toEqual({ brand: null, kind: "generic" });
    expect(resolvePortPresentation("   ")).toEqual({ brand: null, kind: "generic" });
  });
});

describe("splitAgentTeamLabel", () => {
  it("separates short agent names from their task summary", () => {
    expect(splitAgentTeamLabel("Tyr: Table Tennis Break Room")).toEqual({
      lead: "Tyr",
      detail: "Table Tennis Break Room",
    });
    expect(splitAgentTeamLabel("Diana · Paper Ball Throws")).toEqual({
      lead: "Diana",
      detail: "Paper Ball Throws",
    });
    expect(splitAgentTeamLabel("Researcher — Audit auth flow")).toEqual({
      lead: "Researcher",
      detail: "Audit auth flow",
    });
  });

  it("keeps plain titles intact when there is no agent prefix", () => {
    expect(splitAgentTeamLabel("Landing Page Refinement")).toEqual({
      lead: "Landing Page Refinement",
      detail: null,
    });
  });
});
