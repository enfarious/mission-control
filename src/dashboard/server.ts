import { readFileSync } from "fs";
import { resolve } from "path";
import type { EventBus } from "../events.ts";
import type { Queries } from "../db/queries.ts";
import type { ThreatManager } from "../agent/threats.ts";
import { assembleContext, AI_NAME, AI_TAGLINE } from "../agent/glados.ts";
import { executeAction, type AIAction } from "../chain/actions.ts";
import { fetchAssemblyStatus, fetchCharacterByWallet, fetchKillStats } from "../chain/assembly.ts";

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

  // Read HTML fresh on each request in dev — no stale cache after edits
  const isDev = process.env.NODE_ENV !== "production";
  const cachedHtml = isDev ? null : readFileSync(HTML_PATH, "utf-8");
  const getHtml = () => cachedHtml ?? readFileSync(HTML_PATH, "utf-8");

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

      // GET /api/chat — optionally filtered by wallet
      if (url.pathname === "/api/chat" && req.method === "GET") {
        const wallet = url.searchParams.get("wallet");
        const chat = wallet
          ? queries.getRecentChat(50).filter(
              (c) => c.wallet === wallet || c.speaker === "ai" || c.speaker === "glados" || c.speaker === "system"
            )
          : queries.getRecentChat(50);
        return Response.json(chat, { headers: CORS_HEADERS });
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

      // POST /api/llm-models — fetch model list from a local/custom LLM endpoint
      if (url.pathname === "/api/llm-models" && req.method === "POST") {
        try {
          const body = (await req.json()) as { baseUrl: string; apiKey?: string };
          const modelsUrl = body.baseUrl.replace(/\/+$/, "") + "/models";

          const headers: Record<string, string> = {};
          if (body.apiKey) headers["Authorization"] = `Bearer ${body.apiKey}`;

          const modelsRes = await fetch(modelsUrl, { headers });
          const data = await modelsRes.json();
          return Response.json(data, {
            status: modelsRes.status,
            headers: CORS_HEADERS,
          });
        } catch (err) {
          return Response.json(
            { error: "Failed to fetch models: " + (err as Error).message },
            { status: 502, headers: CORS_HEADERS }
          );
        }
      }

      // POST /api/llm-proxy — stateless CORS proxy for LLM providers
      if (url.pathname === "/api/llm-proxy" && req.method === "POST") {
        try {
          const body = (await req.json()) as {
            provider: string;
            apiKey?: string;
            baseUrl?: string;
            model: string;
            maxTokens?: number;
            systemPrompt: string;
            messages: { role: string; content: string }[];
          };

          // Resolve target URL: known providers use fixed URLs, others pass baseUrl
          let targetUrl = PROXY_TARGETS[body.provider];
          if (!targetUrl && body.baseUrl) {
            // Custom/local: append /chat/completions if not already there
            targetUrl = body.baseUrl.endsWith("/chat/completions")
              ? body.baseUrl
              : body.baseUrl.replace(/\/+$/, "") + "/chat/completions";
          }
          if (!targetUrl) {
            return Response.json(
              { error: `No target URL for provider: ${body.provider}` },
              { status: 400, headers: CORS_HEADERS }
            );
          }

          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (body.apiKey) {
            headers["Authorization"] = `Bearer ${body.apiKey}`;
          }

          const llmRes = await fetch(targetUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: body.model,
              messages: [
                { role: "system", content: body.systemPrompt },
                ...body.messages,
              ],
              max_tokens: body.maxTokens || 2048,
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
            { error: "Proxy request failed: " + (err as Error).message },
            { status: 502, headers: CORS_HEADERS }
          );
        }
      }

      // GET /api/assembly — fetch assembly status from Sui
      if (url.pathname === "/api/assembly" && req.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) {
          return Response.json({ error: "Missing ?id param" }, { status: 400, headers: CORS_HEADERS });
        }
        const status = await fetchAssemblyStatus(id);
        return Response.json(status ?? { error: "Not found" }, { headers: CORS_HEADERS });
      }

      // GET /api/player — character lookup + visit recording
      if (url.pathname === "/api/player" && req.method === "GET") {
        const wallet = url.searchParams.get("wallet");
        if (!wallet) {
          return Response.json({ error: "Missing ?wallet param" }, { status: 400, headers: CORS_HEADERS });
        }
        const character = await fetchCharacterByWallet(wallet);
        const stats = character?.characterId
          ? await fetchKillStats(character.characterId)
          : { kills: 0, deaths: 0 };

        // Record visit + update tribe stats
        queries.upsertVisitor(wallet, {
          characterId: character?.characterId,
          name: character?.name,
          tribeId: character?.tribeId,
          kills: stats.kills,
          deaths: stats.deaths,
        });

        if (character?.tribeId) {
          queries.upsertTribe(character.tribeId, stats.kills, stats.deaths);
        }

        // Enrich with local reputation data
        const visitor = queries.getVisitor(wallet);
        const tribe = character?.tribeId ? queries.getTribe(character.tribeId) : null;
        const threat = queries.getAllThreats().find((t: any) => t.wallet === wallet);

        return Response.json({
          ...character,
          ...stats,
          visitCount: visitor?.visit_count ?? 1,
          reputation: visitor?.reputation ?? 50,
          aiNotes: visitor?.ai_notes,
          onThreatRegistry: !!threat,
          threatLevel: threat?.threat_level,
          tribe: tribe ? {
            tribeId: tribe.tribe_id,
            memberVisits: tribe.member_visits,
            totalKills: tribe.total_kills,
            totalDeaths: tribe.total_deaths,
            reputation: tribe.reputation,
            aiNotes: tribe.ai_notes,
          } : null,
        }, { headers: CORS_HEADERS });
      }

      // POST /api/actions/execute — execute AI-decided onchain actions
      if (url.pathname === "/api/actions/execute" && req.method === "POST") {
        try {
          const body = (await req.json()) as {
            actions: AIAction[];
            assemblyId: string;
          };

          const results = [];
          for (const action of body.actions) {
            // Handle reputation actions locally (no onchain tx needed)
            if (action.type === "set_reputation" && action.target) {
              const value = (action as any).value ?? 50;
              const notes = (action as any).notes;
              queries.updateVisitorReputation(action.target, value, notes);
              results.push({ type: action.type, result: `Reputation set to ${value}` });
              bus.emit("action", { ...action, result: `Reputation → ${value}` });
              continue;
            }
            if (action.type === "set_tribe_reputation") {
              const tribeId = (action as any).tribe_id;
              const value = (action as any).value ?? 50;
              const notes = (action as any).notes;
              if (tribeId) queries.updateTribeReputation(tribeId, value, notes);
              results.push({ type: action.type, result: `Tribe ${tribeId} reputation set to ${value}` });
              bus.emit("action", { ...action, result: `Tribe reputation → ${value}` });
              continue;
            }

            const result = await executeAction(action, body.assemblyId);
            results.push(result);
            bus.emit("action", { ...action, ...result });
          }

          return Response.json({ results }, { headers: CORS_HEADERS });
        } catch (err) {
          return Response.json(
            { error: (err as Error).message },
            { status: 500, headers: CORS_HEADERS }
          );
        }
      }

      // Serve dashboard
      return new Response(getHtml(), {
        headers: { "Content-Type": "text/html" },
      });
    },
    websocket: {
      open(ws) {
        wsClients.add(ws);
        ws.send(
          JSON.stringify({
            type: "init",
            aiName: AI_NAME,
            aiTagline: AI_TAGLINE,
            threats: queries.getAllThreats(),
            // Chat history is fetched per-player after wallet identification
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
  bus.on("action", (data) => broadcast("action", data));

  console.log(`[dashboard] http://localhost:${port}`);
  return server;
}
