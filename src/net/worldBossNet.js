import { net } from './NetworkManager.js';
import { bus, Events } from '../core/events.js';

// Client wiring for server-authoritative world boss (server/worldBoss.js).
// Incoming:
//   worldboss-announce { area, x, y, name, expiresAt, hp, maxHp }
//   worldboss-state    { active, area?, x?, y?, name?, expiresAt?, hp?, maxHp?, nextSpawn? }
//   worldboss-slain    { name, killerName, contributors:[{name, damage}] }
// Outgoing: none (damage is relayed through normal hit/ehit).

let announcedActive = false;

export function installWorldBossNet() {
  net.on('worldboss-announce', (m) => {
    announcedActive = true;
    const area = m.area || 'ruins';
    const name = m.name || 'World Boss';
    bus.emit(Events.SYSTEM, `[World Boss] ${name} has awoken in ${area.toUpperCase()}!`);
    bus.emit(Events.WORLDBOSS_SPAWN, m);
  });

  net.on('worldboss-state', (m) => {
    if (!m?.active) { announcedActive = false; return; }
    if (!announcedActive) {
      announcedActive = true;
      bus.emit(Events.SYSTEM, `[World Boss] ${m.name} is active in ${(m.area || 'ruins').toUpperCase()}!`);
      bus.emit(Events.WORLDBOSS_SPAWN, m);
    }
  });

  net.on('worldboss-slain', (m) => {
    announcedActive = false;
    const names = (m.contributors || []).map((c) => c.name).filter(Boolean);
    const top = names.slice(0, 3).join(', ') || 'brave fighters';
    bus.emit(Events.SYSTEM, `[World Boss] ${m.name} was slain by ${m.killerName || 'a hero'}! Top damage: ${top}.`);
    bus.emit(Events.TOAST, { title: 'World Boss Slain', text: `${m.name} falls!`, color: '#ffd84a' });
    bus.emit(Events.WORLDBOSS_SLAIN, m);
  });

  // attach on every reconnect
  net.onAttach?.(() => {
    // state is resent by server onJoin after reconnect
  });
}

if (typeof window !== 'undefined') installWorldBossNet();
