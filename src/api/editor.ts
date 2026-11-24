// Thin wrappers for the text editor commands. Nothing else in the UI imports Tauri.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { EditorDoc, EditorListing } from "../state/editor";

export const editorApi = {
  list: () => invoke<EditorListing>("editor_list"),
  open: (path: string) => invoke<EditorDoc>("editor_open_any", { path }),
  newDoc: () => invoke<EditorDoc>("editor_new"),
  load: (id: string) => invoke<EditorDoc>("editor_load_any", { id }),
  snapshot: (id: string, content: string) => invoke<void>("editor_snapshot", { id, content }),
  save: (id: string, content: string, path: string | null) => invoke<EditorDoc>("editor_save_any", { id, content, path }),
  close: (id: string) => invoke<void>("editor_close", { id }),
  restore: (id: string) => invoke<EditorDoc>("editor_restore", { id }),
  discard: (id: string) => invoke<void>("editor_discard", { id }),
  takePending: () => invoke<string[]>("editor_take_pending"),
  touch: (id: string) => invoke<void>("editor_touch", { id }),
  /** Raw bytes of an image or PDF, for the preview pane. */
  readBytes: async (path: string): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>("editor_read_bytes", { path })),
  pickOpenPaths: async (): Promise<string[]> => {
    const r = await open({ multiple: true, directory: false });
    return r == null ? [] : Array.isArray(r) ? r : [r];
  },
  pickSavePath: async (defaultName: string): Promise<string | null> => (await save({ defaultPath: defaultName })) ?? null,
  /** A file arrived from "Edit with Tinkerdeck" while the app was already running. */
  onOpen: (cb: (path: string) => void): Promise<UnlistenFn> => listen<string>("editor-open", (e) => cb(e.payload)),
};
