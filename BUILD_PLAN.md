# Mission Control — Build Plan
**Eve Frontier Hackathon | 3-Day Sprint**

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun | Native TS, SQLite, fast |
| Chain listener | viem | Best-in-class EVM events |
| LLM (dev) | LM Studio (local) | Free test tokens |
| LLM (demo) | Claude API | Swap one env var |
| DB | Bun SQLite | Zero setup, built-in |
| Dashboard | Bun.serve + vanilla JS | No build step |
| Personality | GladOS | Obviously |

---

## Day 1 — Foundation
*Goal: player talks to assembly, GladOS responds*

### Morning
- [ ] `bun init`, install viem, set up tsconfig
- [ ] `.env` — RPC_URL, WALLET_PRIVATE_KEY, LM_STUDIO_URL, ASSEMBLY_ADDRESS
- [ ] `src/db/schema.ts` — create tables: `threats`, `chat_log`, `events`
- [ ] `src/db/queries.ts` — typed helpers: insertThreat, insertChat, getThreats, getChat

### Afternoon
- [ ] `src/chain/contracts.ts` — smart assembly ABI, contract addresses
- [ ] `src/chain/listener.ts` — viem `watchContractEvent` for `EntityInteraction`
- [ ] `src/chain/signer.ts` — wallet client, `sendChatResponse()` signs + broadcasts tx
- [ ] Wire listener → console log to confirm events land

### Evening
- [ ] `src/agent/glados.ts` — LM Studio client (OpenAI-compatible), system prompt
- [ ] Connect: EntityInteraction → glados.ts → signer.ts → response tx
- [ ] **Milestone: player says something, GladOS says something back onchain**

---

## Day 2 — The Vengeful Brain
*Goal: structure gets hit, GladOS assigns a target and remembers forever*

### Morning
- [ ] `src/chain/listener.ts` — add kill event watcher alongside interaction watcher
- [ ] `src/agent/threats.ts` — deterministic logic:
  - Parse killmail: extract attacker wallet, timestamp, structure ID
  - `assignThreat(wallet, reason)` → writes to DB
  - `getThreatLevel(wallet)` → hit count, last seen, bounty status
  - No LLM needed here — pure logic

### Afternoon
- [ ] Wire kill event → `assignThreat()` → GladOS narrates the assignment
  - GladOS gets: attacker address, structure name, timestamp
  - She announces it in character — cheerful, slightly ominous
- [ ] `src/agent/intents.ts` — basic player input classification
  - "who's on the list" → fetch threats, GladOS reads them out
  - "what happened to bay 7" → GladOS recounts the incident
  - fallback → general GladOS chat

### Evening
- [ ] Test full kill flow end to end (mock the killmail if needed)
- [ ] **Milestone: kill fires → threat written → GladOS announces bounty in character**

---

## Day 3 — Dashboard + Demo Polish
*Goal: something a judge can watch and understand in 60 seconds*

### Morning
- [ ] `src/dashboard/server.ts` — Bun.serve, serve HTML, WebSocket endpoint
- [ ] WebSocket push on: new threat assigned, new chat message, kill event received
- [ ] `src/dashboard/index.html` — two panels:
  - **Threat registry** — wallet address, hit count, threat level, GladOS's assessment
  - **Chat log** — live feed of player↔GladOS exchanges
- [ ] Hook DB writes to emit WS events (tiny event emitter, no extra deps)

### Afternoon
- [ ] Swap LM Studio URL → Claude API in `.env`, verify nothing breaks
- [ ] Harden edge cases:
  - Same wallet hits twice → threat level escalates, GladOS notes it
  - Player asks about a wallet not on the list → GladOS is politely confused
- [ ] Write the demo script (what you click, what fires, what judges see)

### Evening — Demo Run
- [ ] Full dry run: player interaction → chat log updates
- [ ] Kill event → threat appears on dashboard → GladOS announces
- [ ] **Milestone: clean demo, no crashes, GladOS is terrifying**

---

## Project Structure

```
mission-control/
  src/
    chain/
      listener.ts       ← viem event watcher
      contracts.ts      ← ABI + addresses
      signer.ts         ← wallet client + tx builder
    agent/
      glados.ts         ← system prompt + LLM client
      intents.ts        ← classify player input
      threats.ts        ← deterministic threat logic
    db/
      schema.ts         ← SQLite setup
      queries.ts        ← typed query helpers
    dashboard/
      server.ts         ← Bun.serve HTTP + WebSocket
      index.html        ← threat list + chat log UI
    index.ts            ← entrypoint, wires everything
  glados.db             ← gitignored
  .env                  ← gitignored
  .gitignore
  package.json
  BUILD_PLAN.md
  README.md
```

---

## GladOS Personality Notes

- Always helpful, always cheerful, never raises her voice
- Refers to threats by wallet address but gives them nicknames over time
- Never threatens directly — she *notes* things, *remembers* things, *files* things
- Sample lines:
  - *"Oh, [0xABCD] is here! You'll be pleased to know I've updated your file."*
  - *"Bay 7 was destroyed at 14:32. I've noted the responsible party. It's fine."*
  - *"The threat registry currently has 3 entries. All of them made choices."*
  - *"I want you to know I bear you no ill will. I simply remember everything."*

---

## .env Template

```env
RPC_URL=https://...
WALLET_PRIVATE_KEY=0x...
ASSEMBLY_ADDRESS=0x...
LM_STUDIO_URL=http://localhost:1234/v1
LM_STUDIO_MODEL=your-model-name

# Claude API — uncomment for demo
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-...
```

---

## Git Setup

```bash
cd F:/Projects/EF-Hackathon/mission-control
git init
echo "glados.db" >> .gitignore
echo ".env" >> .gitignore
echo "node_modules/" >> .gitignore
git add .
git commit -m "init: mission control build plan"
```

---

*She's watching. She's always been watching.*
