// Telegram delivery settings: bot health, per-person handles + linking,
// and the overdue-nudge schedule. Everything re-renders from the single
// /api/telegram payload so the page can never show a half-applied state.
(function () {
  const statusEl = document.getElementById("tg-status");
  const peopleEl = document.getElementById("tg-people");
  const nudgesEl = document.getElementById("tg-nudges");
  if (!statusEl || !peopleEl || !nudgesEl) return;

  let state = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  function showError(container, message) {
    const existing = container.querySelector(".error-text");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "error-text";
    el.textContent = message;
    container.appendChild(el);
  }

  // ---- bot status -------------------------------------------------------

  function renderStatus() {
    if (!state.configured) {
      statusEl.innerHTML =
        '<p class="tg-warn">⚠️ No bot token yet. Create a bot with <strong>@BotFather</strong> on Telegram, then set the two secrets:</p>' +
        '<pre class="tg-code">wrangler secret put TELEGRAM_BOT_TOKEN\nwrangler secret put TELEGRAM_WEBHOOK_SECRET</pre>' +
        '<p class="meta">TELEGRAM_WEBHOOK_SECRET is any long random string you choose — it proves incoming updates really came from Telegram.</p>';
      return;
    }

    statusEl.innerHTML =
      '<div class="tg-bot-row">' +
      '<div>' +
      '<div class="tg-bot-name">' +
      (state.botUsername ? "@" + esc(state.botUsername) : "Bot connected") +
      "</div>" +
      '<div class="meta" style="margin:0;">Webhook: ' +
      esc(state.webhookUrl) +
      "</div>" +
      "</div>" +
      '<button type="button" id="tg-setup-btn" class="secondary">Register webhook</button>' +
      "</div>" +
      '<p class="meta">Run this once after setting the secrets, and again if the site URL ever changes.</p>';

    document.getElementById("tg-setup-btn").addEventListener("click", async function (e) {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      try {
        state = await api("/api/telegram/setup", { method: "POST" });
        render();
      } catch (err) {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        showError(statusEl, err.message);
      }
    });
  }

  // ---- people -----------------------------------------------------------

  function channelLabel(person) {
    if (person.channel === "telegram") return "Telegram only";
    if (person.channel === "both") return "Telegram + email";
    return "Email only";
  }

  function personCard(person) {
    const linked = person.linked;
    const pill = linked
      ? '<span class="status-pill done">Linked</span>'
      : person.handle
        ? '<span class="status-pill pending">Waiting for Start</span>'
        : '<span class="status-pill rejected">Not set up</span>';

    let detail = "";
    if (linked) {
      detail =
        '<div class="meta tg-connected">Connected as ' +
        esc(person.telegramName || person.telegramUsername || person.handle) +
        (person.telegramUsername ? " (@" + esc(person.telegramUsername) + ")" : "") +
        "</div>";
    } else if (person.handle && !person.inviteLink) {
      // Handle saved, but we can't build a t.me link until the bot token
      // is set and verified — say which step is missing rather than
      // showing an empty card.
      detail =
        '<div class="meta tg-connected">' +
        (state.configured
          ? "Register the webhook above to generate their invite link."
          : "Add the bot token above to generate their invite link.") +
        "</div>";
    } else if (person.inviteLink) {
      detail =
        '<div class="tg-invite">' +
        '<label class="meta" style="margin:0;">Send them this one-time link:</label>' +
        '<div class="tg-invite-row">' +
        '<input type="text" readonly value="' +
        esc(person.inviteLink) +
        '" data-invite="' +
        esc(person.key) +
        '" />' +
        '<button type="button" class="secondary" data-copy="' +
        esc(person.key) +
        '">Copy</button>' +
        "</div>" +
        "</div>";
    }

    const channelOptions = [
      { value: "email", label: "Email only" },
      { value: "telegram", label: "Telegram only" },
      { value: "both", label: "Telegram + email" },
    ]
      .map(function (opt) {
        const disabled = opt.value !== "email" && !linked ? " disabled" : "";
        const selected = opt.value === person.channel ? " selected" : "";
        return '<option value="' + opt.value + '"' + selected + disabled + ">" + opt.label + "</option>";
      })
      .join("");

    return (
      '<div class="tg-person" data-person="' +
      esc(person.key) +
      '">' +
      '<div class="tg-person-head">' +
      "<strong>" +
      esc(person.name) +
      "</strong>" +
      pill +
      "</div>" +
      '<div class="tg-field">' +
      '<label class="meta" style="margin:0;">Telegram @username or phone number</label>' +
      '<div class="tg-invite-row">' +
      '<input type="text" class="tg-handle" placeholder="@username or +46701234567" value="' +
      esc(person.handle || "") +
      '" />' +
      '<button type="button" class="tg-save">Save</button>' +
      "</div>" +
      "</div>" +
      detail +
      '<div class="tg-field">' +
      '<label class="meta" style="margin:0;">Deliver lists by</label>' +
      '<select class="tg-channel">' +
      channelOptions +
      "</select>" +
      (linked ? "" : '<div class="meta" style="margin:4px 0 0;">Telegram unlocks once they tap Start.</div>') +
      "</div>" +
      '<div class="tg-person-actions">' +
      (linked ? '<button type="button" class="secondary tg-test">Send test</button>' : "") +
      (person.handle
        ? '<button type="button" class="secondary destructive tg-forget">' +
          (linked ? "Unlink" : "Remove") +
          "</button>"
        : "") +
      "</div>" +
      '<div class="meta" style="margin:8px 0 0;">Currently: ' +
      channelLabel(person) +
      " · fallback " +
      esc(person.email) +
      "</div>" +
      "</div>"
    );
  }

  function renderPeople() {
    peopleEl.innerHTML = state.assignees.map(personCard).join("");

    state.assignees.forEach(function (person) {
      const card = peopleEl.querySelector('[data-person="' + person.key + '"]');
      if (!card) return;

      card.querySelector(".tg-save").addEventListener("click", async function (e) {
        const btn = e.currentTarget;
        const handle = card.querySelector(".tg-handle").value;
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        try {
          state = await api("/api/telegram/handle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignee: person.key, handle: handle }),
          });
          render();
        } catch (err) {
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
          showError(card, err.message);
        }
      });

      card.querySelector(".tg-channel").addEventListener("change", async function (e) {
        const select = e.currentTarget;
        const previous = person.channel;
        select.disabled = true;
        try {
          state = await api("/api/telegram/channel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignee: person.key, channel: select.value }),
          });
          render();
        } catch (err) {
          select.value = previous;
          select.disabled = false;
          showError(card, err.message);
        }
      });

      const copyBtn = card.querySelector("[data-copy]");
      if (copyBtn) {
        copyBtn.addEventListener("click", function () {
          const input = card.querySelector("[data-invite]");
          input.select();
          navigator.clipboard.writeText(input.value).then(
            function () {
              copyBtn.textContent = "Copied";
              setTimeout(function () {
                copyBtn.textContent = "Copy";
              }, 1500);
            },
            function () {
              document.execCommand("copy");
            },
          );
        });
      }

      const testBtn = card.querySelector(".tg-test");
      if (testBtn) {
        testBtn.addEventListener("click", async function (e) {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.setAttribute("aria-busy", "true");
          try {
            await api("/api/telegram/test", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assignee: person.key }),
            });
            btn.textContent = "Sent ✓";
            setTimeout(function () {
              btn.textContent = "Send test";
              btn.disabled = false;
              btn.removeAttribute("aria-busy");
            }, 2000);
          } catch (err) {
            btn.disabled = false;
            btn.removeAttribute("aria-busy");
            showError(card, err.message);
          }
        });
      }

      const forgetBtn = card.querySelector(".tg-forget");
      if (forgetBtn) {
        forgetBtn.addEventListener("click", function () {
          const wasLinked = person.linked;
          window.AppModal.open({
            title: wasLinked ? "Unlink " + person.name + "?" : "Remove " + person.name + "'s handle?",
            render: function (modal) {
              const p = document.createElement("p");
              p.className = "meta";
              p.textContent = wasLinked
                ? "Their chat stops receiving tasks and they go back to email. They can link again with a new invite link."
                : "Removes the saved username or number.";
              modal.body.appendChild(p);

              window.AppModal.addButton(modal.actionsBar, {
                label: "Cancel",
                variant: "secondary",
                onClick: modal.close,
              });
              window.AppModal.addButton(modal.actionsBar, {
                label: wasLinked ? "Unlink" : "Remove",
                variant: "destructive",
                onClick: async function () {
                  modal.close();
                  try {
                    state = await api("/api/telegram/unlink", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ assignee: person.key, forget: !wasLinked }),
                    });
                    render();
                  } catch (err) {
                    showError(card, err.message);
                  }
                },
              });
            },
          });
        });
      }
    });
  }

  // ---- nudges -----------------------------------------------------------

  function renderNudges() {
    const hours = state.nudges.hours;
    const quiet = state.nudges.quiet;
    const rows = [
      { dot: "🔴", label: "High priority", hours: hours.high },
      { dot: "🟡", label: "Medium priority", hours: hours.medium },
      { dot: "🟢", label: "Low priority", hours: hours.low },
    ]
      .map(function (row) {
        return (
          '<div class="tg-nudge-row"><span>' +
          row.dot +
          " " +
          row.label +
          "</span><strong>" +
          row.hours +
          (row.hours === 1 ? " hour" : " hours") +
          "</strong></div>"
        );
      })
      .join("");

    nudgesEl.innerHTML =
      '<p class="meta">If a task is still open after this long, Telegram chases it — repeating at the same interval up to ' +
      state.nudges.maxNudges +
      " times.</p>" +
      rows +
      '<p class="meta" style="margin-top:12px;">' +
      (quiet
        ? "Quiet hours " +
          String(quiet.startHour).padStart(2, "0") +
          ":00–" +
          String(quiet.endHour).padStart(2, "0") +
          ":00 — nudges due overnight are held until morning."
        : "Quiet hours are off — nudges go out around the clock.") +
      "</p>" +
      '<p class="meta">Change these in <code>wrangler.jsonc</code> (NUDGE_HOURS_HIGH, NUDGE_HOURS_MEDIUM, NUDGE_HOURS_LOW, NUDGE_MAX, NUDGE_QUIET_HOURS).</p>';
  }

  function render() {
    renderStatus();
    renderPeople();
    renderNudges();
  }

  api("/api/telegram")
    .then(function (data) {
      state = data;
      render();
    })
    .catch(function (err) {
      statusEl.innerHTML = '<p class="empty-state">Couldn\'t load settings: ' + esc(err.message) + "</p>";
      peopleEl.innerHTML = "";
      nudgesEl.innerHTML = "";
    });
})();
