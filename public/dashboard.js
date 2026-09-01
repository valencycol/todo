(function () {
  const dateFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const mainEl = document.querySelector("main");
  const pageMode = mainEl ? mainEl.dataset.pageMode : "active";
  const PAGE_SIZE = 2;

  const ENABLE_SUPERUSER_RE = /^enable superuser password (.+)$/i;
  const DISABLE_SUPERUSER_RE = /^disable superuser$/i;

  const PENCIL_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const TRASH_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

  let superuserActive = false;
  let activeItems = [];
  let completedOffset = 0;
  let completedHasMore = false;
  let completedItems = [];

  function fmt(ms) {
    return dateFmt.format(new Date(ms));
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function statusPill(task) {
    if (task.status === "rejected") return '<span class="status-pill rejected">Rejected</span>';
    if (task.status === "done") return '<span class="status-pill done">Done</span>';
    return '<span class="status-pill pending">Pending</span>';
  }

  // Wraps the first case-insensitive match of `query` inside `text` in
  // <mark>, escaping everything else normally so search hits are easy to
  // spot at a glance among a card's other tasks.
  function highlight(text, query) {
    const str = String(text ?? "");
    if (!query) return esc(str);
    const idx = str.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return esc(str);
    const before = str.slice(0, idx);
    const match = str.slice(idx, idx + query.length);
    const after = str.slice(idx + query.length);
    return esc(before) + "<mark>" + esc(match) + "</mark>" + esc(after);
  }

  function matchesQuery(task, query) {
    if (!query) return false;
    const q = query.toLowerCase();
    return (task.label && task.label.toLowerCase().includes(q)) || (task.remarks && task.remarks.toLowerCase().includes(q));
  }

  function findTaskById(taskId) {
    const source = pageMode === "active" ? activeItems : completedItems;
    for (const list of source) {
      const found = list.tasks.find((t) => t.id === taskId);
      if (found) return found;
    }
    return null;
  }

  function renderTask(task, query) {
    const remark = task.remarks ? '<div class="remark">"' + highlight(task.remarks, query) + '"</div>' : "";
    const rowClass = matchesQuery(task, query) ? "task-row search-hit" : "task-row";
    const adminControls = superuserActive
      ? '<div class="task-admin-controls">' +
        '<button type="button" class="icon-btn task-edit-btn" data-task-id="' +
        esc(task.id) +
        '" aria-label="Edit task">' +
        PENCIL_SVG +
        "</button>" +
        '<button type="button" class="icon-btn task-delete-btn" data-task-id="' +
        esc(task.id) +
        '" aria-label="Delete task">' +
        TRASH_SVG +
        "</button>" +
        "</div>"
      : "";
    return (
      '<div class="' +
      rowClass +
      '" data-task-id="' +
      esc(task.id) +
      '"><div><div class="label">' +
      highlight(task.label, query) +
      "</div>" +
      remark +
      "</div>" +
      '<div class="task-row-end">' +
      statusPill(task) +
      adminControls +
      "</div>" +
      "</div>"
    );
  }

  function renderTaskEditForm(task) {
    return (
      '<div class="task-row task-editing" data-task-id="' +
      esc(task.id) +
      '">' +
      '<div class="task-edit-form">' +
      '<input type="text" class="edit-label" value="' +
      esc(task.label) +
      '" placeholder="Label" />' +
      '<textarea class="edit-remarks" placeholder="Remarks">' +
      esc(task.remarks || "") +
      "</textarea>" +
      '<select class="edit-status">' +
      ["pending", "done", "rejected"]
        .map(function (s) {
          return '<option value="' + s + '"' + (task.status === s ? " selected" : "") + ">" + s + "</option>";
        })
        .join("") +
      "</select>" +
      '<div class="task-edit-actions">' +
      '<button type="button" class="secondary task-cancel-btn" data-task-id="' +
      esc(task.id) +
      '">Cancel</button>' +
      '<button type="button" class="task-save-btn" data-task-id="' +
      esc(task.id) +
      '">Save</button>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function renderActiveList(list) {
    const rows = list.tasks.map((t) => renderTask(t, "")).join("");
    return (
      '<div class="card list-card">' +
      '<div class="meta list-card-head">' +
      "<span>Requested " +
      fmt(list.created_at) +
      " · For " +
      esc(list.assigneeName) +
      "</span>" +
      '<button type="button" class="secondary resend-btn" data-list-id="' +
      esc(list.id) +
      '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.5 4.5M20 20v-5h-5"/></svg><span>Resend email</span></button>' +
      "</div>" +
      rows +
      "</div>"
    );
  }

  function renderCompletedList(list, query) {
    const rows = list.tasks.map((t) => renderTask(t, query)).join("");
    return (
      '<div class="card list-card">' +
      '<div class="meta">Requested ' +
      fmt(list.created_at) +
      " · Completed " +
      fmt(list.completed_at) +
      " · For " +
      esc(list.assigneeName) +
      "</div>" +
      rows +
      "</div>"
    );
  }

  function renderActiveFromCache() {
    const activeEl = document.getElementById("active-lists");
    if (!activeEl) return;
    activeEl.innerHTML = activeItems.length
      ? activeItems.map(renderActiveList).join("")
      : '<p class="empty-state">No active lists right now.</p>';
  }

  function renderCompletedFromCache() {
    const completedEl = document.getElementById("completed-lists");
    if (!completedEl) return;
    const searchInput = document.getElementById("completed-search");
    const query = searchInput ? searchInput.value.trim() : "";
    completedEl.innerHTML = completedItems.length
      ? completedItems.map((l) => renderCompletedList(l, query)).join("")
      : '<p class="empty-state">' + (query ? "No past tasks match your search." : "Nothing completed yet.") + "</p>";
  }

  async function refreshActive() {
    const activeEl = document.getElementById("active-lists");
    if (!activeEl) return;
    const res = await fetch("/api/lists/active");
    if (!res.ok) return;
    const data = await res.json();
    activeItems = data.active;
    renderActiveFromCache();
  }

  async function loadCompleted(opts) {
    const reset = !opts || opts.reset !== false;
    const completedEl = document.getElementById("completed-lists");
    const loadMoreBtn = document.getElementById("load-more-btn");
    if (!completedEl) return;

    if (reset) {
      completedOffset = 0;
      completedItems = [];
    }

    const searchInput = document.getElementById("completed-search");
    const query = searchInput ? searchInput.value.trim() : "";

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(completedOffset) });
    if (query) params.set("q", query);

    const res = await fetch("/api/lists/completed?" + params.toString());
    if (!res.ok) return;
    const data = await res.json();

    completedItems = reset ? data.completed : completedItems.concat(data.completed);
    completedOffset = completedItems.length;
    completedHasMore = data.hasMore;

    renderCompletedFromCache();
    if (loadMoreBtn) loadMoreBtn.hidden = !completedHasMore;
  }

  // Re-fetches exactly the depth already on screen (not just page 1, and
  // not appending another page) and replaces it in place — used after an
  // edit/delete or a live broadcast, where we want what's currently shown
  // to reflect the latest data without resetting the user's scroll depth
  // or duplicating a page onto the end.
  async function reloadCompletedInPlace() {
    const completedEl = document.getElementById("completed-lists");
    const loadMoreBtn = document.getElementById("load-more-btn");
    if (!completedEl) return;

    const searchInput = document.getElementById("completed-search");
    const query = searchInput ? searchInput.value.trim() : "";
    const currentCount = Math.max(completedItems.length, PAGE_SIZE);

    const params = new URLSearchParams({ limit: String(currentCount), offset: "0" });
    if (query) params.set("q", query);

    const res = await fetch("/api/lists/completed?" + params.toString());
    if (!res.ok) return;
    const data = await res.json();

    completedItems = data.completed;
    completedOffset = completedItems.length;
    completedHasMore = data.hasMore;

    renderCompletedFromCache();
    if (loadMoreBtn) loadMoreBtn.hidden = !completedHasMore;
  }

  function refreshCurrentPage() {
    if (pageMode === "active") refreshActive();
    else reloadCompletedInPlace();
  }

  function setConnStatus(connected) {
    const el = document.getElementById("conn-status");
    if (!el) return;
    el.innerHTML = connected
      ? '<span class="pulse-dot"></span> Live'
      : '<span class="pulse-dot" style="background:#d1d5db;animation:none;"></span> Reconnecting…';
  }

  function updateSuperuserBadge() {
    const badge = document.getElementById("superuser-badge");
    if (badge) badge.hidden = !superuserActive;
  }

  async function fetchSuperuserStatus() {
    try {
      const res = await fetch("/api/superuser");
      const data = await res.json();
      superuserActive = !!data.active;
    } catch (err) {
      superuserActive = false;
    }
    updateSuperuserBadge();
  }

  async function setSuperuser(enable, password) {
    let error = null;
    try {
      const res = await fetch("/api/superuser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enable ? { action: "enable", password: password } : { action: "disable" }),
      });
      const data = await res.json().catch(() => ({}));
      superuserActive = !!data.active;
      if (!res.ok) error = data.error || "Something went wrong.";
    } catch (err) {
      error = "Couldn't reach the server.";
    }
    updateSuperuserBadge();
    if (pageMode === "active") renderActiveFromCache();
    else renderCompletedFromCache();
    return { ok: !error, error: error };
  }

  function wireResendButtons() {
    const activeEl = document.getElementById("active-lists");
    if (!activeEl) return;

    activeEl.addEventListener("click", async (e) => {
      const btn = e.target.closest(".resend-btn");
      if (!btn) return;

      const listId = btn.dataset.listId;
      const label = btn.querySelector("span");
      const original = label.textContent;
      btn.disabled = true;
      label.textContent = "Sending…";

      try {
        const res = await fetch("/api/lists/" + encodeURIComponent(listId) + "/resend", { method: "POST" });
        if (!res.ok) throw new Error("resend failed");
        label.textContent = "Sent";
      } catch (err) {
        label.textContent = "Couldn't send";
      } finally {
        setTimeout(() => {
          label.textContent = original;
          btn.disabled = false;
        }, 2500);
      }
    });
  }

  // Shared by both #active-lists and #completed-lists: edit/save/cancel/delete
  // for individual tasks, only ever reachable once superuser mode is active
  // (the buttons themselves don't render otherwise).
  function wireTaskAdminControls(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener("click", async (e) => {
      const editBtn = e.target.closest(".task-edit-btn");
      const deleteBtn = e.target.closest(".task-delete-btn");
      const saveBtn = e.target.closest(".task-save-btn");
      const cancelBtn = e.target.closest(".task-cancel-btn");

      if (editBtn) {
        const task = findTaskById(editBtn.dataset.taskId);
        const row = container.querySelector('.task-row[data-task-id="' + editBtn.dataset.taskId + '"]');
        if (task && row) row.outerHTML = renderTaskEditForm(task);
        return;
      }

      if (cancelBtn) {
        if (pageMode === "active") renderActiveFromCache();
        else renderCompletedFromCache();
        return;
      }

      if (saveBtn) {
        const taskId = saveBtn.dataset.taskId;
        const form = saveBtn.closest(".task-edit-form");
        const label = form.querySelector(".edit-label").value.trim();
        const remarks = form.querySelector(".edit-remarks").value.trim();
        const status = form.querySelector(".edit-status").value;
        saveBtn.disabled = true;
        try {
          const res = await fetch("/api/tasks/" + encodeURIComponent(taskId), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: label, remarks: remarks || null, status: status }),
          });
          if (!res.ok) throw new Error("save failed");
          refreshCurrentPage();
        } catch (err) {
          saveBtn.disabled = false;
        }
        return;
      }

      if (deleteBtn) {
        if (!confirm("Delete this task permanently? This can't be undone.")) return;
        deleteBtn.disabled = true;
        try {
          const res = await fetch("/api/tasks/" + encodeURIComponent(deleteBtn.dataset.taskId), { method: "DELETE" });
          if (!res.ok) throw new Error("delete failed");
          refreshCurrentPage();
        } catch (err) {
          deleteBtn.disabled = false;
        }
      }
    });
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  let commandFeedbackTimer = null;

  function showCommandFeedback(message, isError) {
    const el = document.getElementById("search-command-feedback");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "var(--color-destructive)" : "var(--color-secondary)";
    el.style.display = "block";
    clearTimeout(commandFeedbackTimer);
    commandFeedbackTimer = setTimeout(() => {
      el.style.display = "none";
    }, 3000);
  }

  function wireCompletedControls() {
    const searchInput = document.getElementById("completed-search");
    const loadMoreBtn = document.getElementById("load-more-btn");
    if (!searchInput) return;

    const debouncedHandle = debounce(async () => {
      const raw = searchInput.value.trim();

      const enableMatch = raw.match(ENABLE_SUPERUSER_RE);
      if (enableMatch) {
        const result = await setSuperuser(true, enableMatch[1]);
        searchInput.value = "";
        showCommandFeedback(result.ok ? "Superuser mode enabled." : result.error, !result.ok);
        loadCompleted({ reset: true });
        return;
      }

      if (DISABLE_SUPERUSER_RE.test(raw)) {
        const result = await setSuperuser(false);
        searchInput.value = "";
        showCommandFeedback(result.ok ? "Superuser mode disabled." : result.error, !result.ok);
        loadCompleted({ reset: true });
        return;
      }

      loadCompleted({ reset: true });
    }, 300);

    searchInput.addEventListener("input", debouncedHandle);

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", () => loadCompleted({ reset: false }));
    }
  }

  function connectSocket() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/ws");

    ws.addEventListener("open", () => setConnStatus(true));
    ws.addEventListener("message", () => refreshCurrentPage());
    ws.addEventListener("close", () => {
      setConnStatus(false);
      setTimeout(connectSocket, 2000);
    });
    ws.addEventListener("error", () => ws.close());
  }

  fetchSuperuserStatus();

  if (pageMode === "active") {
    wireResendButtons();
    wireTaskAdminControls("active-lists");
    refreshActive();
  } else {
    wireCompletedControls();
    wireTaskAdminControls("completed-lists");
    loadCompleted({ reset: true });
  }
  connectSocket();
})();
