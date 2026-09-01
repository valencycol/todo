import { html, raw } from "../lib/html";
import { houseIcon } from "../lib/icons";

export type NavPage = "create" | "active" | "completed";

export function topbar(active: NavPage): string {
  return html`
    <header class="topbar">
      <a href="/" class="brand-mark">
        ${raw(houseIcon(22))}
        <span>Colaco House</span>
      </a>
      <nav>
        <a href="/" class="${active === "create" ? "active" : ""}">New list</a>
        <a href="/dashboard" class="${active === "active" ? "active" : ""}">Active</a>
        <a href="/dashboard/completed" class="${active === "completed" ? "active" : ""}">Completed</a>
        <button type="button" class="nav-link-btn" id="nav-logout-btn">Log out</button>
      </nav>
    </header>
  `;
}

export function pageShell(title: string, bodyHtml: string, extraScripts: string[] = []): string {
  const scripts = extraScripts.map((src) => `<script src="${src}" defer></script>`).join("\n");
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,300..800;1,6..12,300..800&family=Varela+Round&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  ${raw(scripts)}
</head>
<body>
${raw(bodyHtml)}
</body>
</html>`;
}
