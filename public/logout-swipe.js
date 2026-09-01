/* Swipe-to-confirm logout, adapted from the "swipe to lock" pattern in the
   allie project: a stray tap on "Log out" should never actually sign you
   out mid-task — only a deliberate full-width swipe does. */
(function () {
  const trigger = document.getElementById("nav-logout-btn");
  if (!trigger) return;

  function openLogoutConfirm() {
    const overlay = document.createElement("div");
    overlay.className = "logout-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Log out");

    const panel = document.createElement("div");
    panel.className = "logout-panel";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "secondary logout-cancel";
    close.textContent = "Cancel";
    close.setAttribute("aria-label", "Cancel");

    const heading = document.createElement("h2");
    heading.textContent = "Log out?";

    const hint = document.createElement("p");
    hint.className = "lock-hint";
    hint.textContent = "Swipe all the way across to log out.";

    const track = document.createElement("div");
    track.className = "swipe-track";

    const label = document.createElement("span");
    label.className = "swipe-label";
    label.textContent = "Swipe to log out →";

    const fill = document.createElement("div");
    fill.className = "swipe-fill";

    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "swipe-thumb";
    thumb.setAttribute("aria-label", "Swipe to log out");
    thumb.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';

    track.append(fill, label, thumb);
    panel.append(close, heading, hint, track);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    close.focus();

    let dragging = false;
    let loggingOut = false;
    let x = 0;
    let originX = 0;
    let maxX = 0;

    function measure() {
      maxX = Math.max(0, track.clientWidth - thumb.offsetWidth - 8);
    }

    function setX(next) {
      x = Math.max(0, Math.min(maxX, next));
      thumb.style.transform = "translateX(" + x + "px)";
      fill.style.width = x + thumb.offsetWidth / 2 + "px";
      label.style.opacity = maxX ? String(Math.max(0, 1 - x / (maxX * 0.6))) : "1";
      return x;
    }

    async function doLogout() {
      try {
        await fetch("/logout", { method: "POST" });
      } finally {
        location.href = "/login";
      }
    }

    function pointerDown(e) {
      if (loggingOut) return;
      measure();
      dragging = true;
      thumb.classList.remove("snap");
      fill.classList.remove("snap");
      originX = e.clientX - x;
      thumb.setPointerCapture(e.pointerId);
    }

    function pointerMove(e) {
      if (!dragging || loggingOut) return;
      setX(e.clientX - originX);
      if (maxX && x >= maxX * 0.94) {
        loggingOut = true;
        dragging = false;
        setX(maxX);
        label.textContent = "Logging out…";
        doLogout();
      }
    }

    function pointerUp() {
      if (!dragging) return;
      dragging = false;
      if (!loggingOut) {
        thumb.classList.add("snap");
        fill.classList.add("snap");
        setX(0);
      }
    }

    thumb.addEventListener("pointerdown", pointerDown);
    thumb.addEventListener("pointermove", pointerMove);
    thumb.addEventListener("pointerup", pointerUp);
    thumb.addEventListener("pointercancel", pointerUp);

    requestAnimationFrame(measure);

    function dismiss() {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
    }
    function onKeydown(e) {
      if (e.key === "Escape") dismiss();
    }
    close.addEventListener("click", dismiss);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener("keydown", onKeydown);
  }

  trigger.addEventListener("click", openLogoutConfirm);
})();
