(function () {
  const grid = document.getElementById("pattern-grid");
  if (!grid) return;

  const dots = Array.from(grid.querySelectorAll(".pattern-dot"));
  const svg = document.getElementById("pattern-lines");
  const path = document.getElementById("pattern-path");
  const errorEl = document.getElementById("pattern-error");
  const clearBtn = document.getElementById("pattern-clear");
  const redirectTo = grid.dataset.redirect || "/";

  // Auto-submit happens either right when a real drag gesture is released,
  // or — for the tap/keyboard alternative, where every dot is its own brief
  // pointerdown+pointerup — after a short pause with no new dot added, since
  // there's no single "release" event that means "pattern finished" there.
  const TAP_SETTLE_MS = 500;

  let selected = [];
  let dragging = false;
  let dotsAddedThisPress = 0;
  let settleTimer = null;
  let submitting = false;

  function syncSvgSize() {
    const r = grid.getBoundingClientRect();
    svg.setAttribute("viewBox", "0 0 " + r.width + " " + r.height);
  }
  syncSvgSize();
  window.addEventListener("resize", syncSvgSize);

  function dotCenter(dot) {
    const r = dot.getBoundingClientRect();
    const gr = grid.getBoundingClientRect();
    return { x: r.left + r.width / 2 - gr.left, y: r.top + r.height / 2 - gr.top };
  }

  function clearError() {
    errorEl.style.visibility = "hidden";
    grid.classList.remove("pattern-error");
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.visibility = "visible";
  }

  function reset() {
    selected = [];
    dots.forEach((d) => d.classList.remove("active"));
    path.setAttribute("d", "");
  }

  function cancelAutoSubmit() {
    clearTimeout(settleTimer);
    settleTimer = null;
  }

  function scheduleAutoSubmit() {
    cancelAutoSubmit();
    settleTimer = setTimeout(attemptSubmit, TAP_SETTLE_MS);
  }

  function addDot(dot) {
    const idx = Number(dot.dataset.index);
    if (selected.includes(idx)) return;
    selected.push(idx);
    dot.classList.add("active");
    dotsAddedThisPress += 1;
    redraw();
    scheduleAutoSubmit();
  }

  function redraw(cursor) {
    if (selected.length === 0) {
      path.setAttribute("d", "");
      return;
    }
    let d = "";
    selected.forEach((idx, i) => {
      const c = dotCenter(dots[idx]);
      d += (i === 0 ? "M" : "L") + c.x + " " + c.y + " ";
    });
    if (cursor) d += "L" + cursor.x + " " + cursor.y;
    path.setAttribute("d", d.trim());
  }

  function pointFromEvent(e) {
    const gr = grid.getBoundingClientRect();
    return { x: e.clientX - gr.left, y: e.clientY - gr.top };
  }

  // Continuous drag: press on a dot, move across others, release.
  grid.addEventListener("pointerdown", (e) => {
    if (submitting) return;
    const dot = e.target.closest(".pattern-dot");
    if (!dot) return;
    clearError();
    dragging = true;
    dotsAddedThisPress = 0;
    addDot(dot);
    grid.setPointerCapture(e.pointerId);
  });

  grid.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dot = el && el.closest && el.closest(".pattern-dot");
    if (dot && grid.contains(dot)) addDot(dot);
    redraw(pointFromEvent(e));
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    redraw();
    // Pointer/touch interaction doesn't need to leave a dot holding real DOM
    // focus (only real keyboard Tab navigation does) — releasing it here
    // avoids the browser's native focus indicator on whichever dot the
    // pointer happened to end on, which CSS can't override since it isn't
    // drawn through outline/box-shadow.
    if (document.activeElement && document.activeElement.classList.contains("pattern-dot")) {
      document.activeElement.blur();
    }
    // More than one dot added in this single press means a real drag
    // gesture just finished — submit right away instead of waiting out the
    // tap-settle delay. A single dot could just as easily be one tap in an
    // ongoing tap sequence, so that case is left to the debounce below.
    if (dotsAddedThisPress > 1) {
      cancelAutoSubmit();
      attemptSubmit();
    }
    dotsAddedThisPress = 0;
  }

  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);

  // Single-pointer / keyboard alternative to dragging (WCAG 2.2 "Dragging
  // Movements"): tapping or Enter/Space-activating a dot on its own also
  // appends it, so the whole pattern can be built without ever dragging.
  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      if (submitting) return;
      clearError();
      addDot(dot);
    });
  });

  clearBtn.addEventListener("click", () => {
    cancelAutoSubmit();
    clearError();
    reset();
  });

  async function attemptSubmit() {
    cancelAutoSubmit();
    if (submitting) return;
    if (selected.length < 3) {
      showError("Draw at least 3 dots.");
      return;
    }

    submitting = true;
    clearBtn.disabled = true;
    grid.setAttribute("aria-busy", "true");

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: selected, redirect: redirectTo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Wrong pattern");
      location.href = data.redirect || "/";
    } catch (err) {
      showError(err.message || "Wrong pattern, try again.");
      grid.classList.add("pattern-error");
      setTimeout(() => {
        reset();
        clearError();
      }, 700);
      submitting = false;
      clearBtn.disabled = false;
      grid.removeAttribute("aria-busy");
    }
  }
})();
