import { describe, expect, it } from "vitest";
import { detectKind } from "./fileKinds";

describe("detectKind: language and icon from the file", () => {
  it("knows common languages by extension, ignoring case", () => {
    expect(detectKind("App.tsx")).toMatchObject({ id: "typescript", label: "TypeScript", icon: "🔷" });
    expect(detectKind("main.PY")).toMatchObject({ id: "python", icon: "🐍" });
    expect(detectKind("lib.rs")).toMatchObject({ id: "rust", icon: "🦀" });
    expect(detectKind("notes.md")).toMatchObject({ id: "markdown", icon: "📝" });
    expect(detectKind("index.html")).toMatchObject({ id: "html", icon: "🌐" });
    expect(detectKind("site.scss")).toMatchObject({ id: "css", icon: "🎨" });
    expect(detectKind("Program.cs")).toMatchObject({ id: "csharp", label: "C#" });
    expect(detectKind("query.sql")).toMatchObject({ id: "sql", icon: "🗄️" });
    expect(detectKind("deploy.ps1")).toMatchObject({ id: "powershell" });
    expect(detectKind("data.csv")).toMatchObject({ id: "table" });
    expect(detectKind("server.log")).toMatchObject({ id: "log", icon: "📜" });
  });

  it("groups configuration files under one gear icon", () => {
    for (const f of ["a.json", "a.yaml", "a.yml", "a.toml", "a.ini", ".env", "app.config"]) {
      expect(detectKind(f).icon, f).toMatch(/⚙️|🧾/);
    }
    expect(detectKind("package.json").id).toBe("json");
  });

  it("recognises well-known files by name", () => {
    expect(detectKind("Dockerfile")).toMatchObject({ id: "docker", icon: "🐳" });
    expect(detectKind("Makefile")).toMatchObject({ id: "make" });
    expect(detectKind(".gitignore")).toMatchObject({ id: "git", icon: "🙈" });
    expect(detectKind("README")).toMatchObject({ id: "text" });
  });

  it("falls back to plain text for anything unknown", () => {
    expect(detectKind("whatever.zzz")).toMatchObject({ id: "text", label: "Plain text", icon: "📄" });
    expect(detectKind("")).toMatchObject({ id: "text" });
  });

  it("sniffs the content when the name says nothing", () => {
    expect(detectKind("new 1", "#!/usr/bin/env python3\nprint(1)").id).toBe("python");
    expect(detectKind("new 1", "#!/bin/bash\necho hi").id).toBe("shell");
    expect(detectKind("new 1", "#!/usr/bin/env node\n").id).toBe("javascript");
    expect(detectKind("new 1", '{"a": 1}').id).toBe("json");
    expect(detectKind("new 1", "[1, 2]").id).toBe("json");
    expect(detectKind("new 1", "<!DOCTYPE html><html></html>").id).toBe("html");
    expect(detectKind("new 1", '<?xml version="1.0"?><a/>').id).toBe("xml");
    expect(detectKind("new 1", "<?php echo 1;").id).toBe("php");
    expect(detectKind("new 1", "just words").id).toBe("text");
    expect(detectKind("new 1", "{ not json").id).toBe("text");
  });

  it("trusts a real extension over the content", () => {
    expect(detectKind("notes.txt", '{"a":1}').id).toBe("text");
  });

  it("gives the editor a file name it can match a language on", () => {
    expect(detectKind("App.tsx").filename).toBe("App.tsx");
    expect(detectKind("new 1", "#!/usr/bin/env python3").filename).toBe("untitled.py");
    expect(detectKind("Dockerfile").filename).toBe("Dockerfile");
  });
});
