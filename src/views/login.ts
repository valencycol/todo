import { html, raw } from "../lib/html";
import { pageShell } from "./layout";

export function loginPage(opts: { redirectTo?: string } = {}): string {
  const dots = Array.from({ length: 9 }, (_, i) => i)
    .map(
      (i) => html`
        <button type="button" class="pattern-dot" data-index="${i}" aria-label="Pattern dot ${i + 1}">
          <span class="pattern-dot-inner"></span>
        </button>
      `,
    )
    .join("");

  const body = html`
    <div class="lock-wrap">
      <div class="lock-card">
        <div class="brand">
          <h1>Colaco House</h1>
        </div>
        <p class="lock-subtitle">To-Do List</p>
        <p class="lock-hint">Draw your pattern to continue</p>

        <div class="pattern-grid" id="pattern-grid" data-redirect="${opts.redirectTo ?? "/"}">
          <svg id="pattern-lines" class="pattern-lines" preserveAspectRatio="none">
            <path id="pattern-path"></path>
          </svg>
          ${raw(dots)}
        </div>

        <p id="pattern-error" class="error-text" role="alert" style="visibility:hidden;">Wrong pattern, try again.</p>
      </div>
    </div>
  `;
  return pageShell("Colaco House To-Do List", body, ["/pattern-lock.js"]);
}
