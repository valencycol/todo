import { html, raw } from "../lib/html";
import { pageShell, topbar } from "./layout";
import { searchIcon } from "../lib/icons";

export function activeListsPage(): string {
  const body = html`
    ${raw(topbar("active"))}
    <main data-page-mode="active">
      <div class="conn-status" id="conn-status" style="margin-bottom:14px;">
        <span class="pulse-dot"></span> Live
      </div>

      <div class="card">
        <h3>Active lists</h3>
        <div id="active-lists"><p class="empty-state">Loading…</p></div>
      </div>
    </main>
  `;
  return pageShell("Active lists — Colaco House To-Do List", body, ["/dashboard.js", "/logout-swipe.js"]);
}

export function completedListsPage(): string {
  const body = html`
    ${raw(topbar("completed"))}
    <main data-page-mode="completed">
      <div class="conn-status" id="conn-status" style="margin-bottom:14px;">
        <span class="pulse-dot"></span> Live
      </div>

      <div class="card">
        <h3>Completed lists</h3>
        <div class="search-field">
          ${raw(searchIcon(16))}
          <input type="text" id="completed-search" placeholder="Search past tasks…" />
        </div>
        <div id="completed-lists"><p class="empty-state">Loading…</p></div>
        <button type="button" class="secondary" id="load-more-btn" hidden style="width:100%;margin-top:12px;">Load more</button>
      </div>
    </main>
  `;
  return pageShell("Completed lists — Colaco House To-Do List", body, ["/dashboard.js", "/logout-swipe.js"]);
}
