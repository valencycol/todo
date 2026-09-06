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
    if (!res.ok) {
      // A 500 with no JSON error body is almost always the schema being
      // behind the code — surface that instead of a shrug, since it's the
      // one failure a deploy can cause without any other signal.
      if (data.error) throw new Error(data.error);
      if (res.status >= 500) {
        throw new Error(
          "The server errored (HTTP " +
            res.status +
            "). If Telegram was just deployed, the database migration probably hasn't run yet: npm run db:migrate:remote",
        );
      }
      throw new Error("Request failed (HTTP " + res.status + ").");
    }
    return data;
  }

  function showNote(container, message) {
    const existing = container.querySelector(".tg-note");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "tg-note";
    el.textContent = message;
    container.appendChild(el);
  }

  function showError(container, message) {
    const stale = container.querySelector(".tg-note");
    if (stale) stale.remove();
    const existing = container.querySelector(".error-text");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "error-text";
    el.textContent = message;
    container.appendChild(el);
  }

  // ---- bot status -------------------------------------------------------

  function timeAgo(ms) {
    const mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  }

  // What Telegram itself reports, not what we last asked for — a webhook
  // pointing at a stale URL reads as "registered" but delivers nothing.
  function webhookState() {
    const w = state.webhook;
    if (!w) return { tone: "unknown", title: "Webhook status unavailable", detail: "Couldn't reach Telegram." };
    if (!w.registered) {
      return {
        tone: "off",
        title: "Not registered",
        detail: "Telegram has nowhere to deliver button taps yet.",
      };
    }
    if (!w.matches) {
      return {
        tone: "off",
        title: "Pointing somewhere else",
        detail: "Telegram is delivering to " + esc(w.url) + " — re-register to fix.",
      };
    }
    if (w.lastError) {
      return {
        tone: "warn",
        title: "Registered, but Telegram reported an error",
        detail: esc(w.lastError) + (w.lastErrorAt ? " (" + timeAgo(w.lastErrorAt) + ")" : ""),
      };
    }
    return {
      tone: "ok",
      title: "Connected",
      detail:
        "Telegram is delivering to this site." +
        (w.pending > 0 ? " " + w.pending + " update(s) queued." : " Nothing queued."),
    };
  }

  function renderStatus(flash) {
    if (!state.configured) {
      statusEl.innerHTML =
        '<p class="tg-warn">⚠️ No bot token yet. Create a bot with <strong>@BotFather</strong> on Telegram, then set the two secrets:</p>' +
        '<pre class="tg-code">wrangler secret put TELEGRAM_BOT_TOKEN\nwrangler secret put TELEGRAM_WEBHOOK_SECRET</pre>' +
        '<p class="meta">TELEGRAM_WEBHOOK_SECRET is any long random string you choose — it proves incoming updates really came from Telegram.</p>';
      return;
    }

    const w = webhookState();

    statusEl.innerHTML =
      '<div class="tg-bot-row">' +
      "<div>" +
      '<div class="tg-bot-name">' +
      (state.botUsername ? "@" + esc(state.botUsername) : "Bot connected") +
      "</div>" +
      '<div class="meta" style="margin:0;">' +
      esc(state.webhookUrl) +
      "</div>" +
      "</div>" +
      '<button type="button" id="tg-setup-btn" class="secondary">' +
      (w.tone === "ok" ? "Re-register" : "Register webhook") +
      "</button>" +
      "</div>" +
      '<div class="tg-health tg-health-' +
      w.tone +
      '"><span class="tg-health-dot"></span><div><strong>' +
      w.title +
      "</strong><div class=\"meta\" style=\"margin:0;\">" +
      w.detail +
      "</div></div></div>" +
      (flash ? '<p class="tg-flash">' + esc(flash) + "</p>" : "");

    document.getElementById("tg-setup-btn").addEventListener("click", async function (e) {
      const btn = e.currentTarget;
      const original = btn.textContent;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.textContent = "Registering…";
      try {
        const result = await api("/api/telegram/setup", { method: "POST" });
        state = result;
        // The status card looks near-identical before and after, so say
        // explicitly that something happened.
        render(
          result.firstRegistration
            ? "✓ Webhook registered. Telegram will now deliver button taps here."
            : "✓ Webhook re-registered. Nothing queued was discarded.",
        );
      } catch (err) {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        btn.textContent = original;
        showError(statusEl, err.message);
      }
    });
  }

  // ---- people -----------------------------------------------------------

  // "fallback" was wrong whenever email IS the channel — the address is
  // the destination then, not a backup for one.
  function currentlyLine(person) {
    const email = esc(person.email);
    if (person.channel === "telegram") {
      return "Currently: Telegram only · email fallback " + email;
    }
    if (person.channel === "both") {
      return "Currently: Telegram and email · " + email;
    }
    return "Currently: Email only · " + email;
  }

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
      '<div class="tg-invite-row">' +
      '<select class="tg-channel">' +
      channelOptions +
      "</select>" +
      '<button type="button" class="tg-save-channel" disabled>Save</button>' +
      "</div>" +
      (linked ? "" : '<div class="meta" style="margin:4px 0 0;">Telegram unlocks once they tap Start.</div>') +
      "</div>" +
      '<div class="tg-person-actions">' +
      // Testing is useful for an email-only person too, not just a linked one.
      (linked || person.emailEnabled ? '<button type="button" class="secondary tg-test">Send test</button>' : "") +
      (person.handle
        ? '<button type="button" class="secondary destructive tg-forget">' +
          (linked ? "Unlink" : "Remove") +
          "</button>"
        : "") +
      "</div>" +
      '<div class="meta" style="margin:8px 0 0;">' +
      currentlyLine(person) +
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

      const channelSelect = card.querySelector(".tg-channel");
      const saveChannelBtn = card.querySelector(".tg-save-channel");

      // Save is only live once the value differs from what's stored, so
      // the button can't imply an unsaved change that isn't there.
      channelSelect.addEventListener("change", function () {
        saveChannelBtn.disabled = channelSelect.value === person.channel;
      });

      saveChannelBtn.addEventListener("click", async function (e) {
        const btn = e.currentTarget;
        const previous = person.channel;
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        try {
          state = await api("/api/telegram/channel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignee: person.key, channel: channelSelect.value }),
          });
          render();
          const saved = state.assignees.find(function (a) {
            return a.key === person.key;
          });
          showNote(
            peopleEl.querySelector('[data-person="' + person.key + '"]'),
            "✓ Saved — " + person.name + " now receives lists by " + channelLabel(saved).toLowerCase() + ".",
          );
        } catch (err) {
          channelSelect.value = previous;
          btn.disabled = true;
          btn.removeAttribute("aria-busy");
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
            const result = await api("/api/telegram/test", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assignee: person.key }),
            });
            btn.textContent = "Send test";
            btn.disabled = false;
            btn.removeAttribute("aria-busy");
            // A 2-second label flip was too easy to miss, and it never said
            // where the message went — which matters, because a test for
            // Alvita lands on Alvita's phone, not the sender's.
            const via = (result.sentVia || []).join(" and ") || "their configured channel";
            showNote(
              card,
              "✓ Test sent to " + person.name + " via " + via + "." +
                (result.problems && result.problems.length ? " " + result.problems.join(" ") : ""),
            );
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
      "</p>";
  }

  function render(flash) {
    renderStatus(flash);
    renderPeople();
    renderNudges();
  }

  api("/api/telegram")
    .then(function (data) {
      state = data;
      render();
    })
    .catch(function (err) {
      statusEl.innerHTML =
        '<p class="tg-warn">⚠️ Couldn\'t load settings.</p><p class="meta">' +
        esc(err.message) +
        '</p><button type="button" id="tg-retry" class="secondary">Try again</button>';
      peopleEl.innerHTML = '<p class="empty-state">Unavailable until settings load.</p>';
      nudgesEl.innerHTML = "";
      document.getElementById("tg-retry").addEventListener("click", function () {
        location.reload();
      });
    });
})();
