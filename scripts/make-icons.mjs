// Generates PNG and ICO files from the SVG sources in installer/.
// Usage: npm run icons   (needs devDependency @resvg/resvg-js)
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const full = readFileSync(join(root, "installer", "icon.svg"), "utf8");
const small = readFileSync(join(root, "installer", "icon-small.svg"), "utf8");

function render(svg, size) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: size }, background: "rgba(0,0,0,0)" });
  const img = r.render();
  return { size, png: img.asPng(), rgba: img.pixels };
}

// Small sizes use the simplified artwork so they stay readable.
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const frames = SIZES.map((s) => render(s <= 32 ? small : full, s));

// BMP-encoded ICO frame (best compatibility for small sizes).
function bmpFrame({ size, rgba }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND mask height
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4; // bottom-up
      const dst = (y * size + x) * 4;
      xor[dst] = rgba[src + 2];
      xor[dst + 1] = rgba[src + 1];
      xor[dst + 2] = rgba[src];
      xor[dst + 3] = rgba[src + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size); // all zero: alpha channel does the work
  return Buffer.concat([header, xor, and]);
}

function buildIco(list) {
  const entries = list.map((f) => ({ size: f.size, data: f.size >= 128 ? f.png : bmpFrame(f) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = entries.map((e) => {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.data.length;
    return d;
  });
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.data)]);
}

const ico = buildIco(frames);
const icons = join(root, "src-tauri", "icons");
mkdirSync(icons, { recursive: true });
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(icons, "icon.ico"), ico);
writeFileSync(join(root, "installer", "tinkerdeck.ico"), ico);
writeFileSync(join(icons, "32x32.png"), render(small, 32).png);
writeFileSync(join(icons, "128x128.png"), render(full, 128).png);
writeFileSync(join(icons, "128x128@2x.png"), render(full, 256).png);
writeFileSync(join(icons, "icon.png"), render(full, 512).png);
writeFileSync(join(root, "installer", "icon-preview.png"), render(full, 512).png);
writeFileSync(join(root, "public", "icon.svg"), small); // the header shows it at 24 px
console.log(`icons written (${ico.length} bytes ico, ${frames.length} sizes)`);
