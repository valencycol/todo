import { html, raw } from "../lib/html";
import { ROOMS, SIMPLE_TASKS, STORE_SUGGESTIONS } from "../lib/catalog";
import { pageShell, topbar } from "./layout";
import { sendIcon } from "../lib/icons";
import type { Assignee } from "../lib/assignees";

function roomDisplayName(label: string): string {
  return label.replace(/^the /, "").replace(/^\w/, (c) => c.toUpperCase());
}

export function createListPage(assignees: Assignee[]): string {
  const assigneeOptions = assignees
    .map(
      (a, i) => html`
        <label class="assignee-option ${a.enabled ? "" : "disabled"}">
          <input type="radio" name="assignee" value="${a.key}" ${i === 0 ? "checked" : ""} ${a.enabled ? "" : "disabled"} />
          <span>${a.name}</span>
          <span class="assignee-note">${a.enabled ? a.email : "not set up yet"}</span>
        </label>
      `,
    )
    .join("");

  const roomRows = ROOMS.map(
    (room) => html`
      <div class="room-row">
        <div class="room-row-top">
          <span class="room-name">${roomDisplayName(room.label)}</span>
          <label class="checkbox-pill">
            <input type="checkbox" data-room="${room.key}" data-mode="clean" /> Clean
          </label>
        </div>
        <input type="text" class="spot-clean-input" data-room="${room.key}" placeholder="Spot clean (optional) — e.g. the stovetop" />
      </div>
    `,
  ).join("");

  const simpleRows = SIMPLE_TASKS.map(
    (task) => html`
      <label class="chore-item" for="task-${task.type}">
        <input type="checkbox" id="task-${task.type}" data-simple="${task.type}" />
        <span>${task.label}</span>
      </label>
    `,
  ).join("");

  const storeOptionTags = STORE_SUGGESTIONS.map((s) => html`<option value="${s}">${s}</option>`).join("");

  const body = html`
    ${raw(topbar("create"))}
    <main>
      <h2 class="page-title">Build a list for the house</h2>
      <p class="page-subtitle">Pick everything that needs doing — each item becomes its own task with its own link.</p>

      <form id="list-form">
        <div class="card">
          <h3>Send to</h3>
          <div class="assignee-picker">${raw(assigneeOptions)}</div>
        </div>

        <div class="card">
          <h3>Cleaning</h3>
          <div class="room-list">${raw(roomRows)}</div>
        </div>

        <div class="card">
          <h3>Chores</h3>
          <div class="chore-grid">${raw(simpleRows)}</div>
        </div>

        <div class="card">
          <h3>Supermarket</h3>
          <input type="text" id="supermarket-text" placeholder="e.g. milk, eggs, bread" />
        </div>

        <div class="card">
          <h3>Other stores</h3>
          <div id="store-rows">
            <div class="store-row">
              <select class="store-select">
                <option value="">Choose a store…</option>
                ${raw(storeOptionTags)}
                <option value="__other__">Other…</option>
              </select>
              <input type="text" class="store-custom" placeholder="Store name" hidden />
              <input type="text" class="store-items" placeholder="Items" />
            </div>
          </div>
          <button type="button" class="secondary add-store-btn" id="add-store-row">+ Add another store</button>
        </div>

        <div class="card">
          <h3>Anything else</h3>
          <textarea id="general-text" placeholder="Free text — anything not covered above"></textarea>
        </div>

        <div id="form-error" class="error-text" style="display:none;"></div>

        <button type="submit" id="send-btn" class="btn-icon" style="width:100%;" disabled>
          ${raw(sendIcon(18))}
          <span>Send</span>
        </button>
      </form>
    </main>
  `;

  return pageShell("New list — Colaco House To-Do List", body, ["/create.js", "/logout-swipe.js"]);
}
