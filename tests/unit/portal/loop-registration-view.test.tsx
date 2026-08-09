import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LoopRegistrationView } from "@/components/portal/loop-registration-view";
import type {
  LoopRegistrationResult,
  LoopRegistrationSnapshot,
} from "@/lib/loops/loop-registration-flow";

afterEach(cleanup);

const ready: LoopRegistrationSnapshot = {
  repositories: [
    {
      defaultBranch: "main",
      fullName: "loopworks-org/portal",
      id: "11111111-1111-4111-8111-111111111111",
      name: "portal",
      owner: "loopworks-org",
    },
    {
      defaultBranch: "trunk",
      fullName: "loopworks-org/agent",
      id: "22222222-2222-4222-8222-222222222222",
      name: "agent",
      owner: "loopworks-org",
    },
  ],
  status: "ready",
};

function surface() {
  return screen.getByRole("region", { name: "Loop registration" });
}

function registered(): LoopRegistrationResult {
  return { loopKey: "development-loop", status: "registered" };
}

describe("loop registration surface states", () => {
  it("holds the same surface dimensions across loading, empty, error, and ready states", () => {
    const classNames: string[] = [];

    for (const [snapshot, loading] of [
      [ready, true],
      [{ status: "no-tracked-repositories" } as LoopRegistrationSnapshot, false],
      [{ reason: "unused", status: "error" } as LoopRegistrationSnapshot, false],
      [ready, false],
    ] as const) {
      render(<LoopRegistrationView loading={loading} snapshot={snapshot} />);
      classNames.push(surface().className);
      cleanup();
    }

    expect(new Set(classNames).size).toBe(1);
    expect(classNames[0]).toContain("min-h-");
  });

  it("marks the loading state busy without collapsing the surface", () => {
    render(<LoopRegistrationView loading snapshot={ready} />);

    expect(surface().getAttribute("aria-busy")).toBe("true");
  });

  it("routes an operator with no tracked repositories back to selection", () => {
    render(<LoopRegistrationView snapshot={{ status: "no-tracked-repositories" }} />);

    const action = screen.getByRole("link", { name: "Select repositories" });
    expect(action.getAttribute("href")).toBe("/settings/repositories");
    // An empty state must route to the step it names (ADR 0019).
    expect(screen.queryByRole("button", { name: "Register loop" })).toBeNull();
  });

  it("does not offer registration when the read failed", () => {
    render(<LoopRegistrationView snapshot={{ reason: "catalog_unreachable", status: "error" }} />);

    expect(screen.queryByRole("button", { name: "Register loop" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Select repositories" })).toBeNull();
  });
});

describe("loop registration form", () => {
  it("prefills the shipped development loop defaults and preselects a repository", () => {
    render(<LoopRegistrationView snapshot={ready} />);

    expect((screen.getByLabelText("Loop name") as HTMLInputElement).value).toBe(
      "Agent-ready development loop",
    );
    expect((screen.getByLabelText("Loop key") as HTMLInputElement).value).toBe("development-loop");
    expect((screen.getByLabelText("Trigger labels") as HTMLInputElement).value).toBe("agent-ready");
    expect((screen.getByLabelText("Enabled") as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole("radio", { name: /loopworks-org\/portal/ }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("keeps repository choice and submission keyboard-operable", async () => {
    const register = vi.fn<(input: never) => Promise<LoopRegistrationResult>>();
    register.mockResolvedValue(registered());
    render(<LoopRegistrationView register={register as never} snapshot={ready} />);

    const agent = screen.getByRole("radio", { name: /loopworks-org\/agent/ }) as HTMLInputElement;
    agent.focus();
    fireEvent.click(agent);
    expect(agent.checked).toBe(true);

    fireEvent.submit(screen.getByRole("form", { name: "Register a loop" }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0]?.[0]).toEqual({
      enabled: true,
      issueLabels: ["agent-ready"],
      key: "development-loop",
      name: "Agent-ready development loop",
      repositoryId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("splits comma-separated trigger labels and drops blank entries", async () => {
    const register = vi.fn().mockResolvedValue(registered());
    render(<LoopRegistrationView register={register} snapshot={ready} />);

    fireEvent.change(screen.getByLabelText("Trigger labels"), {
      target: { value: "agent-ready, , status:ready ," },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register loop" }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0]?.[0].issueLabels).toEqual(["agent-ready", "status:ready"]);
  });

  it("renders schema validation errors against their field paths", async () => {
    const register = vi.fn().mockResolvedValue({
      errors: [
        {
          hint: "Add at least one GitHub label that can trigger the loop, such as agent-ready.",
          message: "Too small: expected array to have >=1 items",
          path: "triggers.issueLabels",
        },
      ],
      status: "invalid",
    });
    render(<LoopRegistrationView register={register} snapshot={ready} />);

    fireEvent.change(screen.getByLabelText("Trigger labels"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Register loop" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("triggers.issueLabels");
    expect(status.textContent).toContain(
      "Add at least one GitHub label that can trigger the loop, such as agent-ready.",
    );
  });

  it("explains a duplicate key without claiming the loop was registered", async () => {
    const register = vi.fn().mockResolvedValue({ status: "duplicate-key" });
    render(<LoopRegistrationView register={register} snapshot={ready} />);

    fireEvent.click(screen.getByRole("button", { name: "Register loop" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/already/i);
    expect(status.textContent).not.toMatch(/registered\./i);
  });

  it("reports a rejected request instead of silently re-enabling the button", async () => {
    const register = vi.fn().mockRejectedValue(new Error("network"));
    render(<LoopRegistrationView register={register} snapshot={ready} />);

    fireEvent.click(screen.getByRole("button", { name: "Register loop" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/could not be registered/i);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Register loop" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("confirms a successful registration and notifies the caller", async () => {
    const onRegistered = vi.fn();
    const register = vi.fn().mockResolvedValue(registered());
    render(
      <LoopRegistrationView onRegistered={onRegistered} register={register} snapshot={ready} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Register loop" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("development-loop");
    await waitFor(() => expect(onRegistered).toHaveBeenCalledTimes(1));
  });

  it("disables submission in fixture mode and says why", () => {
    const register = vi.fn();
    render(<LoopRegistrationView fixtureMode register={register} snapshot={ready} />);

    const submit = screen.getByRole("button", { name: "Register loop" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/fixture data, so registration is disabled/i)).toBeTruthy();

    fireEvent.click(submit);
    expect(register).not.toHaveBeenCalled();
  });
});
