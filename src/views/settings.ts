import { html, raw } from "../lib/html";
import { pageShell, topbar } from "./layout";

export function settingsPage(): string {
  const body = html`
    ${raw(topbar("settings"))}
    <main data-page-mode="settings">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Where to-do lists get delivered, and when to chase them up.</p>

      <div class="card">
        <h3>Telegram</h3>
        <div id="tg-status"><p class="empty-state">Loading…</p></div>
      </div>

      <div class="card">
        <h3>People</h3>
        <p class="meta">
          A Telegram bot can't message someone first — add their @username or phone number here,
          then send them the invite link. Once they tap <strong>Start</strong>, their tasks arrive
          in Telegram with Done and Reject buttons.
        </p>
        <div id="tg-people"><p class="empty-state">Loading…</p></div>
      </div>

      <div class="card">
        <h3>Overdue nudges</h3>
        <div id="tg-nudges"><p class="empty-state">Loading…</p></div>
      </div>
    </main>
  `;
  return pageShell("Settings — Colaco House To-Do List", body, ["/modal.js", "/settings.js", "/logout-swipe.js"]);
}
