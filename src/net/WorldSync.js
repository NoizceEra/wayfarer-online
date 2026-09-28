import { bus, Events } from '../core/events.js';
import { RemotePlayer } from '../entities/RemotePlayer.js';
import { net } from './NetworkManager.js';

// Glues WorldScene to the relay with 3 calls: attach(scene, player),
// pushPos(x,y,facing,hp), pushEnemies(list). Guests apply host snapshots.
export class WorldSync {
  attach(scene, player, hero) {
    this.scene = scene; this.player = player;
    this.remotes = new Map();
    this.off = [
      bus.on(Events.NET_PLAYER_JOINED, ({ id, name, hero: h }) => this.addRemote(id, name, h || hero)),
      bus.on(Events.NET_PLAYER_LEFT, ({ id }) => {
        this.remotes.get(id)?.destroy(); this.remotes.delete(id);
      }),
      bus.on(Events.NET_STATE, (m) => this.onState(m)),
    ];
    // Reconcile peers that joined before world entry (common: lobby happens
    // on the title screen, world loads after).
    net.peers.forEach(({ name, hero: h }, id) => this.addRemote(id, name, h || hero));
    this.acc = 0;
  }
  addRemote(id, name, hero) {
    if (!id || id === net.sessionId || this.remotes.has(id)) return;
    const r = new RemotePlayer(this.scene, name, hero);
    this.remotes.set(id, r);
  }
  onState(m) {
    if (m.kind === 'input' && m.sessionId !== net.sessionId) {
      this.remotes.get(m.sessionId)?.remoteSet(m.x, m.y, m.facing, m.hp);
    } else if (m.kind === 'hostSnapshot' && !net.isHost) {
      this.scene.applyHostSnapshot?.(m.enemies);
    } else if (m.kind === 'hero' && m.sessionId !== net.sessionId) {
      this.remotes.get(m.sessionId)?.setHero(m.hero);
    }
  }
  update(dt) {
    this.remotes.forEach((r) => r.update());
    if (!net.connected) return;
    this.acc += dt;
    if (this.acc > 0.1) {
      this.acc = 0;
      net.sendPos(this.player.x, this.player.y, this.player.facing, this.player.hp);
    }
  }
  destroy() { this.off?.forEach((f) => f()); this.remotes.forEach((r) => r.destroy()); }
}
