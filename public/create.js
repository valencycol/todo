(function () {
  const form = document.getElementById("list-form");
  const sendBtn = document.getElementById("send-btn");
  const errorBox = document.getElementById("form-error");
  const storeRowsWrap = document.getElementById("store-rows");
  const addStoreBtn = document.getElementById("add-store-row");
  const shoppingRowsWrap = document.getElementById("shopping-rows");
  const addShoppingBtn = document.getElementById("add-shopping-row");

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

  function makeShoppingRow() {
    const template = shoppingRowsWrap.querySelector(".shopping-row");
    const row = template.cloneNode(true);
    row.querySelectorAll("input").forEach((el) => {
      el.value = "";
    });
    return row;
  }

  addShoppingBtn.addEventListener("click", () => {
    shoppingRowsWrap.appendChild(makeShoppingRow());
    shoppingRowsWrap.lastElementChild.querySelector(".shopping-item").focus();
  });

  // Every action gets the same "+" button once picked. For most actions
  // it's an optional extra note; for "Spot clean" and "Other…" — which need
  // a detail to mean anything — the same modal instead captures that
  // required text, just with wording to match.
  const ROOM_TEXT_MODAL = {
    spot: { title: "Spot clean", placeholder: "e.g. the stovetop", required: true },
    other: { title: "Describe what needs doing", placeholder: "Describe what needs doing", required: true },
  };
  const DEFAULT_NOTES_MODAL = { title: "More instructions", placeholder: "e.g. use the eco spray under the sink", required: false };

  function roomModalConfig(actionValue) {
    return ROOM_TEXT_MODAL[actionValue] || DEFAULT_NOTES_MODAL;
  }

  form.addEventListener("change", (e) => {
    const select = e.target.closest(".room-action-select");
    if (!select) return;
    const row = select.closest(".room-row");
    const notesBtn = row.querySelector(".room-notes-btn");
    const notesValue = row.querySelector(".room-notes-value");
    const roomName = row.querySelector(".room-name").textContent;

    notesBtn.disabled = !select.value;
    if (!select.value) {
      notesValue.value = "";
      notesBtn.classList.remove("has-notes");
    }
    notesBtn.setAttribute("aria-label", `${roomModalConfig(select.value).title} for ${roomName}`);
  });

  function openRoomNotesModal(button) {
    const row = button.closest(".room-row");
    const select = row.querySelector(".room-action-select");
    const roomLabel = row.querySelector(".room-name").textContent;
    const notesValue = row.querySelector(".room-notes-value");
    const config = roomModalConfig(select.value);

    AppModal.open({
      title: `${config.title} — ${roomLabel}`,
      render(modal) {
        const textarea = document.createElement("textarea");
        textarea.placeholder = config.placeholder;
        textarea.rows = 4;
        textarea.value = notesValue.value;
        modal.body.appendChild(textarea);

        AppModal.addButton(modal.actionsBar, { label: "Cancel", variant: "secondary", onClick: modal.close });
        AppModal.addButton(modal.actionsBar, {
          label: "Save",
          onClick: () => {
            const text = textarea.value.trim();
            notesValue.value = text;
            button.classList.toggle("has-notes", Boolean(text));
            modal.close();
            // The modal lives outside <form>, so saving it doesn't fire the
            // form's own input/change listeners — refresh Send's disabled
            // state by hand (this is the only way a required "Spot clean" /
            // "Other…" detail can turn Send on).
            refreshSendState();
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
      const modalText = row.querySelector(".room-notes-value").value.trim();

      if (roomModalConfig(select.value).required) {
        if (!modalText) return;
        entries.push({
          item: { type: "room", room: select.dataset.room, action: select.value, text: modalText },
          label: `${actionLabel} ${roomName}: ${modalText}`,
        });
      } else {
        entries.push({
          item: { type: "room", room: select.dataset.room, action: select.value, notes: modalText || undefined },
          label: modalText ? `${actionLabel} ${roomName}: ${modalText}` : `${actionLabel} ${roomName}`,
        });
      }
    });

    form.querySelectorAll("[data-simple]").forEach((el) => {
      if (!el.checked) return;
      const label = el.closest(".chore-item").querySelector("span").textContent;
      entries.push({ item: { type: el.dataset.simple }, label });
    });

    shoppingRowsWrap.querySelectorAll(".shopping-row").forEach((row) => {
      const item = row.querySelector(".shopping-item").value.trim();
      if (!item) return;
      const qty = row.querySelector(".shopping-qty").value.trim();
      const text = qty ? `${item} × ${qty}` : item;
      entries.push({ item: { type: "supermarket_item", text }, label: `Pick up from the supermarket: ${text}` });
    });

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

  // Puts every field back to its just-loaded state so another list can be
  // built right away. form.reset() handles the native controls (selects,
  // checkboxes, text inputs, and the hidden per-room notes values all revert
  // to their server-rendered defaults) — what's left is the JS-driven
  // visual state (hidden/disabled toggles, the has-notes dot) that reset()
  // doesn't know about, plus any store rows added beyond the first.
  function resetFormForNewList() {
    form.reset();

    form.querySelectorAll(".room-row").forEach((row) => {
      const notesBtn = row.querySelector(".room-notes-btn");
      notesBtn.disabled = true;
      notesBtn.classList.remove("has-notes");
      notesBtn.setAttribute("aria-label", `More instructions for ${row.querySelector(".room-name").textContent}`);
    });

    storeRowsWrap.querySelectorAll(".store-row").forEach((row, i) => {
      if (i === 0) row.querySelector(".store-custom").hidden = true;
      else row.remove();
    });

    shoppingRowsWrap.querySelectorAll(".shopping-row").forEach((row, i) => {
      if (i > 0) row.remove();
    });

    refreshSendState();
  }

  function showSentConfirmation() {
    AppModal.open({
      title: "List sent",
      onClose: resetFormForNewList,
      render(modal) {
        modal.body.style.textAlign = "center";

        const icon = document.createElement("div");
        icon.className = "confirm-icon";
        icon.innerHTML =
          '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5 10.8 15.5 16 9.5"/></svg>';

        const message = document.createElement("p");
        message.className = "meta";
        message.textContent = "Your list has been emailed.";

        modal.body.append(icon, message);

        AppModal.addButton(modal.actionsBar, { label: "Done", onClick: modal.close });
      },
    });
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
