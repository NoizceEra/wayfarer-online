// Tiny event bus (append-only — add new events, never rename).
export const Events = {
  CHAT: 'chat',
  SYSTEM: 'system',
  PLAYER_HP: 'player-hp',
  PLAYER_XP: 'player-xp',
  QUEST: 'quest',
  ZONE: 'zone',
  TIME: 'time',
  NET_CONNECTED: 'net-connected',
  NET_PLAYER_JOINED: 'net-player-joined',
  NET_PLAYER_LEFT: 'net-player-left',
  NET_STATE: 'net-state',
  NET_DISCONNECTED: 'net-disconnected',
  GEAR: 'gear',
  SHOP: 'shop',
  LOOT: 'loot',
  LEVEL_UP: 'level-up',   // {level, statPoints, skillPoints, needsClass}
  PROGRESS: 'progress',   // stat/skill/class changed -> HUD refresh
  // ── social (src/systems/social) ──
  KILL: 'kill',                   // {xp, x, y, typeId} emitted by combat when the local player slays an enemy
  SOCIAL_CHAT: 'social-chat',     // {ch, from, name, text, ts, guild} every chat line shown in the chat panel
  SOCIAL_PARTY: 'social-party',   // {id, leader, members:[{id,name,...}]} party roster changed
  SOCIAL_EMOTE: 'social-emote',   // {from, name, id} an emote to play (local or remote)
  SOCIAL_ROSTER: 'social-roster', // online player list changed
  SOCIAL_UI: 'social-ui',         // {panel:'chat'|'party'|'friends'|'emotes', open:boolean}
  NET_STATUS: 'net-status',       // {status: offline|connecting|online|reconnecting, ping, players, room}
  NET_RECONNECTED: 'net-reconnected', // {resumed: bool} seat resumed (true) or fresh rejoin (false)
  JOURNAL: 'journal',     // {open:true|false|'toggle', tab?} journal panel (L)
  CRAFT: 'craft',         // {open:true|false|'toggle', station?} crafting panel (U)
  TOAST: 'toast',         // {title, text, color?, icon?} achievement / quest toasts
  QUEST_CHANGED: 'quest-changed', // quest log / markers / tracker changed
  ACH_EVENT: 'ach-event', // {k, n?} internal achievement counters
  FISH: 'fish',           // {spot} start the fishing mini-game
};

export class Bus {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.map.get(ev)?.delete(fn);
  }
  emit(ev, payload) { this.map.get(ev)?.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); }
}

export const bus = new Bus();
