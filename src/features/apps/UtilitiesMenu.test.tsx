import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UtilitiesMenu } from "./UtilitiesMenu";

const props = () => ({
  editorActive: false,
  onEditor: vi.fn(),
  onCheckUpdates: vi.fn(),
  updatesBusy: false,
  updateAvailable: null as string | null,
  onRefresh: vi.fn(),
  onHelp: vi.fn(),
});

describe("UtilitiesMenu", () => {
  it("R3: is hidden until it is opened and is hidden again with Escape", async () => {
    render(<UtilitiesMenu {...props()} />);
    expect(screen.queryByRole("menu")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    expect(screen.getByRole("menu", { name: "Utilities" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("R3: clicking outside hides it again", async () => {
    render(
      <div>
        <UtilitiesMenu {...props()} />
        <button>outside</button>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("R6: the Refresh item no longer tells the user F5 refreshes", async () => {
    render(<UtilitiesMenu {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    const refresh = screen.getByRole("menuitem", { name: "Refresh everything" });
    expect(refresh).toHaveTextContent("Refresh");
    expect(refresh).not.toHaveTextContent("F5");
  });

  it("R3: choosing an action runs it once and closes the menu", async () => {
    const p = props();
    render(<UtilitiesMenu {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Refresh everything" }));

    expect(p.onRefresh).toHaveBeenCalledTimes(1);
    expect(p.onHelp).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("R3: the Updates item is disabled while a check runs and shows the waiting version otherwise", async () => {
    const p = props();
    const { rerender } = render(<UtilitiesMenu {...p} updatesBusy />);
    await userEvent.click(screen.getByRole("button", { name: "Utilities" }));
    expect(screen.getByRole("menuitem", { name: "Check for updates" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Check for updates" })).toHaveTextContent("Checking…");

    rerender(<UtilitiesMenu {...p} updateAvailable="1.3.0" />);
    expect(screen.getByRole("menuitem", { name: "Check for updates" })).toHaveTextContent("1.3.0");
  });
});
