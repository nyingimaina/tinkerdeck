// Language and icon for a file, from its name and, when the name says nothing, its first lines.
// This is deliberately a small table: the heavy language support (highlighting) is loaded lazily elsewhere.

export interface FileKind {
  id: string;
  label: string;
  icon: string;
  /** A file name the editor can match a language on (the real name, or `untitled.<ext>` when sniffed). */
  filename: string;
}

type Def = { label: string; icon: string; ext: string; exts: string[] };

const DEFS: Record<string, Def> = {
  typescript: { label: "TypeScript", icon: "🔷", ext: "ts", exts: ["ts", "tsx", "mts", "cts"] },
  javascript: { label: "JavaScript", icon: "🟨", ext: "js", exts: ["js", "jsx", "mjs", "cjs"] },
  json: { label: "JSON", icon: "🧾", ext: "json", exts: ["json", "jsonc", "json5"] },
  yaml: { label: "YAML", icon: "⚙️", ext: "yaml", exts: ["yaml", "yml"] },
  toml: { label: "TOML", icon: "⚙️", ext: "toml", exts: ["toml"] },
  config: { label: "Config", icon: "⚙️", ext: "ini", exts: ["ini", "conf", "cfg", "config", "env", "properties", "editorconfig"] },
  markdown: { label: "Markdown", icon: "📝", ext: "md", exts: ["md", "markdown", "mdx"] },
  html: { label: "HTML", icon: "🌐", ext: "html", exts: ["html", "htm"] },
  css: { label: "CSS", icon: "🎨", ext: "css", exts: ["css", "scss", "sass", "less"] },
  python: { label: "Python", icon: "🐍", ext: "py", exts: ["py", "pyw"] },
  rust: { label: "Rust", icon: "🦀", ext: "rs", exts: ["rs"] },
  go: { label: "Go", icon: "🐹", ext: "go", exts: ["go"] },
  java: { label: "Java", icon: "☕", ext: "java", exts: ["java"] },
  csharp: { label: "C#", icon: "🟣", ext: "cs", exts: ["cs", "csx"] },
  cpp: { label: "C/C++", icon: "🛠️", ext: "cpp", exts: ["c", "h", "cpp", "hpp", "cc", "cxx"] },
  shell: { label: "Shell", icon: "🐚", ext: "sh", exts: ["sh", "bash", "zsh"] },
  powershell: { label: "PowerShell", icon: "🪟", ext: "ps1", exts: ["ps1", "psm1", "psd1"] },
  batch: { label: "Batch", icon: "🪟", ext: "bat", exts: ["bat", "cmd"] },
  sql: { label: "SQL", icon: "🗄️", ext: "sql", exts: ["sql"] },
  xml: { label: "XML", icon: "🏷️", ext: "xml", exts: ["xml", "xaml", "csproj", "vbproj", "props", "targets", "xsd", "xsl"] },
  svg: { label: "SVG", icon: "🖼️", ext: "svg", exts: ["svg"] },
  ruby: { label: "Ruby", icon: "💎", ext: "rb", exts: ["rb"] },
  php: { label: "PHP", icon: "🐘", ext: "php", exts: ["php"] },
  swift: { label: "Swift", icon: "🐦", ext: "swift", exts: ["swift"] },
  kotlin: { label: "Kotlin", icon: "🟠", ext: "kt", exts: ["kt", "kts"] },
  lua: { label: "Lua", icon: "🌙", ext: "lua", exts: ["lua"] },
  vue: { label: "Vue", icon: "💚", ext: "vue", exts: ["vue"] },
  svelte: { label: "Svelte", icon: "🧡", ext: "svelte", exts: ["svelte"] },
  graphql: { label: "GraphQL", icon: "🕸️", ext: "graphql", exts: ["graphql", "gql"] },
  table: { label: "Table", icon: "📊", ext: "csv", exts: ["csv", "tsv"] },
  log: { label: "Log", icon: "📜", ext: "log", exts: ["log"] },
  lock: { label: "Lock file", icon: "🔒", ext: "lock", exts: ["lock"] },
  solution: { label: "Solution", icon: "🧩", ext: "sln", exts: ["sln"] },
  docker: { label: "Dockerfile", icon: "🐳", ext: "dockerfile", exts: ["dockerfile"] },
  make: { label: "Makefile", icon: "🔨", ext: "mk", exts: ["mk"] },
  git: { label: "Git", icon: "🙈", ext: "gitignore", exts: ["gitignore", "gitattributes"] },
  text: { label: "Plain text", icon: "📄", ext: "txt", exts: ["txt", "text"] },
};

const BY_EXT = new Map<string, string>();
for (const [id, d] of Object.entries(DEFS)) for (const e of d.exts) BY_EXT.set(e, id);

/** Whole-name matches (lower case) for files that have no useful extension. */
const BY_NAME: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  readme: "text",
  license: "text",
  ".env": "config",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".editorconfig": "config",
};

const make = (id: string, filename: string): FileKind => ({ id, label: DEFS[id].label, icon: DEFS[id].icon, filename });

function sniff(content: string): string | null {
  const head = content.trimStart().slice(0, 400);
  if (!head) return null;
  const first = head.split(/\r?\n/, 1)[0];
  if (first.startsWith("#!")) {
    if (/python/.test(first)) return "python";
    if (/\b(node|deno|bun)\b/.test(first)) return "javascript";
    if (/pwsh|powershell/.test(first)) return "powershell";
    if (/\b(ba|z|da|k)?sh\b/.test(first)) return "shell";
    return null;
  }
  if (/^<\?xml/i.test(head)) return "xml";
  if (/^<\?php/i.test(head)) return "php";
  if (/^<!doctype html|^<html[\s>]/i.test(head)) return "html";
  if (head[0] === "{" || head[0] === "[") {
    try {
      JSON.parse(content);
      return "json";
    } catch {
      return null;
    }
  }
  return null;
}

export function detectKind(name: string, content?: string): FileKind {
  const base = (name.split(/[\\/]/).pop() ?? "").trim();
  const lower = base.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return make(byName, base);
  const dot = lower.lastIndexOf(".");
  const byExt = dot > 0 ? BY_EXT.get(lower.slice(dot + 1)) : undefined;
  if (byExt) return make(byExt, base);
  const sniffed = content ? sniff(content) : null;
  if (sniffed) return make(sniffed, `untitled.${DEFS[sniffed].ext}`);
  return make("text", base);
}
