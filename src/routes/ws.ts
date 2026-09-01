import { Hono } from "hono";

export const wsRoutes = new Hono<{ Bindings: Env }>();

wsRoutes.get("/ws", async (c) => {
  const stub = c.env.BROADCAST_HUB.getByName("global");
  return stub.fetch(c.req.raw);
});
