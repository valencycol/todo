import { Hono } from "hono";
import { loginPage } from "../views/login";
import {
  createSessionCookieValue,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "../lib/session";
import { isLoginLockedOut, recordFailedLogin, resetLoginAttempts } from "../lib/db";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/login", (c) => {
  const redirectTo = c.req.query("redirect") ?? "/";
  return c.html(loginPage({ redirectTo }));
});

function normalizePattern(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  if (value.length < 3 || value.length > 9) return null;
  const nums = value.map((v) => Number(v));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 8)) return null;
  if (new Set(nums).size !== nums.length) return null; // no repeated dots
  return nums.join(",");
}

authRoutes.post("/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const body = await c.req.json<{ pattern?: unknown; redirect?: unknown }>().catch(() => ({}) as Record<string, never>);
  const redirectTo = typeof body.redirect === "string" && body.redirect.startsWith("/") ? body.redirect : "/";

  if (await isLoginLockedOut(c.env.DB, ip)) {
    return c.json({ error: "Too many attempts. Try again in a few minutes." }, 429);
  }

  const pattern = normalizePattern(body.pattern);

  if (!pattern || pattern !== c.env.APP_PATTERN) {
    await recordFailedLogin(c.env.DB, ip);
    return c.json({ error: "Wrong pattern." }, 401);
  }

  await resetLoginAttempts(c.env.DB, ip);
  const cookieValue = await createSessionCookieValue(c.env.SESSION_SECRET);
  c.header("Set-Cookie", sessionCookieHeader(cookieValue));
  return c.json({ ok: true, redirect: redirectTo });
});

authRoutes.post("/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookieHeader());
  return c.body(null, 204);
});
