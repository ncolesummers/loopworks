import { cleanup, render, screen } from "@testing-library/react";

import { FixtureGatedPage } from "@/components/portal/fixture-gated-page";
import type { LoopworksLogger } from "@/lib/observability/logger";

function createMockLogger() {
  const logger = {
    child: vi.fn(() => logger),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return logger as unknown as LoopworksLogger & {
    warn: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("FixtureGatedPage", () => {
  it("renders children when not running in production", () => {
    render(
      <FixtureGatedPage area="Catalog" env={{ NODE_ENV: "development" }}>
        <div>Real catalog content</div>
      </FixtureGatedPage>,
    );

    expect(screen.getByText("Real catalog content")).toBeTruthy();
    expect(screen.queryByText(/unavailable in production/i)).toBeNull();
  });

  it("renders a degraded notice instead of children when NODE_ENV is production", () => {
    render(
      <FixtureGatedPage area="Catalog" env={{ NODE_ENV: "production" }}>
        <div>Real catalog content</div>
      </FixtureGatedPage>,
    );

    expect(screen.queryByText("Real catalog content")).toBeNull();
    expect(screen.getByText(/unavailable in production/i)).toBeTruthy();
    expect(screen.getByText(/Catalog/)).toBeTruthy();
  });

  it("also fails closed when VERCEL_ENV is production", () => {
    render(
      <FixtureGatedPage area="Approvals" env={{ VERCEL_ENV: "production" }}>
        <div>Real approvals content</div>
      </FixtureGatedPage>,
    );

    expect(screen.queryByText("Real approvals content")).toBeNull();
    expect(screen.getByText(/unavailable in production/i)).toBeTruthy();
  });

  it("falls through to real process.env when no env prop is passed, the path every real page uses", () => {
    vi.stubEnv("NODE_ENV", "production");

    render(
      <FixtureGatedPage area="Runs">
        <div>Real runs content</div>
      </FixtureGatedPage>,
    );

    expect(screen.queryByText("Real runs content")).toBeNull();
    expect(screen.getByText(/unavailable in production/i)).toBeTruthy();
  });

  it("logs a structured warning identifying the fixture-gate reason when it trips, without a logger prop causing a crash", () => {
    const logger = createMockLogger();

    render(
      <FixtureGatedPage area="Catalog" env={{ NODE_ENV: "production" }} logger={logger}>
        <div>Real catalog content</div>
      </FixtureGatedPage>,
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ area: "Catalog" }),
      "portal_fixture_gate_blocked",
    );
  });

  it("does not log when rendering real children outside production", () => {
    const logger = createMockLogger();

    render(
      <FixtureGatedPage area="Catalog" env={{ NODE_ENV: "development" }} logger={logger}>
        <div>Real catalog content</div>
      </FixtureGatedPage>,
    );

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
