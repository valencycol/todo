# Colaco House To-Do List

A household to-do list on Cloudflare Workers. Lists are created in the web
app and delivered to the assigned person by **email**, **Telegram**, or both.
Telegram tasks carry Done / Reject buttons that resolve straight from the
notification.

- **Stack** — Cloudflare Workers + Hono, D1 (SQLite), a Durable Object for
  live dashboard updates, Cloudflare Email Sending, Telegram Bot API.
- **Live at** `https://todo.colaco.se`

---

## Deploying from scratch

Assumes a Cloudflare account and Node 20+.

### 1. Clone and install

```bash
git clone <repo-url> todo
cd todo
npm install
npx wrangler login
```

### 2. Create the database

```bash
npx wrangler d1 create todo-colaco-db
```

Copy the `database_id` it prints into `d1_databases[0].database_id` in
`wrangler.jsonc`. Then create the schema:

```bash
npm run db:migrate:remote
```

### 3. Set the secrets

```bash
npx wrangler secret put APP_PATTERN          # unlock pattern, e.g. 0,3,6,7
npx wrangler secret put SESSION_SECRET       # openssl rand -hex 32
npx wrangler secret put SUPERUSER_PASSWORD   # unlocks task editing/deleting
```

`APP_PATTERN` is the dot sequence for the lock screen, as comma-separated
indices into a 3×3 grid numbered `0-8` left-to-right, top-to-bottom.

### 4. Point it at your own domain

In `wrangler.jsonc`, replace the `routes` pattern with your hostname (the
domain must already be on your Cloudflare account), and set `SITE_URL` under
`vars` to match. `SITE_URL` is used to build task links and the Telegram
webhook URL, so it must be the real public origin.

### 5. Set up email sending

Verify each recipient address as a Cloudflare Email Sending destination:

```bash
npx wrangler email routing addresses create someone@example.com
```

They must click the verification link Cloudflare emails them. Then list every
verified address in `send_email[0].allowed_destination_addresses`, and set
`ASSIGNEE_*_EMAIL` under `vars`. Sends to unverified addresses fail.

### 6. Deploy

```bash
npx wrangler deploy
```

If the Worker is connected to a Git repo through **Workers Builds**, pushing
to `master` deploys automatically and you should not run `wrangler deploy`
by hand.

> **Migrations do not run on deploy.** Any push that adds a migration needs
> `npm run db:migrate:remote` alongside it, or the new code will query
> columns that don't exist yet.

---

## Setting up Telegram (optional)

Email works without any of this. Telegram adds resolve-from-the-notification
buttons.

### 1. Create the bot

In the Telegram app, open **@BotFather** → `/newbot`. Give it a display name
and a username ending in `bot`. It replies with a token.

### 2. Set the secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN        # from BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # openssl rand -hex 32
```

`TELEGRAM_WEBHOOK_SECRET` is yours to invent. Telegram echoes it back in the
`X-Telegram-Bot-Api-Secret-Token` header on every webhook call, which is what
authenticates that endpoint — it sits outside the session middleware because
Telegram has no cookie.

### 3. Register the webhook

Deploy, then open **/settings** and click **Register webhook**. This verifies
the token, caches the bot's `@username`, and tells Telegram to deliver updates
to `<SITE_URL>/telegram/webhook`. The card shows live health afterwards.

Until this is done the bot can send messages but receives nothing — button
taps do nothing.

### 4. Link each person

A Telegram bot **cannot message someone first**; they have to start the chat.
So in **/settings**, enter each person's `@username` or phone number, then
send them their generated invite link. When they open it and tap **Start**
they're bound automatically. Someone with a phone number configured can
instead tap **Share my number** in the chat.

Once linked, switch their **Deliver lists by** to Telegram, and use
**Send test** to confirm before trusting it with a real list.

---

## Resolving a task

A task can be resolved from the Telegram buttons, from the one-time link in
the email, or by a superuser on the dashboard. All three paths write to D1
and re-render the Telegram message, so no surface ever disagrees.

**Rejecting requires a reason.** Done is one tap; Reject asks why first —
in Telegram the button opens a prompt you reply to, and on the web the form
won't submit without it. Enforced server-side too, so it holds regardless of
the caller.

---

## Local development

```bash
npm run dev            # http://localhost:8787
```

Local secrets go in `.dev.vars` (gitignored), same keys as above. Seed the
local database with:

```bash
npm run db:migrate:local
```

> Stop `wrangler dev` before running a local migration. A running dev server
> holds its own copy of the database and flushes it on shutdown, which
> silently reverts a migration applied while it was up.

Telegram can't reach `localhost`, so the webhook won't fire locally. Point
`SITE_URL` at a tunnel if you need to exercise it end to end.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local server |
| `npm run types` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |
| `npm run db:migrate:local` | Apply migrations locally |
| `npm run db:migrate:remote` | Apply migrations to production |
| `npx wrangler secret list` | Show which secrets are set |
| `npx wrangler tail` | Live production logs |
