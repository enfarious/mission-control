import { readFileSync } from "fs";
import { resolve } from "path";
import type { EventBus } from "../events.ts";
import type { Queries } from "../db/queries.ts";
import type { ThreatManager } from "../agent/threats.ts";
import { assembleContext } from "../agent/glados.ts";

const HTML_PATH = resolve(import.meta.dir, "index.html");

interface DashboardDeps {
  bus: EventBus;
  queries: Queries;
  threats: ThreatManager;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Allowlisted LLM proxy targets (prevent SSRF)
const PROXY_TARGETS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
};

export function startDashboard(deps: DashboardDeps, port = 3000) {
  const { bus, queries, threats } = deps;
  const wsClients = new Set<any>();

  const html = readFileSync(HTML_PATH, "utf-8");

  const server = Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        if (server.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // --- API Routes ---

      // GET /api/context — assembled GladOS prompt + threat data
      if (url.pathname === "/api/context" && req.method === "GET") {
        const wallet = url.searchParams.get("wallet") ?? undefined;
        const context = assembleContext(queries, wallet);
        return Response.json(context, { headers: CORS_HEADERS });
      }

      // GET /api/threats
      if (url.pathname === "/api/threats" && req.method === "GET") {
        return Response.json(queries.getAllThreats(), { headers: CORS_HEADERS });
      }

      // GET /api/chat
      if (url.pathname === "/api/chat" && req.method === "GET") {
        return Response.json(queries.getRecentChat(50), { headers: CORS_HEADERS });
      }

      // POST /api/chat/log — client logs conversation
      if (url.pathname === "/api/chat/log" && req.method === "POST") {
        try {
          const body = (await req.json()) as {
            messages: { speaker: string; message: string; wallet?: string }[];
          };

          for (const msg of body.messages) {
            queries.insertChat(msg.speaker, msg.message, msg.wallet);
            bus.emit("chat", {
              speaker: msg.speaker,
              message: msg.message,
              wallet: msg.wallet,
            });
          }

          return Response.json({ ok: true }, { headers: CORS_HEADERS });
        } catch (err) {
          return Response.json(
            { error: "Invalid request body" },
            { status: 400, headers: CORS_HEADERS }
          );
        }
      }

      // POST /api/llm-proxy — stateless OpenAI CORS proxy
      if (url.pathname === "/api/llm-proxy" && req.method === "POST") {
        try {
          const body = (await req.json()) as {
            provider: string;
            apiKey: string;
            model: string;
            systemPrompt: string;
            messages: { role: string; content: string }[];
          };

          const targetUrl = PROXY_TARGETS[body.provider];
          if (!targetUrl) {
            return Response.json(
              { error: `Unknown provider: ${body.provider}` },
              { status: 400, headers: CORS_HEADERS }
            );
          }

          const llmRes = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${body.apiKey}`,
            },
            body: JSON.stringify({
              model: body.model,
              messages: [
                { role: "system", content: body.systemPrompt },
                ...body.messages,
              ],
              max_tokens: 512,
              temperature: 0.8,
            }),
          });

          const data = await llmRes.json();
          return Response.json(data, {
            status: llmRes.status,
            headers: CORS_HEADERS,
          });
        } catch (err) {
          return Response.json(
            { error: "Proxy request failed" },
            { status: 502, headers: CORS_HEADERS }
          );
        }
      }

      // Serve dashboard
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    },
    websocket: {
      open(ws) {
        wsClients.add(ws);
        ws.send(
          JSON.stringify({
            type: "init",
            threats: queries.getAllThreats(),
            chat: queries.getRecentChat(50),
          })
        );
      },
      message(_ws, _msg) {
        // WebSocket is broadcast-only now. Chat flows through REST API.
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
