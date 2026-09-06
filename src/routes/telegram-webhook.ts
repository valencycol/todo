import { Hono } from "hono";
import {
  getTaskById,
  getTaskByRejectPrompt,
  resolveTask,
  setRejectPrompt,
  setTaskRemarks,
  getOpenTasksForChat,
} from "../lib/db";
import { broadcast } from "../lib/hub";
import { getAssignees } from "../lib/assignees";
import {
  bindChat,
  findSlotForPhone,
  findSlotForStart,
  getRecipientByChatId,
  phoneDigits,
  type TelegramRecipient,
} from "../lib/recipients";
import { answerCallback, editMessage, sendMessage, tgEscape } from "../lib/telegram";
import { callbackData, parseCallbackData, renderTask, syncTaskMessage } from "../lib/telegram-tasks";
import { getPolicy } from "../lib/escalation";

export const telegramWebhookRoutes = new Hono<{ Bindings: Env }>();

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
  reply_to_message?: { message_id: number };
  contact?: { phone_number: string; user_id?: number };
}

interface TgUpdate {
  message?: TgMessage;
  callback_query?: {
    id: string;
    from: TgUser;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

function displayName(user: TgUser | undefined): string | null {
  if (!user) return null;
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || null;
}

function assigneeName(env: Env, key: string): string {
  return getAssignees(env).find((a) => a.key === key)?.name ?? key;
}

/**
 * Telegram echoes the secret we registered with setWebhook on every call.
 * That header is the only thing standing between this route and the open
 * internet — it's outside the session middleware by necessity, since
 * Telegram has no cookie.
 */
function isFromTelegram(c: { req: { header: (n: string) => string | undefined }; env: Env }): boolean {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false;
  const provided = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (!provided || provided.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

async function greetLinked(env: Env, chatId: string, recipient: TelegramRecipient): Promise<void> {
  const name = assigneeName(env, recipient.assignee);
  await sendMessage(
    env,
    chatId,
    [
      `✅ <b>Linked as ${tgEscape(name)}.</b>`,
      "",
      "To-do lists will arrive here. Each task gets its own message with",
      "<b>Done</b> and <b>Reject</b> buttons — tap one and it's recorded instantly.",
      "",
      "You can also reply to any task message to attach a note.",
      "",
      "<i>Commands:</i> /open — what's still on your plate · /help",
    ].join("\n"),
    { keyboard: { remove_keyboard: true } },
  );
}

/**
 * /start — the only way a chat can ever become reachable. Matches the
 * deep-link code first, then the @username against a configured handle,
 * and otherwise asks for a contact card so a phone-number handle can be
 * matched. Anything unmatched is told to ask for a link, never bound.
 */
async function handleStart(env: Env, db: D1Database, message: TgMessage, payload: string | null): Promise<void> {
  const chatId = String(message.chat.id);
  const username = message.from?.username ?? null;

  const existing = await getRecipientByChatId(db, chatId);
  if (existing && !payload) {
    await greetLinked(env, chatId, existing);
    return;
  }

  const slot = await findSlotForStart(db, payload, username);
  if (slot) {
    await bindChat(db, slot.assignee, chatId, username, displayName(message.from));
    await greetLinked(env, chatId, (await getRecipientByChatId(db, chatId)) ?? slot);
    return;
  }

  await sendMessage(
    env,
    chatId,
    [
      "👋 <b>Colaco House To-Do List</b>",
      "",
      "I don't recognise you yet. If a phone number was added for you in",
      "Settings, tap the button below and I'll match it.",
      "",
      "<i>Otherwise ask for your personal invite link from the app.</i>",
    ].join("\n"),
    {
      keyboard: {
        keyboard: [[{ text: "📱 Share my number to link", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    },
  );
}

/**
 * Contact-card path for phone-number handles. Only the sender's own
 * contact counts — a forwarded card has a different user_id, and accepting
 * those would let anyone bind themselves to someone else's slot.
 */
async function handleContact(env: Env, db: D1Database, message: TgMessage): Promise<void> {
  const chatId = String(message.chat.id);
  const contact = message.contact!;

  if (!contact.user_id || !message.from || contact.user_id !== message.from.id) {
    await sendMessage(env, chatId, "That contact isn't yours — please share your own number.");
    return;
  }

  const slot = await findSlotForPhone(db, phoneDigits(contact.phone_number));
  if (!slot) {
    await sendMessage(
      env,
      chatId,
      "That number isn't registered in Settings. Ask for your personal invite link instead.",
      { keyboard: { remove_keyboard: true } },
    );
    return;
  }

  await bindChat(db, slot.assignee, chatId, message.from.username ?? null, displayName(message.from));
  await greetLinked(env, chatId, (await getRecipientByChatId(db, chatId)) ?? slot);
}

async function handleOpen(env: Env, db: D1Database, chatId: string): Promise<void> {
  const tasks = await getOpenTasksForChat(db, chatId);
  if (tasks.length === 0) {
    await sendMessage(env, chatId, "🎉 Nothing open — you're all caught up.");
    return;
  }

  const policy = getPolicy(env);
  await sendMessage(env, chatId, `<b>${tasks.length} still open</b>`);
  for (const task of tasks) {
    const { text, buttons } = renderTask(task, policy);
    await sendMessage(env, chatId, text, { buttons, silent: true });
  }
}

/**
 * A reply to a task's message attaches a note to that task. This works
 * before or after resolving, which is what replaces the remarks box the
 * email flow gets on the web page.
 */
async function handleReply(env: Env, db: D1Database, message: TgMessage, chatId: string): Promise<boolean> {
  const repliedTo = message.reply_to_message?.message_id;
  const text = message.text?.trim();
  if (!repliedTo || !text) return false;

  // A reply to a rejection prompt is the reason — this is what actually
  // resolves the task, since pressing Reject only asked the question.
  const awaiting = await getTaskByRejectPrompt(db, chatId, repliedTo);
  if (awaiting) {
    if (awaiting.status !== "pending") {
      await setRejectPrompt(db, awaiting.id, null);
      await sendMessage(env, chatId, "That task was already resolved.", {
        replyToMessageId: message.message_id,
      });
      return true;
    }

    await resolveTask(db, awaiting.id, "rejected", text.slice(0, 1000));
    await setRejectPrompt(db, awaiting.id, null);
    await syncTaskMessage(env, db, awaiting.id);
    await broadcast(env, { type: "task_resolved" });
    await sendMessage(env, chatId, `✖️ Rejected <b>${tgEscape(awaiting.label)}</b>.`, {
      replyToMessageId: message.message_id,
    });
    return true;
  }

  const task = await db
    .prepare("SELECT * FROM tasks WHERE tg_chat_id = ? AND tg_message_id = ?")
    .bind(chatId, repliedTo)
    .first<{ id: string; label: string }>();
  if (!task) return false;

  await setTaskRemarks(db, task.id, text.slice(0, 1000));
  await syncTaskMessage(env, db, task.id);
  await broadcast(env, { type: "task_edited" });
  await sendMessage(env, chatId, `📝 Note saved for <b>${tgEscape(task.label)}</b>.`, {
    replyToMessageId: message.message_id,
  });
  return true;
}

async function handleMessage(env: Env, db: D1Database, message: TgMessage): Promise<void> {
  const chatId = String(message.chat.id);
  const text = message.text?.trim() ?? "";

  if (message.contact) {
    await handleContact(env, db, message);
    return;
  }

  if (text.startsWith("/start")) {
    const payload = text.slice("/start".length).trim() || null;
    await handleStart(env, db, message, payload);
    return;
  }

  // Everything past this point is only for chats we've actually bound —
  // an unlinked chat gets no information about the household at all.
  const recipient = await getRecipientByChatId(db, chatId);
  if (!recipient) {
    if (text.startsWith("/")) {
      await sendMessage(env, chatId, "You're not linked to a to-do list. Send /start to begin.");
    }
    return;
  }

  if (text.startsWith("/open") || text.startsWith("/tasks")) {
    await handleOpen(env, db, chatId);
    return;
  }

  if (text.startsWith("/help")) {
    await sendMessage(
      env,
      chatId,
      [
        "<b>What I can do</b>",
        "",
        "• Send you each to-do task with <b>Done</b> / <b>Reject</b> buttons",
        "• Nudge you when something stays open too long",
        "• Save a note if you reply to a task's message",
        "",
        "/open — list what's still open",
      ].join("\n"),
    );
    return;
  }

  if (await handleReply(env, db, message, chatId)) return;

  if (text && !text.startsWith("/")) {
    await sendMessage(env, chatId, "Reply directly to a task's message to attach a note, or send /open.");
  }
}

async function handleCallback(env: Env, db: D1Database, query: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const source = query.message;
  const chatId = source ? String(source.chat.id) : null;
  if (!source || !chatId || !query.data) {
    await answerCallback(env, query.id);
    return;
  }

  // The chat binding is the authorization: a button press only counts if
  // it came from a chat that's currently linked to an assignee slot.
  const recipient = await getRecipientByChatId(db, chatId);
  if (!recipient) {
    await answerCallback(env, query.id, "This chat isn't linked to a to-do list.");
    return;
  }

  const parsed = parseCallbackData(query.data);
  if (!parsed) {
    await answerCallback(env, query.id);
    return;
  }

  const task = await getTaskById(db, parsed.taskId);
  if (!task || task.tg_chat_id !== chatId) {
    await answerCallback(env, query.id, "That task is no longer available.");
    return;
  }

  if (parsed.action === "cancel") {
    await setRejectPrompt(db, task.id, null);
    await answerCallback(env, query.id, "Rejection cancelled.");
    await editMessage(
      env,
      chatId,
      source.message_id,
      "✖️ <i>Rejection cancelled — the task is still open.</i>",
      [],
    );
    return;
  }

  if (parsed.action === "note") {
    await answerCallback(env, query.id, "Reply to the task message with your note.");
    await sendMessage(env, chatId, `📝 Reply to this with your note for <b>${tgEscape(task.label)}</b>.`, {
      replyToMessageId: task.tg_message_id ?? undefined,
    });
    return;
  }

  if (task.status !== "pending") {
    await answerCallback(env, query.id, task.status === "done" ? "Already accepted." : "Already rejected.");
    await syncTaskMessage(env, db, task.id);
    return;
  }

  // Rejecting needs a reason, so the button only asks the question — the
  // reply to this prompt is what actually resolves the task. Done stays a
  // single tap; explaining a completed chore is nobody's idea of useful.
  if (parsed.action === "reject") {
    await answerCallback(env, query.id, "Tell me why, and I'll reject it.");
    const prompt = await sendMessage(
      env,
      chatId,
      `✖️ <b>Why are you rejecting this?</b>\n${tgEscape(task.label)}\n\n<i>Long-press this message and tap Reply to send the reason — don’t send it as a normal chat message.</i>`,
      {
        replyToMessageId: task.tg_message_id ?? undefined,
        buttons: [[{ text: "✖️ Cancel rejection", callback_data: callbackData("cancel", task.id) }]],
      },
    );
    if (prompt) await setRejectPrompt(db, task.id, prompt.message_id);
    return;
  }

  await resolveTask(db, task.id, "done", task.remarks);
  await setRejectPrompt(db, task.id, null);
  await answerCallback(env, query.id, "✅ Accepted");
  await syncTaskMessage(env, db, task.id);
  await broadcast(env, { type: "task_resolved" });
}

telegramWebhookRoutes.post("/telegram/webhook", async (c) => {
  if (!isFromTelegram(c)) {
    return c.json({ error: "Forbidden." }, 403);
  }

  const update = await c.req.json<TgUpdate>().catch(() => null);
  if (!update) return c.json({ ok: true });

  try {
    if (update.callback_query) {
      await handleCallback(c.env, c.env.DB, update.callback_query);
    } else if (update.message) {
      await handleMessage(c.env, c.env.DB, update.message);
    }
  } catch (err) {
    // Always 200: a non-2xx makes Telegram retry the same update, and a
    // bug here would turn into an infinite redelivery loop.
    console.error("telegram: update handler threw", err);
  }

  return c.json({ ok: true });
});
