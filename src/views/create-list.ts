import { html, raw } from "../lib/html";
import { ROOMS, ROOM_ACTIONS, SIMPLE_TASKS, STORE_SUGGESTIONS, roomDisplayName } from "../lib/catalog";
import { pageShell, topbar } from "./layout";
import { plusIcon, sendIcon } from "../lib/icons";
import type { Assignee } from "../lib/assignees";

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

  const roomActionOptionTags = ROOM_ACTIONS.map((a) => html`<option value="${a.key}">${a.label}</option>`).join("");

  const roomRows = ROOMS.map(
    (room) => html`
      <div class="room-row">
        <span class="room-name">${roomDisplayName(room.label)}</span>
        <select class="room-action-select" data-room="${room.key}">
          <option value="">No action</option>
          ${raw(roomActionOptionTags)}
        </select>
        <button
          type="button"
          class="room-notes-btn"
          data-room="${room.key}"
          disabled
          aria-label="More instructions for ${roomDisplayName(room.label)}"
        >
          ${raw(plusIcon(16))}
        </button>
        <input type="hidden" class="room-notes-value" data-room="${room.key}" />
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
          <h3>Shopping list</h3>
          <div id="shopping-rows">
            <div class="shopping-row">
              <input type="text" class="shopping-item" placeholder="e.g. milk" />
              <input type="text" class="shopping-qty" placeholder="Qty" />
            </div>
          </div>
          <button type="button" class="secondary add-row-btn" id="add-shopping-row">+ Add another item</button>
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
          <button type="button" class="secondary add-row-btn" id="add-store-row">+ Add another store</button>
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

  return pageShell("New list — Colaco House To-Do List", body, ["/modal.js", "/create.js", "/logout-swipe.js"]);
}
