import { html, raw } from "../lib/html";
import { houseIcon } from "../lib/icons";

export type NavPage = "create" | "active" | "completed";

/**
 * Bump this on every change to a file under /public. Static assets are
 * served with `must-revalidate`, which should stop staleness on its own,
 * but some browsers/paths (bfcache, flaky proxies) skip revalidation
 * anyway — appending a version query string forces a genuinely new cache
 * key so an old cached script can never silently keep calling a route
 * that a later deploy removed.
 */
const ASSET_VERSION = "10";

export function topbar(active: NavPage): string {
  return html`
    <header class="topbar">
      <a href="/" class="brand-mark ${active === "create" ? "active" : ""}">
        ${raw(houseIcon(22))}
        <span>Colaco House</span>
      </a>
      <nav>
        <a href="/dashboard" class="${active === "active" ? "active" : ""}">Active</a>
        <a href="/dashboard/completed" class="${active === "completed" ? "active" : ""}">Completed</a>
        <button type="button" class="nav-link-btn" id="nav-logout-btn">Log out</button>
      </nav>
    </header>
  `;
}

export function pageShell(title: string, bodyHtml: string, extraScripts: string[] = []): string {
  const scripts = extraScripts.map((src) => `<script src="${src}?v=${ASSET_VERSION}" defer></script>`).join("\n");
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Calistoga&family=Inter:ital,opsz,wght@0,14..32,300..800;1,14..32,300..800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css?v=${ASSET_VERSION}" />
  ${raw(scripts)}
</head>
<body>
${raw(bodyHtml)}
</body>
</html>`;
}
