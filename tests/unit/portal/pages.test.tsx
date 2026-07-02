import { cleanup, render, screen } from "@testing-library/react";

import ApprovalsPage from "@/app/(portal)/approvals/page";
import CatalogPage from "@/app/(portal)/catalog/page";
import LoopsPage from "@/app/(portal)/loops/page";
import DashboardPage from "@/app/(portal)/page";
import RunsPage from "@/app/(portal)/runs/page";
import SettingsPage from "@/app/(portal)/settings/page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("fixture-backed portal pages fail closed in production", () => {
  it.each([
    ["Dashboard", DashboardPage],
    ["Catalog", CatalogPage],
    ["Loops", LoopsPage],
    ["Approvals", ApprovalsPage],
    ["Runs", RunsPage],
    ["Settings", SettingsPage],
  ] as const)("%s page renders the fixture-unavailable notice instead of fixtures in production", (_area, Page) => {
    vi.stubEnv("NODE_ENV", "production");

    render(<Page />);

    expect(screen.getByText(/unavailable in production/i)).toBeTruthy();
  });
});
