/**
 * Small hand-authored outline icon set (Phosphor/Heroicons-style: 24x24,
 * stroke-based, currentColor) so the UI never relies on emoji glyphs for
 * meaningful state. Each returns raw, trusted SVG markup — safe to embed
 * with `raw()` since none of it is derived from user input.
 */
function icon(size: number, paths: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

export function houseIcon(size = 24): string {
  return icon(size, `<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v10a1 1 0 0 0 1 1H9v-6h6v6h2.5a1 1 0 0 0 1-1V9"/>`);
}

export function checkIcon(size = 20): string {
  return icon(size, `<path d="M4 12.5 9.5 18 20 6"/>`);
}

export function checkCircleIcon(size = 44): string {
  return icon(size, `<circle cx="12" cy="12" r="9"/><path d="M8 12.5 10.8 15.5 16 9.5"/>`);
}

export function xCircleIcon(size = 44): string {
  return icon(size, `<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>`);
}

export function xIcon(size = 20): string {
  return icon(size, `<path d="m6 6 12 12M18 6 6 18"/>`);
}

export function sendIcon(size = 20): string {
  return icon(size, `<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/><path d="M10 13.5 21 3"/>`);
}

export function refreshIcon(size = 18): string {
  return icon(
    size,
    `<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.5 4.5M20 20v-5h-5"/>`,
  );
}

export function searchIcon(size = 18): string {
  return icon(size, `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`);
}

export function alertIcon(size = 44): string {
  return icon(size, `<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.5" r="0.75" fill="currentColor" stroke="none"/>`);
}
