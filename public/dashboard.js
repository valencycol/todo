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

  function renderTask(task, query) {
    const remark = task.remarks ? '<div class="remark">"' + highlight(task.remarks, query) + '"</div>' : "";
    const rowClass = matchesQuery(task, query) ? "task-row search-hit" : "task-row";
    return (
      '<div class="' +
      rowClass +
      '"><div><div class="label">' +
      highlight(task.label, query) +
      "</div>" +
      remark +
      "</div>" +
      statusPill(task) +
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

  async function refreshActive() {
    const activeEl = document.getElementById("active-lists");
    if (!activeEl) return;
    const res = await fetch("/api/lists/active");
    if (!res.ok) return;
    const data = await res.json();
    activeEl.innerHTML = data.active.length
      ? data.active.map(renderActiveList).join("")
      : '<p class="empty-state">No active lists right now.</p>';
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

    completedEl.innerHTML = completedItems.length
      ? completedItems.map((l) => renderCompletedList(l, query)).join("")
      : '<p class="empty-state">' + (query ? "No past tasks match your search." : "Nothing completed yet.") + "</p>";

    if (loadMoreBtn) loadMoreBtn.hidden = !completedHasMore;
  }

  function setConnStatus(connected) {
    const el = document.getElementById("conn-status");
    if (!el) return;
    el.innerHTML = connected
      ? '<span class="pulse-dot"></span> Live'
      : '<span class="pulse-dot" style="background:#d1d5db;animation:none;"></span> Reconnecting…';
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

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  function wireCompletedControls() {
    const searchInput = document.getElementById("completed-search");
    const loadMoreBtn = document.getElementById("load-more-btn");
    if (searchInput) {
      searchInput.addEventListener("input", debounce(() => loadCompleted({ reset: true }), 300));
    }
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", () => loadCompleted({ reset: false }));
    }
  }

  function connectSocket() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/ws");

    ws.addEventListener("open", () => setConnStatus(true));
    ws.addEventListener("message", () => {
      if (pageMode === "active") refreshActive();
      else loadCompleted({ reset: true });
    });
    ws.addEventListener("close", () => {
      setConnStatus(false);
      setTimeout(connectSocket, 2000);
    });
    ws.addEventListener("error", () => ws.close());
  }

  if (pageMode === "active") {
    wireResendButtons();
    refreshActive();
  } else {
    wireCompletedControls();
    loadCompleted({ reset: true });
  }
  connectSocket();
})();
