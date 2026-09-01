import { Hono } from "hono";
import { readSessionCookie, verifySessionCookieValue } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { listsRoutes } from "./routes/lists";
import { taskLinkRoutes } from "./routes/tasks";
import { wsRoutes } from "./routes/ws";
import { superuserRoutes } from "./routes/superuser";
import { adminRoutes } from "./routes/admin";
import { createListPage } from "./views/create-list";
import { activeListsPage, completedListsPage } from "./views/dashboard";
import { getAssignees } from "./lib/assignees";

export { BroadcastHub } from "./durable-objects/broadcast-hub";

const app = new Hono<{ Bindings: Env }>();

const PUBLIC_PREFIXES = ["/t/", "/login", "/logout"];

app.use("*", async (c, next) => {
  if (PUBLIC_PREFIXES.some((p) => c.req.path === p || c.req.path.startsWith(p))) {
    return next();
  }

  const cookie = readSessionCookie(c.req.header("Cookie") ?? null);
  const valid = await verifySessionCookieValue(cookie, c.env.SESSION_SECRET);
  if (valid) return next();

  if (c.req.path.startsWith("/api/") || c.req.path === "/ws") {
    return c.json({ error: "Not authenticated." }, 401);
  }
  return c.redirect(`/login?redirect=${encodeURIComponent(c.req.path)}`, 302);
});

app.route("/", authRoutes);
app.route("/", listsRoutes);
app.route("/", taskLinkRoutes);
app.route("/", wsRoutes);
app.route("/", superuserRoutes);
app.route("/", adminRoutes);

app.get("/", (c) => c.html(createListPage(getAssignees(c.env))));
app.get("/dashboard", (c) => c.html(activeListsPage()));
app.get("/dashboard/completed", (c) => c.html(completedListsPage()));

export default app;
