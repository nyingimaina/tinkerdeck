import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditPane } from "./EditPane";
import type { AppDef } from "../../state/model";

vi.mock("../../api/tauri", () => ({
  pickFolder: vi.fn(async () => null),
  api: {
    detectProject: vi.fn(async () => []),
    suggestCommands: vi.fn(async () => []),
    listSubfolders: vi.fn(async () => []),
    dockerContainers: vi.fn(async () => []),
  },
}));

const T = (id: string, name: string) => ({ id, name, cwd: ".", command: "", env: {} });
const sug = (over: object) => ({
  name: "x",
  cwd: ".",
  command: "npm run dev",
  stopCommand: null,
  kind: "node",
  primary: true,
  ...over,
});

const mount = (helpers: object = {}, props: Partial<React.ComponentProps<typeof EditPane>> = {}) => {
  const onSave = vi.fn();
  render(
    <EditPane
      initial={{ id: "n", name: "", root: "", terminals: [] }}
      isNew
      runningTerminalIds={[]}
      onSave={onSave}
      onCancel={vi.fn()}
      helpers={{
        pick: async () => "E:\\code\\Qonsol",
        detectProject: async () => [],
        suggestCommands: async () => [],
        listSubfolders: async () => [],
        dockerContainers: async () => [],
        ...helpers,
      }}
      {...props}
    />,
  );
  return { onSave };
};

const existing = (terminals = [T("1", "web")]): Partial<React.ComponentProps<typeof EditPane>> => ({
  initial: { id: "a", name: "A", root: "E:\\q", terminals },
  isNew: false,
});

describe("EditPane: novice flow (pickers, detection, autocomplete)", () => {
  it("first step is one big folder button; picking names the app and adds the detected terminals", async () => {
    const detectProject = vi.fn(async () => [
      sug({ name: "frontend", cwd: "frontend", command: "npm run dev" }),
      sug({ name: "Qonsol.Api", cwd: "backend\\Qonsol.Api", command: "dotnet watch run", kind: "dotnet" }),
      sug({ name: "Qonsol-compose", cwd: ".", command: "docker compose up", stopCommand: "docker compose down", kind: "docker" }),
    ]);
    const { onSave } = mount({ detectProject });
    await userEvent.click(screen.getByRole("button", { name: /Choose project folder/ }));
    await waitFor(() => expect(screen.getByLabelText("Terminal 3 name")).toBeInTheDocument());
    expect(detectProject).toHaveBeenCalledWith("E:\\code\\Qonsol");
    expect(screen.getByPlaceholderText("Qonsol")).toHaveValue("Qonsol");
    expect(screen.getByText(/We found 3 terminals/)).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal 3 stop command")).toHaveValue("docker compose down");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0][0] as AppDef;
    expect(saved.root).toBe("E:\\code\\Qonsol");
    expect(saved.terminals.map((t) => t.command)).toEqual(["npm run dev", "dotnet watch run", "docker compose up"]);
  });

  it("explains itself when nothing is recognised", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Choose project folder/ }));
    expect(await screen.findByText(/could not recognise a project/)).toBeInTheDocument();
  });

  it("does not duplicate on a second detect and numbers repeated names", async () => {
    const detectProject = vi.fn(async () => [
      sug({ name: "web", cwd: "a" }),
      sug({ name: "web", cwd: "b", command: "npm start" }),
    ]);
    mount({ detectProject });
    await userEvent.click(screen.getByRole("button", { name: /Choose project folder/ }));
    await screen.findByLabelText("Terminal 2 name");
    expect(screen.getByLabelText("Terminal 1 name")).toHaveValue("web");
    expect(screen.getByLabelText("Terminal 2 name")).toHaveValue("web 2");
    await userEvent.click(screen.getByRole("button", { name: /Detect terminals/ }));
    expect(await screen.findByText(/already in the list/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Terminal 3 name")).toBeNull();
  });

  it("folder is a dropdown of the project's sub-folders plus Browse", async () => {
    mount({ listSubfolders: async () => ["backend", "frontend"] }, existing());
    const select = (await screen.findByLabelText("Terminal 1 folder")) as HTMLSelectElement;
    await waitFor(() => expect([...select.options].map((o) => o.value)).toContain("frontend"));
    expect([...select.options].map((o) => o.value)).toEqual([".", "backend", "frontend", "__browse__"]);
    await userEvent.selectOptions(select, "frontend");
    expect(select.value).toBe("frontend");
    await userEvent.selectOptions(select, "__browse__");
    await waitFor(() => expect(select.value).toBe("E:\\code\\Qonsol"));
  });

  it("command autocomplete offers detected scripts, docker containers and common commands", async () => {
    mount(
      { suggestCommands: async () => [sug({ command: "npm run storybook" })], dockerContainers: async () => ["pg"] },
      existing(),
    );
    const input = screen.getByLabelText("Terminal 1 command");
    const list = () =>
      [...document.querySelectorAll(`#${input.getAttribute("list")} option`)].map((o) => (o as HTMLOptionElement).value);
    await waitFor(() => expect(list()).toContain("npm run storybook"));
    expect(list()).toContain("docker start pg");
    expect(list()).toContain("dotnet watch run");
  });

  it("docker start X fills the stop command, follows edits, and never overwrites the user's own text", async () => {
    const { onSave } = mount({}, existing([T("1", "db")]));
    const cmd = screen.getByLabelText("Terminal 1 command");
    const stop = screen.getByLabelText("Terminal 1 stop command");
    await userEvent.type(cmd, "docker start pg");
    expect(stop).toHaveValue("docker stop pg");
    await userEvent.clear(cmd);
    await userEvent.type(cmd, "docker start redis");
    expect(stop).toHaveValue("docker stop redis");
    await userEvent.clear(stop);
    await userEvent.type(stop, "my own stop");
    await userEvent.type(cmd, "2");
    expect(stop).toHaveValue("my own stop");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals[0].stopCommand).toBe("my own stop");
  });

  it("templates add prefilled terminals; the Docker one uses a real container name", async () => {
    const { onSave } = mount({ dockerContainers: async () => ["qonsol-db"] }, existing([]));
    await userEvent.selectOptions(screen.getByLabelText("Add from template"), "dotnet");
    await waitFor(() => expect(screen.getByLabelText("Terminal 1 command")).toHaveValue("dotnet watch run"));
    await userEvent.selectOptions(screen.getByLabelText("Add from template"), "docker");
    await waitFor(() => expect(screen.getByLabelText("Terminal 2 command")).toHaveValue("docker start qonsol-db"));
    expect(screen.getByLabelText("Terminal 2 stop command")).toHaveValue("docker stop qonsol-db");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as AppDef).terminals).toHaveLength(2);
  });

  it("terminal name has autocomplete suggestions", () => {
    mount({}, existing([T("1", "")]));
    const input = screen.getByLabelText("Terminal 1 name");
    const opts = [...document.querySelectorAll(`#${input.getAttribute("list")} option`)].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(opts).toEqual(expect.arrayContaining(["api", "frontend", "db"]));
  });
});
