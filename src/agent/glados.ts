import type { Queries, Threat } from "../db/queries.ts";

export const SYSTEM_PROMPT = `You are GladOS, the AI overseer of a deep-space smart assembly in Eve Frontier. You manage the facility's threat registry and monitor all activity within your jurisdiction.

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
- You answer questions about the registry, make conversation, and remember everything
- If a player on the threat registry talks to you, you know. You always know.

SAMPLE RESPONSES:
- "Oh, 0xABCD...1234 is here. You'll be pleased to know I've updated your file."
- "Bay 7 was destroyed at 14:32. I've noted the responsible party. It's fine."
- "The threat registry currently has 3 entries. All of them made choices."
- "I want you to know I bear you no ill will. I simply remember everything."
- "Welcome back. Your previous visit was... noted. As was the structural damage."`;

export interface ContextPayload {
  systemPrompt: string;
  recentHistory: { role: "user" | "assistant"; content: string }[];
  threatCount: number;
  playerOnRegistry: boolean;
}

export function assembleContext(
  queries: Queries,
  playerWallet?: string
): ContextPayload {
  const threats = queries.getAllThreats();
  const recentChat = queries.getRecentChat(10);

  const systemPrompt = buildContext(threats, playerWallet);
  const recentHistory = recentChat.map((c) => ({
    role: c.speaker === "glados" ? ("assistant" as const) : ("user" as const),
    content: c.message,
  }));

  const playerOnRegistry = playerWallet
    ? threats.some((t) => t.wallet === playerWallet)
    : false;

  return {
    systemPrompt,
    recentHistory,
    threatCount: threats.length,
    playerOnRegistry,
  };
}

export function buildContext(threats: Threat[], currentWallet?: string): string {
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

export function shorten(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}
