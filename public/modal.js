// Tiny reusable modal dialog, generalized from the swipe-to-logout overlay
// pattern (role="dialog", focus-on-open, Escape/backdrop-click to dismiss).
// Callers build their own content via `render(modal)` and add buttons with
// AppModal.addButton — this file only owns the shell.
(function () {
  function openModal(opts) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    if (opts.title) overlay.setAttribute("aria-label", opts.title);

    const panel = document.createElement("div");
    panel.className = "modal-panel";

    const heading = document.createElement("h2");
    heading.textContent = opts.title || "";

    const body = document.createElement("div");
    body.className = "modal-body";

    const actionsBar = document.createElement("div");
    actionsBar.className = "modal-actions";

    panel.append(heading, body, actionsBar);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let dismissed = false;
    function close() {
      if (dismissed) return;
      dismissed = true;
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      // Fires for every dismissal path (a button's own onClick, Escape, or
      // a backdrop click) — not just an explicit "confirm" button — so
      // callers can react to the modal going away however that happened.
      if (typeof opts.onClose === "function") opts.onClose();
    }
    function onKeydown(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeydown);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const modal = { overlay, panel, body, actionsBar, close };

    if (typeof opts.render === "function") opts.render(modal);

    requestAnimationFrame(() => {
      const target = body.querySelector("textarea, input, select") || panel.querySelector("button");
      if (target) target.focus();
    });

    return modal;
  }

  function addButton(container, { label, variant, onClick }) {
    const btn = document.createElement("button");
    btn.type = "button";
    if (variant) btn.className = variant;
    btn.textContent = label;
    if (onClick) btn.addEventListener("click", onClick);
    container.appendChild(btn);
    return btn;
  }

  window.AppModal = { open: openModal, addButton };
})();
