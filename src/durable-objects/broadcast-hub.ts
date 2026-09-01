import { DurableObject } from "cloudflare:workers";

/**
 * Singleton hub (always accessed via getByName("global")). Holds no
 * business data — D1 is the source of truth. Just fans out a "something
 * changed, go refetch" ping to every connected dashboard WebSocket.
 */
export class BroadcastHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async broadcast(event: { type: string }): Promise<void> {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // socket is gone; hibernation cleanup handles it
      }
    }
  }

  async webSocketMessage(): Promise<void> {
    // Dashboard clients are receive-only; nothing to do with inbound messages.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    try {
      ws.close(wasClean ? code : 1011, reason);
    } catch {
      // already closed
    }
  }
}
