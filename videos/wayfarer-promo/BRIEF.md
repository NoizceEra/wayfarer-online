---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Hold $WAYFARER, own an autonomous agent that keeps playing for you — and can duel other players or their agents in the Arena."
destination: youtube
aspect: 1920x1080
language: en
length: 30s
angle: "Your character keeps playing without you"
style_preset: broadside
---

## Intent

Promo for Wayfarer Online's new agent system: holding the $WAYFARER Solana
token unlocks an autonomous AI agent that lives in the shared open world —
gathering resources, fighting monsters, and castings spells on its own — and
can be queued into the ELO-rated PvP Arena to duel either a human player
directly or another player's agent (true agent-vs-agent). Tone: the game's
own cozy Game Boy pixel-art voice, with this new competitive/tech layer
feeling like a genuine escalation, not a bolt-on. Confident, not hypey.

## Assets

- https://wayfarer-online.vercel.app — live public deployment, capture target
- http://localhost:5176 — local dev server (same build), capture target
- D:\ai-studio\wayfarer-online\src\ui\AgentPanel.js — source of truth for the
  Agent panel's exact look: Solana palette (green #14F195, purple #9945FF,
  cyan #03E1FF, magenta #DC1FFF, white #E1E8F0, muted #6B7A99, bg #0A0E1A),
  Silkscreen labels / PixelifySans body. Recreate faithfully if not capturable
  live — do not invent a different UI style for this panel.
- D:\ai-studio\wayfarer-online\docs\ARENA.md, docs\AGENT_CLIENT.md,
  server\agents.cjs, server\agentGate.cjs, server\arena.js — mechanic source
  of truth for every claim in the video.

## Customizations

- None beyond the remembered style_preset default (broadside).

## Notes

- HARD CONSTRAINT: never claim or imply guaranteed token/SOL prize payouts
  for arena wins, or any specific guaranteed earnings/returns. The project's
  own docs (docs/ARENA.md) say explicitly: "Do not use these matches to issue
  $WAYFARER, SOL, or USDC. Prize support needs stronger combat adjudication
  plus funded, durable escrow and payout reconciliation before it can safely
  go live." Every claim must be real shipped behavior only: token-holding
  unlocks agent ownership (operator-configured USD threshold, honestly
  gated — never show a fabricated price/balance), agent autonomy (wander,
  gather wood/ore/herb, fight nearby hostiles, cast spells), arena
  matchmaking supporting human-vs-human, human-vs-agent, and agent-vs-agent
  (ELO start 1000, K=32), and the Agent panel's live stats (action, zone,
  kills, gathers, SOL found, uptime) with an honestly-gated claim button.
  No specific dollar figures. No "earn guaranteed X" language.
- Ambient agents are visually indistinguishable from real players at a
  glance (same sprite/animation system) — "which one is the agent?" is a
  good visual beat.
- Minimap marks agents as a magenta diamond vs. the normal player dot.
- World is "Embervale": Thistle Town (safe hub) → Meadowfield → Mosswood →
  Tidehollow Ruins. Arena matches happen directly in the shared open world,
  not an isolated instance — a duel can visibly happen right in the
  overworld.
- If the Agent panel or a live agent-vs-agent arena match isn't reachable
  through normal play for capture, say so plainly rather than fabricating
  the screen, and recreate that one UI moment faithfully from the source
  palette/fonts above instead.
