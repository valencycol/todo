import { html, raw } from "../lib/html";
import { pageShell } from "./layout";
import { formatDate } from "../lib/date";
import { checkIcon, xIcon, alertIcon } from "../lib/icons";
import type { TaskRow } from "../lib/db";

export function taskLinkPage(task: TaskRow): string {
  const body = html`
    <div class="login-wrap">
      <div class="card login-card" style="max-width:420px;">
        <h2>${task.label}</h2>
        <p class="meta">Requested ${formatDate(task.created_at)}</p>
        <form id="complete-form">
          <textarea id="remarks" placeholder="Remarks (optional)"></textarea>
          <div id="form-error" class="error-text" style="display:none;"></div>
          <div class="task-actions">
            <button type="submit" data-outcome="done" class="btn-icon">${raw(checkIcon(16))}<span>Mark complete</span></button>
            <button type="submit" data-outcome="rejected" class="secondary destructive btn-icon">${raw(xIcon(16))}<span>Reject</span></button>
          </div>
        </form>
      </div>
    </div>
    <script>
      document.getElementById("complete-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        var outcome = (e.submitter && e.submitter.dataset.outcome) || "done";
        var buttons = e.target.querySelectorAll("button");
        var err = document.getElementById("form-error");
        buttons.forEach(function (b) {
          b.disabled = true;
          b.setAttribute("aria-busy", "true");
        });
        try {
          var res = await fetch(location.pathname + "/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outcome: outcome, remarks: document.getElementById("remarks").value }),
          });
          if (!res.ok) throw new Error("failed");
          document.querySelector(".login-card").innerHTML =
            outcome === "rejected"
              ? '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="confirm-icon rejected" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg><h2>Rejected</h2><p class="meta">Got it — this task has been marked as rejected.</p>'
              : '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="confirm-icon" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5 10.8 15.5 16 9.5"/></svg><h2>Done</h2><p class="meta">Thanks — this task is marked complete.</p>';
        } catch (e2) {
          err.textContent = "Couldn't save that. Please try again.";
          err.style.display = "block";
          buttons.forEach(function (b) {
            b.disabled = false;
            b.removeAttribute("aria-busy");
          });
        }
      });
    </script>
  `;
  return pageShell(`${task.label} — Colaco House To-Do List`, body);
}

export function taskLinkInvalidPage(): string {
  const body = html`
    <div class="login-wrap">
      <div class="card login-card" style="max-width:420px;text-align:center;">
        <div class="confirm-icon rejected" style="margin:0 auto 8px;">${raw(alertIcon(44))}</div>
        <h2>Link no longer valid</h2>
        <p class="meta">This task has already been completed, or the link has expired.</p>
      </div>
    </div>
  `;
  return pageShell("Link expired — Colaco House To-Do List", body);
}
