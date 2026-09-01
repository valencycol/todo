import { Hono } from "hono";
import {
  createSuperuserCookieValue,
  superuserCookieHeader,
  clearSuperuserCookieHeader,
  verifySuperuserCookieValue,
  readSuperuserCookie,
} from "../lib/session";
import { isLoginLockedOut, recordFailedLogin, resetLoginAttempts } from "../lib/db";

export const superuserRoutes = new Hono<{ Bindings: Env }>();

export async function isSuperuserRequest(c: { req: { header: (name: string) => string | undefined }; env: Env }): Promise<boolean> {
  const cookie = readSuperuserCookie(c.req.header("Cookie") ?? null);
  return verifySuperuserCookieValue(cookie, c.env.SESSION_SECRET);
}

superuserRoutes.get("/api/superuser", async (c) => {
  return c.json({ active: await isSuperuserRequest(c) });
});

superuserRoutes.post("/api/superuser", async (c) => {
  const body = await c.req.json<{ action?: string; password?: string }>().catch(() => ({}) as Record<string, never>);

  if (body.action === "disable") {
    c.header("Set-Cookie", clearSuperuserCookieHeader());
    return c.json({ ok: true, active: false });
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  if (await isLoginLockedOut(c.env.DB, ip)) {
    return c.json({ error: "Too many attempts. Try again in a few minutes." }, 429);
  }

  if (!body.password || body.password !== c.env.SUPERUSER_PASSWORD) {
    await recordFailedLogin(c.env.DB, ip);
    return c.json({ error: "Wrong password." }, 401);
  }

  await resetLoginAttempts(c.env.DB, ip);
  const cookieValue = await createSuperuserCookieValue(c.env.SESSION_SECRET);
  c.header("Set-Cookie", superuserCookieHeader(cookieValue));
  return c.json({ ok: true, active: true });
});
