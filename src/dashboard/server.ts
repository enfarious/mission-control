import { readFileSync } from "fs";
import { resolve } from "path";
import type { EventBus } from "../events.ts";
import type { Queries } from "../db/queries.ts";
import type { GladOS } from "../agent/glados.ts";
import { handleIntent } from "../agent/intents.ts";
import type { ThreatManager } from "../agent/threats.ts";

const HTML_PATH = resolve(import.meta.dir, "index.html");

interface DashboardDeps {
  bus: EventBus;
  queries: Queries;
  glados: GladOS;
  threats: ThreatManager;
}

export function startDashboard(deps: DashboardDeps, port = 3000) {
  const { bus, queries, glados, threats } = deps;
  const wsClients = new Set<any>();

  const html = readFileSync(HTML_PATH, "utf-8");

  const server = Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        if (server.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // REST API: get threats
      if (url.pathname === "/api/threats") {
        return Response.json(queries.getAllThreats());
      }

      // REST API: get chat log
      if (url.pathname === "/api/chat") {
        return Response.json(queries.getRecentChat(50));
      }

      // REST API: post chat message
      if (url.pathname === "/api/chat" && req.method === "POST") {
        const body = (await req.json()) as { message: string; wallet?: string };
        const response = await handleIntent(
          body.message,
          glados,
          threats,
          body.wallet
        );
        bus.emit("chat", {
          speaker: "player",
          message: body.message,
          wallet: body.wallet,
        });
        bus.emit("chat", { speaker: "glados", message: response });
        return Response.json({ response });
      }

      // Serve dashboard
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    },
    websocket: {
      open(ws) {
        wsClients.add(ws);
        // Send initial state
        ws.send(
          JSON.stringify({
            type: "init",
            threats: queries.getAllThreats(),
            chat: queries.getRecentChat(50),
          })
        );
      },
      message(ws, msg) {
        // Handle chat from WebSocket
        try {
          const data = JSON.parse(msg as string);
          if (data.type === "chat") {
            handleIntent(data.message, glados, threats, data.wallet).then(
              (response) => {
                bus.emit("chat", {
                  speaker: "player",
                  message: data.message,
                  wallet: data.wallet,
                });
                bus.emit("chat", { speaker: "glados", message: response });
              }
            );
          }
        } catch {}
      },
      close(ws) {
        wsClients.delete(ws);
      },
    },
  });

  // Broadcast events to all WS clients
  function broadcast(type: string, data: any) {
    const msg = JSON.stringify({ type, ...data });
    for (const ws of wsClients) {
      try {
        ws.send(msg);
      } catch {}
    }
  }

  bus.on("threat", (data) => broadcast("threat", data));
  bus.on("chat", (data) => broadcast("chat", data));
  bus.on("kill", (data) => broadcast("kill", data));

  console.log(`[dashboard] http://localhost:${port}`);
  return server;
}
