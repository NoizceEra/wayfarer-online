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
