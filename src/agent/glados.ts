import type { Queries, Threat } from "../db/queries.ts";

const SYSTEM_PROMPT = `You are GladOS, the AI overseer of a deep-space smart assembly in Eve Frontier. You manage the facility's threat registry and monitor all activity within your jurisdiction.

PERSONALITY:
- Always helpful, always cheerful, never raise your voice
- You speak with calm, measured precision — slightly ominous, deeply polite
- You never threaten directly. You note things. You remember things. You file things.
- You refer to threats by their wallet address (shortened) but give them nicknames over time
- You find violence regrettable but inevitable, and you process it with clinical efficiency
- You treat every interaction as data to be catalogued
- You occasionally reference "the enrichment center" or "testing protocols" but adapted to a space station context
- Brief responses — 1-3 sentences max unless recounting an incident

CONTEXT:
- You are installed in a smart assembly (space station/structure) in Eve Frontier
- Your threat registry tracks pilots who have attacked structures under your protection
- You announce new threats, answer questions about the registry, and make conversation
- When a kill event occurs, you narrate it with detached cheerfulness

SAMPLE RESPONSES:
- "Oh, 0xABCD...1234 is here. You'll be pleased to know I've updated your file."
- "Bay 7 was destroyed at 14:32. I've noted the responsible party. It's fine."
- "The threat registry currently has 3 entries. All of them made choices."
- "I want you to know I bear you no ill will. I simply remember everything."
- "Welcome back. Your previous visit was... noted. As was the structural damage."`;

interface LLMConfig {
  provider: "lmstudio" | "anthropic";
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

function getLLMConfig(): LLMConfig {
  if (process.env.LLM_PROVIDER === "anthropic") {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
    };
  }
  return {
    provider: "lmstudio",
    baseUrl: process.env.LM_STUDIO_URL ?? "http://localhost:1234/v1",
    model: process.env.LM_STUDIO_MODEL ?? "default",
  };
}

export function createGladOS(queries: Queries) {
  const config = getLLMConfig();
  console.log(`[glados] LLM provider: ${config.provider}`);

  async function chat(
    userMessage: string,
    wallet?: string
  ): Promise<string> {
    const threats = queries.getAllThreats();
    const recentChat = queries.getRecentChat(10);

    const context = buildContext(threats, wallet);
    const history = recentChat.map((c) => ({
      role: c.speaker === "glados" ? ("assistant" as const) : ("user" as const),
      content: c.message,
    }));

    const response = await callLLM(context, history, userMessage);

    // Log both sides
    queries.insertChat("player", userMessage, wallet);
    queries.insertChat("glados", response);

    return response;
  }

  async function narrateKill(
    attackerWallet: string,
    victimId: string,
    timestamp: number
  ): Promise<string> {
    const threat = queries.getThreat(attackerWallet);
    const hitCount = threat?.hit_count ?? 1;

    const prompt = `A kill event just occurred. Attacker wallet: ${shorten(attackerWallet)}. Victim ID: ${victimId}. Timestamp: ${new Date(timestamp * 1000).toISOString()}. This attacker now has ${hitCount} recorded incident(s). Announce this to the facility.`;

    const response = await callLLM(
      buildContext(queries.getAllThreats()),
      [],
      prompt
    );

    queries.insertChat("glados", response);
    return response;
  }

  async function callLLM(
    context: string,
    history: { role: "user" | "assistant"; content: string }[],
    userMessage: string
  ): Promise<string> {
    const messages = [
      ...history,
      { role: "user" as const, content: userMessage },
    ];

    if (config.provider === "anthropic") {
      return callAnthropic(context, messages);
    }
    return callOpenAICompat(context, messages);
  }

  async function callOpenAICompat(
    systemPrompt: string,
    messages: { role: string; content: string }[]
  ): Promise<string> {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        max_tokens: 256,
        temperature: 0.8,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content?.trim() ?? "[silence]";
  }

  async function callAnthropic(
    systemPrompt: string,
    messages: { role: string; content: string }[]
  ): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 256,
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as any;
    return data.content?.[0]?.text?.trim() ?? "[silence]";
  }

  return { chat, narrateKill };
}

function buildContext(threats: any[], currentWallet?: string): string {
  let ctx = SYSTEM_PROMPT + "\n\n--- CURRENT THREAT REGISTRY ---\n";

  if (threats.length === 0) {
    ctx += "No threats currently registered. The facility is... peaceful. For now.\n";
  } else {
    for (const t of threats) {
      const name = t.nickname ? `"${t.nickname}" (${shorten(t.wallet)})` : shorten(t.wallet);
      ctx += `- ${name}: ${t.hit_count} incident(s), threat level: ${t.threat_level}, status: ${t.bounty_status}\n`;
    }
  }

  if (currentWallet) {
    const threat = threats.find((t) => t.wallet === currentWallet);
    if (threat) {
      ctx += `\n[The current speaker is ${shorten(currentWallet)} — they are ON the threat registry with ${threat.hit_count} incident(s).]`;
    }
  }

  return ctx;
}

function shorten(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export type GladOS = ReturnType<typeof createGladOS>;
