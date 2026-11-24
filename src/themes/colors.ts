// Small colour helpers for translating themes.

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const hex2 = (s: string) => parseInt(s, 16);

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`; anything else is null. */
export function parseColor(input: string): RGBA | null {
  const s = (input ?? "").trim();
  let m = /^#([0-9a-f]{3,4})$/i.exec(s);
  if (m) {
    const h = m[1];
    const [r, g, b, a] = [...h].map((c) => hex2(c + c));
    return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
  }
  m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (m) {
    const h = m[1];
    return { r: hex2(h.slice(0, 2)), g: hex2(h.slice(2, 4)), b: hex2(h.slice(4, 6)), a: h.length === 8 ? hex2(h.slice(6, 8)) / 255 : 1 };
  }
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const h2 = (n: number) => byte(n).toString(16).padStart(2, "0");

export const toHex = (c: RGBA): string => `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;

/** Flatten a colour that may be translucent over the colour behind it, giving an opaque `#rrggbb`. */
export function solid(color: string, over: string): string {
  const c = parseColor(color);
  const o = parseColor(over);
  if (!o) return c ? toHex(c) : "#000000";
  if (!c) return toHex(o);
  const a = c.a;
  return toHex({ r: c.r * a + o.r * (1 - a), g: c.g * a + o.g * (1 - a), b: c.b * a + o.b * (1 - a), a: 1 });
}

export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a) ?? { r: 0, g: 0, b: 0, a: 1 };
  const y = parseColor(b) ?? x;
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t, a: 1 });
}

/** Relative luminance (WCAG), 0 black to 1 white. */
export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0;
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Dark or white text, whichever reads better on `bg`. */
export function readableOn(bg: string, dark = "#14110a", light = "#ffffff"): string {
  return contrast(dark, bg) >= contrast(light, bg) ? dark : light;
}
