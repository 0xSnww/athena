import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  shell: null as {
    hasPendingApprovals?: boolean;
    hasPendingUserInput?: boolean;
    hasActionableProposedPlan?: boolean;
    latestRun?: { status?: string } | null;
    runtime?: { status?: string } | null;
  } | null,
  handleNewThread: vi.fn(async () => undefined),
  openCommandPalette: vi.fn(),
}));

vi.mock("~/state/entities", () => ({
  useProjects: () => [],
  useQuietThreadShell: () => state.shell,
}));

vi.mock("~/hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    handleNewThread: state.handleNewThread,
    routeThreadRef: null,
  }),
}));

vi.mock("~/commandPaletteBus", () => ({
  openCommandPalette: (...args: unknown[]) => state.openCommandPalette(...args),
}));

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { AthenaAgentBadge } from "./AthenaAgentBadge";
import { AthenaFloatingRail } from "./AthenaFloatingRail";

function resetMocks() {
  state.shell = null;
  state.handleNewThread.mockClear();
  state.openCommandPalette.mockClear();
}

it("toggles the Athena floating rail between collapsed New thread and expanded Add project", async () => {
  resetMocks();
  await page.viewport(1280, 800);
  await using screen = await render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <AthenaFloatingRail />
      </SidebarProvider>
    </TooltipProvider>,
  );

  await expect.element(page.getByRole("button", { name: "New thread" })).toBeVisible();
  expect(screen.container.querySelector("[data-athena-floating-dock]")).not.toBeNull();

  await page.getByRole("button", { name: "Toggle main sidebar" }).click();
  await expect.element(page.getByRole("button", { name: "Add project" })).toBeVisible();

  await page.getByRole("button", { name: "Add project" }).click();
  expect(state.openCommandPalette).toHaveBeenCalledWith({ open: "add-project" });

  await page.getByRole("button", { name: "Toggle main sidebar" }).click();
  await expect.element(page.getByRole("button", { name: "New thread" })).toBeVisible();
});

it("maps live thread states onto the Athena thread buddy mood", async () => {
  resetMocks();
  const threadRef = {
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make("thread-1"),
  };

  state.shell = { runtime: { status: "running" } };
  await using screen = await render(<AthenaAgentBadge threadRef={threadRef} />);
  const readMood = () =>
    screen.container
      .querySelector("[data-athena-buddy-mood]")
      ?.getAttribute("data-athena-buddy-mood");

  expect(readMood()).toBe("working");

  state.shell = { hasPendingApprovals: true, runtime: { status: "running" } };
  await screen.rerender(<AthenaAgentBadge threadRef={threadRef} />);
  expect(readMood()).toBe("attention");

  state.shell = { latestRun: { status: "failed" } };
  await screen.rerender(<AthenaAgentBadge threadRef={threadRef} />);
  expect(readMood()).toBe("error");

  await screen.rerender(<AthenaAgentBadge threadRef={threadRef} mood="happy" />);
  expect(readMood()).toBe("happy");
});
