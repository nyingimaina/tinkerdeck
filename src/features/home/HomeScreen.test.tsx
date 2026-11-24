import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";
import type { AppDef, TermState } from "../../state/model";

const app = (id: string, over: Partial<AppDef> = {}): AppDef => ({
  id,
  name: `App ${id}`,
  root: `C:\\code\\${id}`,
  terminals: [{ id: `${id}-t`, name: "t", cwd: ".", command: "", env: {} }],
  ...over,
});
const running: TermState = { kind: "running" };
const stopped: TermState = { kind: "stopped" };

const setup = (apps: AppDef[], opts: { up?: string[]; exists?: Record<string, boolean> } = {}) => {
  const h = {
    onOpen: vi.fn(),
    onStartAll: vi.fn(),
    onStopAll: vi.fn(),
    onToggleFavourite: vi.fn(),
    onAdd: vi.fn(),
    onOpenFolder: vi.fn(),
  };
  render(
    <HomeScreen
      apps={apps}
      stateOf={(id) => (opts.up?.includes(id) ? running : stopped)}
      folderExists={opts.exists ?? {}}
      {...h}
    />,
  );
  return h;
};

const section = (name: string) => screen.getByRole("region", { name });

describe("HomeScreen", () => {
  it("shows Favourites, Recent (with relative time) and Running now as separate sections", () => {
    const now = Math.floor(Date.now() / 1000);
    setup(
      [app("a", { favourite: true }), app("b", { lastOpened: now - 3 * 3600 }), app("c")],
      { up: ["c-t"] },
    );
    expect(within(section("Favourites")).getByText("App a")).toBeInTheDocument();
    expect(within(section("Recent")).getByText("App b")).toBeInTheDocument();
    expect(within(section("Recent")).getByText(/3h ago/)).toBeInTheDocument();
    expect(within(section("Running now")).getByText("App c")).toBeInTheDocument();
    expect(within(section("Running now")).getByText("1 running")).toBeInTheDocument();
  });

  it("empty sections are not rendered and a hint explains how to fill them", () => {
    setup([app("a")]);
    expect(screen.queryByRole("region", { name: "Favourites" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Recent" })).toBeNull();
    expect(screen.getByText(/Star an app to pin it here/)).toBeInTheDocument();
    expect(within(section("All apps")).getByText("App a")).toBeInTheDocument();
  });

  it("opens an app from its card", async () => {
    const h = setup([app("a", { favourite: true })]);
    await userEvent.click(within(section("Favourites")).getByRole("button", { name: "Open App a" }));
    expect(h.onOpen).toHaveBeenCalledWith("a");
  });

  it("star toggles favourite with an accessible state", async () => {
    const h = setup([app("a", { favourite: true }), app("b")]);
    const fav = within(section("Favourites")).getByRole("button", { name: "Remove App a from favourites" });
    expect(fav).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(fav);
    expect(h.onToggleFavourite).toHaveBeenCalledWith("a");
    await userEvent.click(within(section("All apps")).getByRole("button", { name: "Add App b to favourites" }));
    expect(h.onToggleFavourite).toHaveBeenCalledWith("b");
  });

  it("each card offers Start all, or Stop all when something is up", async () => {
    const h = setup([app("a", { favourite: true }), app("b", { favourite: true })], { up: ["b-t"] });
    const fav = section("Favourites");
    await userEvent.click(within(fav).getByRole("button", { name: "Start all in App a" }));
    await userEvent.click(within(fav).getByRole("button", { name: "Stop all in App b" }));
    expect(h.onStartAll).toHaveBeenCalledWith("a");
    expect(h.onStopAll).toHaveBeenCalledWith("b");
  });

  it("T29: an app whose folder is gone is greyed with a message and cannot start", () => {
    setup([app("a", { favourite: true })], { exists: { "C:\\code\\a": false } });
    const card = within(section("Favourites"));
    expect(card.getByText("Folder not found")).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Start all in App a" })).toBeDisabled();
    expect(card.getByRole("button", { name: "Open App a" })).toBeEnabled(); // still openable to fix it
  });

  it("offers Open folder… and New app", async () => {
    const h = setup([]);
    await userEvent.click(screen.getByRole("button", { name: /Open folder/ }));
    await userEvent.click(screen.getByRole("button", { name: /New app/ }));
    expect(h.onOpenFolder).toHaveBeenCalled();
    expect(h.onAdd).toHaveBeenCalled();
  });

  it("an app with no terminals cannot Start all", () => {
    setup([app("a", { favourite: true, terminals: [] })]);
    const buttons = screen.getAllByRole("button", { name: "Start all in App a" }); // favourites + all apps
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((b) => expect(b).toBeDisabled());
  });

  it("a running console alone marks the app as running", () => {
    setup([app("a")], { up: ["console-a"] });
    expect(within(section("Running now")).getByText("App a")).toBeInTheDocument();
  });
});
