import type { GladOS } from "./glados.ts";
import type { ThreatManager } from "./threats.ts";

export type Intent =
  | { type: "list_threats" }
  | { type: "check_threat"; wallet: string }
  | { type: "general_chat"; message: string };

const WALLET_PATTERN = /0x[a-fA-F0-9]{6,40}/;

export function classifyIntent(message: string): Intent {
  const lower = message.toLowerCase();

  if (
    lower.includes("list") ||
    lower.includes("who") ||
    lower.includes("threats") ||
    lower.includes("registry") ||
    lower.includes("all") ||
    lower.includes("on the list")
  ) {
    return { type: "list_threats" };
  }

  const walletMatch = message.match(WALLET_PATTERN);
  if (
    walletMatch &&
    (lower.includes("who is") ||
      lower.includes("check") ||
      lower.includes("status") ||
      lower.includes("threat level"))
  ) {
    return { type: "check_threat", wallet: walletMatch[0] };
  }

  return { type: "general_chat", message };
}

export async function handleIntent(
  message: string,
  glados: GladOS,
  threats: ThreatManager,
  wallet?: string
): Promise<string> {
  const intent = classifyIntent(message);

  switch (intent.type) {
    case "list_threats": {
      const allThreats = threats.getAllThreats();
      const context =
        allThreats.length === 0
          ? "A player asked about the threat registry. It's currently empty."
          : `A player asked about the threat registry. There are ${allThreats.length} entries. Summarize them in character.`;
      return glados.chat(context, wallet);
    }
    case "check_threat": {
      const threat = threats.getThreatLevel(intent.wallet);
      const context = threat
        ? `A player asked about wallet ${intent.wallet}. They have ${threat.hit_count} incident(s), threat level: ${threat.threat_level}. Respond in character.`
        : `A player asked about wallet ${intent.wallet}. They are NOT on the threat registry. Respond in character — you're politely confused.`;
      return glados.chat(context, wallet);
    }
    case "general_chat":
      return glados.chat(message, wallet);
  }
}
