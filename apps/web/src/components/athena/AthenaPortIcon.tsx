import {
  ContainerIcon,
  DatabaseIcon,
  GlobeIcon,
  ServerIcon,
  SmartphoneIcon,
  TerminalIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";

interface PortPresentation {
  readonly brand: string | null;
  readonly kind:
    | "vite"
    | "next"
    | "node"
    | "bun"
    | "deno"
    | "python"
    | "rust"
    | "go"
    | "docker"
    | "database"
    | "mobile"
    | "generic";
}

function normalizeProcessName(processName: string | null | undefined): string {
  if (!processName) return "";
  return processName
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/\.exe$/i, "")
    .toLowerCase();
}

export function resolvePortPresentation(processName: string | null | undefined): PortPresentation {
  const raw = processName?.trim() ?? "";
  const normalized = normalizeProcessName(raw);
  if (!normalized) return { brand: null, kind: "generic" };

  if (normalized.includes("vite")) return { brand: "Vite", kind: "vite" };
  if (
    normalized === "next" ||
    normalized.includes("next-server") ||
    normalized.includes("nextjs")
  ) {
    return { brand: "Next.js", kind: "next" };
  }
  if (normalized.includes("astro")) return { brand: "Astro", kind: "vite" };
  if (normalized.includes("nuxt")) return { brand: "Nuxt", kind: "vite" };
  if (normalized.includes("storybook")) return { brand: "Storybook", kind: "vite" };
  if (normalized.includes("metro") || normalized.includes("expo")) {
    return { brand: normalized.includes("expo") ? "Expo" : "Metro", kind: "mobile" };
  }
  if (normalized === "bun" || normalized.startsWith("bun-")) {
    return { brand: "Bun", kind: "bun" };
  }
  if (normalized === "deno") return { brand: "Deno", kind: "deno" };
  if (normalized === "node" || normalized === "nodejs" || normalized === "tsx") {
    return { brand: normalized === "tsx" ? "TSX" : "Node", kind: "node" };
  }
  if (
    normalized.startsWith("python") ||
    normalized === "uvicorn" ||
    normalized === "gunicorn" ||
    normalized === "flask" ||
    normalized === "fastapi"
  ) {
    return {
      brand: normalized.startsWith("python")
        ? "Python"
        : raw.charAt(0).toUpperCase() + raw.slice(1),
      kind: "python",
    };
  }
  if (normalized === "cargo" || normalized === "rustc") {
    return { brand: "Cargo", kind: "rust" };
  }
  if (normalized === "go") return { brand: "Go", kind: "go" };
  if (normalized.includes("docker") || normalized.includes("containerd")) {
    return { brand: "Docker", kind: "docker" };
  }
  if (
    normalized.includes("postgres") ||
    normalized.includes("redis") ||
    normalized.includes("mysql") ||
    normalized.includes("mongo") ||
    normalized.includes("sqlite")
  ) {
    const brand = normalized.includes("postgres")
      ? "Postgres"
      : normalized.includes("redis")
        ? "Redis"
        : normalized.includes("mysql")
          ? "MySQL"
          : normalized.includes("mongo")
            ? "MongoDB"
            : "SQLite";
    return { brand, kind: "database" };
  }

  return { brand: raw, kind: "generic" };
}

function ViteGlyph({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M14.1 3.1 8.45 13.4a.5.5 0 0 1-.88 0L1.9 3.1a.48.48 0 0 1 .5-.7l5.58 1a.5.5 0 0 0 .18 0l5.44-1a.48.48 0 0 1 .5.7Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M10.45 1.85 6.85 2.55a.25.25 0 0 0-.2.24l-.2 3.7a.25.25 0 0 0 .31.26l.98-.23a.25.25 0 0 1 .3.3l-.3 1.45a.25.25 0 0 0 .32.29l.6-.18a.25.25 0 0 1 .32.29l-.47 2.25c-.03.14.15.22.23.1l2.7-5.35a.25.25 0 0 0-.27-.36l-1.02.2a.25.25 0 0 1-.29-.32l.66-2.32a.25.25 0 0 0-.27-.32Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NextGlyph({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      fill="none"
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M5.75 10.75v-5.5l5.45 6.85M10.25 5.25v3.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

export function AthenaPortIcon({
  processName,
  className,
}: {
  readonly processName: string | null | undefined;
  readonly className?: string | undefined;
}) {
  const { kind } = resolvePortPresentation(processName);
  switch (kind) {
    case "vite":
      return <ViteGlyph className={className} />;
    case "next":
      return <NextGlyph className={className} />;
    case "docker":
      return <ContainerIcon aria-hidden className={className} />;
    case "database":
      return <DatabaseIcon aria-hidden className={className} />;
    case "mobile":
      return <SmartphoneIcon aria-hidden className={className} />;
    case "node":
    case "bun":
    case "deno":
      return <ServerIcon aria-hidden className={className} />;
    case "python":
    case "rust":
    case "go":
      return <TerminalIcon aria-hidden className={className} />;
    default:
      return <GlobeIcon aria-hidden className={className} />;
  }
}
