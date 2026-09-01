(function () {
  const form = document.getElementById("list-form");
  const sendBtn = document.getElementById("send-btn");
  const errorBox = document.getElementById("form-error");
  const storeRowsWrap = document.getElementById("store-rows");
  const addStoreBtn = document.getElementById("add-store-row");

  function makeStoreRow() {
    const template = storeRowsWrap.querySelector(".store-row");
    const row = template.cloneNode(true);
    row.querySelectorAll("input, select").forEach((el) => {
      el.value = "";
    });
    row.querySelector(".store-custom").hidden = true;
    return row;
  }

  addStoreBtn.addEventListener("click", () => {
    storeRowsWrap.appendChild(makeStoreRow());
  });

  // "Other…" in the store dropdown reveals a free-text field for a store
  // not in the suggested list.
  storeRowsWrap.addEventListener("change", (e) => {
    const select = e.target.closest(".store-select");
    if (!select) return;
    const row = select.closest(".store-row");
    const custom = row.querySelector(".store-custom");
    custom.hidden = select.value !== "__other__";
    if (!custom.hidden) custom.focus();
  });

  function collectItems() {
    const items = [];

    form.querySelectorAll('input[type="checkbox"][data-room]').forEach((el) => {
      if (el.checked) {
        items.push({ type: "room", room: el.dataset.room, mode: el.dataset.mode });
      }
    });

    form.querySelectorAll(".spot-clean-input").forEach((el) => {
      const text = el.value.trim();
      if (text) items.push({ type: "room_spot", room: el.dataset.room, text });
    });

    form.querySelectorAll("[data-simple]").forEach((el) => {
      if (el.checked) items.push({ type: el.dataset.simple });
    });

    const supermarketText = document.getElementById("supermarket-text").value.trim();
    if (supermarketText) items.push({ type: "supermarket_item", text: supermarketText });

    storeRowsWrap.querySelectorAll(".store-row").forEach((row) => {
      const select = row.querySelector(".store-select");
      const place = select.value === "__other__" ? row.querySelector(".store-custom").value.trim() : select.value;
      const text = row.querySelector(".store-items").value.trim();
      if (place && text) items.push({ type: "store_item", place, text });
    });

    const generalText = document.getElementById("general-text").value.trim();
    if (generalText) items.push({ type: "general", text: generalText });

    return items;
  }

  function selectedAssignee() {
    const checked = form.querySelector('input[name="assignee"]:checked');
    return checked ? checked.value : undefined;
  }

  function refreshSendState() {
    sendBtn.disabled = collectItems().length === 0;
  }

  form.addEventListener("input", refreshSendState);
  form.addEventListener("change", refreshSendState);
  refreshSendState();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const items = collectItems();
    if (items.length === 0) return;

    const sendLabel = sendBtn.querySelector("span");
    sendBtn.disabled = true;
    sendBtn.setAttribute("aria-busy", "true");
    sendLabel.textContent = "Sending…";
    errorBox.style.display = "none";

    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, assignee: selectedAssignee() }),
      });
      if (!res.ok) throw new Error("Request failed");

      form.innerHTML =
        '<div class="card confirm-card">' +
        '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="confirm-icon" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5 10.8 15.5 16 9.5"/></svg>' +
        "<h2>List sent</h2>" +
        '<p class="meta">Your list has been emailed. Refresh this page to send another.</p>' +
        "</div>";
    } catch (err) {
      errorBox.textContent = "Something went wrong sending the list. Please try again.";
      errorBox.style.display = "block";
      sendBtn.disabled = false;
      sendBtn.removeAttribute("aria-busy");
      sendLabel.textContent = "Send";
    }
  });
})();
