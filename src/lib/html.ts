const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch);
}

type HtmlValue = string | number | false | null | undefined | HtmlValue[];

function stringifyValue(value: HtmlValue): string {
  if (Array.isArray(value)) return value.map(stringifyValue).join("");
  if (value === false || value === null || value === undefined) return "";
  return String(value);
}

/**
 * Tagged template: interpolated values are HTML-escaped by default.
 * Wrap a value in `raw()` to bypass escaping for pre-built trusted markup.
 */
export function html(strings: TemplateStringsArray, ...values: (HtmlValue | RawHtml)[]): string {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    out += value instanceof RawHtml ? value.value : escapeHtml(stringifyValue(value as HtmlValue));
    out += strings[i + 1] ?? "";
  }
  return out;
}

class RawHtml {
  constructor(public value: string) {}
}

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}
