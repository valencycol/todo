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

  const ROOM_ACTIONS_NEEDING_TEXT = { spot: true, other: true };
  const ROOM_TEXT_PLACEHOLDER = { spot: "e.g. the stovetop", other: "Describe what needs doing" };

  // Actions like "Spot clean" and "Other…" need an accompanying detail —
  // reveal the text field only for those, with a placeholder to match. The
  // "More instructions" button only makes sense once an action is picked
  // (there's nothing to add instructions to for "No action"), so it stays
  // disabled — and any notes already entered are dropped — until then.
  form.addEventListener("change", (e) => {
    const select = e.target.closest(".room-action-select");
    if (!select) return;
    const row = select.closest(".room-row");
    const textInput = row.querySelector(".room-action-text");
    const notesBtn = row.querySelector(".room-notes-btn");
    const notesValue = row.querySelector(".room-notes-value");
    const needsText = ROOM_ACTIONS_NEEDING_TEXT[select.value] === true;

    textInput.hidden = !needsText;
    textInput.placeholder = ROOM_TEXT_PLACEHOLDER[select.value] || "Details";
    if (needsText) textInput.focus();
    else textInput.value = "";

    notesBtn.disabled = !select.value;
    if (!select.value) {
      notesValue.value = "";
      notesBtn.textContent = "More instructions";
      notesBtn.classList.remove("has-notes");
    }
  });

  function openRoomNotesModal(button) {
    const row = button.closest(".room-row");
    const roomLabel = row.querySelector(".room-name").textContent;
    const notesValue = row.querySelector(".room-notes-value");

    AppModal.open({
      title: `More instructions — ${roomLabel}`,
      render(modal) {
        const textarea = document.createElement("textarea");
        textarea.placeholder = "e.g. use the eco spray under the sink";
        textarea.rows = 4;
        textarea.value = notesValue.value;
        modal.body.appendChild(textarea);

        AppModal.addButton(modal.actionsBar, { label: "Cancel", variant: "secondary", onClick: modal.close });
        AppModal.addButton(modal.actionsBar, {
          label: "Save",
          onClick: () => {
            const text = textarea.value.trim();
            notesValue.value = text;
            button.textContent = text ? "Edit instructions" : "More instructions";
            button.classList.toggle("has-notes", Boolean(text));
            modal.close();
          },
        });
      },
    });
  }

  form.addEventListener("click", (e) => {
    const notesBtn = e.target.closest(".room-notes-btn");
    if (notesBtn) openRoomNotesModal(notesBtn);
  });

  // Each entry pairs the payload the server expects with a human-readable
  // label for the review popup, so that popup doesn't need its own copy of
  // the room/action/chore catalog to describe what it's showing.
  function collectItems() {
    const entries = [];

    form.querySelectorAll(".room-row").forEach((row) => {
      const select = row.querySelector(".room-action-select");
      if (!select.value) return;

      const roomName = row.querySelector(".room-name").textContent;
      const actionLabel = select.options[select.selectedIndex].textContent;
      const notes = row.querySelector(".room-notes-value").value.trim();

      if (ROOM_ACTIONS_NEEDING_TEXT[select.value]) {
        const text = row.querySelector(".room-action-text").value.trim();
        if (!text) return;
        entries.push({
          item: { type: "room", room: select.dataset.room, action: select.value, text, notes: notes || undefined },
          label: notes ? `${actionLabel} ${roomName}: ${text} (${notes})` : `${actionLabel} ${roomName}: ${text}`,
        });
      } else {
        entries.push({
          item: { type: "room", room: select.dataset.room, action: select.value, notes: notes || undefined },
          label: notes ? `${actionLabel} ${roomName}: ${notes}` : `${actionLabel} ${roomName}`,
        });
      }
    });

    form.querySelectorAll("[data-simple]").forEach((el) => {
      if (!el.checked) return;
      const label = el.closest(".chore-item").querySelector("span").textContent;
      entries.push({ item: { type: el.dataset.simple }, label });
    });

    const supermarketText = document.getElementById("supermarket-text").value.trim();
    if (supermarketText) {
      entries.push({
        item: { type: "supermarket_item", text: supermarketText },
        label: `Pick up from the supermarket: ${supermarketText}`,
      });
    }

    storeRowsWrap.querySelectorAll(".store-row").forEach((row) => {
      const select = row.querySelector(".store-select");
      const place = select.value === "__other__" ? row.querySelector(".store-custom").value.trim() : select.value;
      const text = row.querySelector(".store-items").value.trim();
      if (place && text) {
        entries.push({ item: { type: "store_item", place, text }, label: `Pick up from ${place}: ${text}` });
      }
    });

    const generalText = document.getElementById("general-text").value.trim();
    if (generalText) entries.push({ item: { type: "general", text: generalText }, label: generalText });

    return entries;
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

  function showSentConfirmation() {
    form.innerHTML =
      '<div class="card confirm-card">' +
      '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="confirm-icon" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5 10.8 15.5 16 9.5"/></svg>' +
      "<h2>List sent</h2>" +
      '<p class="meta">Your list has been emailed. Refresh this page to send another.</p>' +
      "</div>";
  }

  const PRIORITY_LEVELS = ["low", "medium", "high"];
  const DEFAULT_PRIORITY = "medium";

  function openReviewModal(entries) {
    const priorities = entries.map(() => DEFAULT_PRIORITY);

    AppModal.open({
      title: "Review your list",
      render(modal) {
        const list = document.createElement("div");
        list.className = "review-list";

        entries.forEach((entry, i) => {
          const row = document.createElement("div");
          row.className = "review-row";

          const label = document.createElement("span");
          label.className = "review-label";
          label.textContent = entry.label;

          const toggle = document.createElement("div");
          toggle.className = "priority-toggle";
          toggle.setAttribute("role", "group");
          toggle.setAttribute("aria-label", `Priority for ${entry.label}`);

          PRIORITY_LEVELS.forEach((level) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `priority-btn priority-${level}${level === DEFAULT_PRIORITY ? " active" : ""}`;
            btn.textContent = level.charAt(0).toUpperCase() + level.slice(1);
            btn.addEventListener("click", () => {
              priorities[i] = level;
              toggle.querySelectorAll(".priority-btn").forEach((b) => b.classList.remove("active"));
              btn.classList.add("active");
            });
            toggle.appendChild(btn);
          });

          row.append(label, toggle);
          list.appendChild(row);
        });

        modal.body.appendChild(list);

        const modalError = document.createElement("p");
        modalError.className = "error-text";
        modalError.style.display = "none";
        modal.body.appendChild(modalError);

        const backBtn = AppModal.addButton(modal.actionsBar, { label: "Back", variant: "secondary", onClick: modal.close });
        const confirmBtn = AppModal.addButton(modal.actionsBar, {
          label: "Send",
          onClick: async () => {
            const items = entries.map((entry, i) => Object.assign({}, entry.item, { priority: priorities[i] }));

            backBtn.disabled = true;
            confirmBtn.disabled = true;
            confirmBtn.setAttribute("aria-busy", "true");
            modalError.style.display = "none";

            try {
              const res = await fetch("/api/lists", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items, assignee: selectedAssignee() }),
              });
              if (!res.ok) throw new Error("Request failed");
              modal.close();
              showSentConfirmation();
            } catch (err) {
              modalError.textContent = "Something went wrong sending the list. Please try again.";
              modalError.style.display = "block";
              backBtn.disabled = false;
              confirmBtn.disabled = false;
              confirmBtn.removeAttribute("aria-busy");
            }
          },
        });
      },
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const entries = collectItems();
    if (entries.length === 0) return;
    errorBox.style.display = "none";
    openReviewModal(entries);
  });
})();
