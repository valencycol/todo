import { html, raw } from "../lib/html";
import { pageShell, topbar } from "./layout";
import { searchIcon } from "../lib/icons";

export function activeListsPage(): string {
  const body = html`
    ${raw(topbar("active"))}
    <main data-page-mode="active">
      <div class="conn-status" style="margin-bottom:14px;">
        <span id="conn-status"><span class="pulse-dot"></span> Live</span>
        <span id="superuser-badge" class="superuser-badge" hidden>Superuser mode</span>
      </div>

      <div class="card">
        <h3>Active lists</h3>
        <div id="active-lists"><p class="empty-state">Loading…</p></div>
      </div>
    </main>
  `;
  return pageShell("Active lists — Colaco House To-Do List", body, ["/modal.js", "/dashboard.js", "/logout-swipe.js"]);
}

export function completedListsPage(): string {
  const body = html`
    ${raw(topbar("completed"))}
    <main data-page-mode="completed">
      <div class="conn-status" style="margin-bottom:14px;">
        <span id="conn-status"><span class="pulse-dot"></span> Live</span>
        <span id="superuser-badge" class="superuser-badge" hidden>Superuser mode</span>
      </div>

      <div class="card">
        <h3>Completed lists</h3>
        <form id="completed-search-form" class="search-row">
          <div class="search-field">
            ${raw(searchIcon(16))}
            <input type="text" id="completed-search" placeholder="Search past tasks…" />
          </div>
          <button type="submit" class="secondary">Go</button>
        </form>
        <p id="search-command-feedback" class="error-text" style="display:none;margin-top:-8px;margin-bottom:12px;"></p>
        <div id="completed-lists"><p class="empty-state">Loading…</p></div>
        <button type="button" class="secondary" id="load-more-btn" hidden style="width:100%;margin-top:12px;">Load more</button>
      </div>
    </main>
  `;
  return pageShell("Completed lists — Colaco House To-Do List", body, ["/modal.js", "/dashboard.js", "/logout-swipe.js"]);
}
