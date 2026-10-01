// Achievements-lite: 22 achievements, event-driven counters, toasts.
// State: meta.ach = {id: unlockTimestamp}, meta.counters = {name: n}, meta.visited.
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';

const MAPS = ['town', 'meadow', 'woods', 'ruins', 'dock', 'crypt', 'frost'];
const WAYS = ['town', 'dock', 'frost'];
const FRONTIER = ['desert', 'marsh', 'caverns', 'hollow'];
const WAYS6 = ['town', 'dock', 'frost', 'desert', 'marsh', 'caverns'];
const C = (id, name, desc, test, prog) => ({ id, name, desc, test, prog });

export const ACHIEVEMENTS = [
  C('first_blood', 'First Blood', 'Defeat your first monster.', (x) => x.c.kills >= 1, (x) => [x.c.kills || 0, 1]),
  C('hunter', 'Monster Hunter', 'Defeat 100 monsters.', (x) => x.c.kills >= 100, (x) => [x.c.kills || 0, 100]),
  C('lv5', 'Getting the Hang of It', 'Reach level 5.', (x) => x.level >= 5, (x) => [x.level, 5]),
  C('lv10', 'Seasoned Wayfarer', 'Reach level 10.', (x) => x.level >= 10, (x) => [x.level, 10]),
  C('lv20', 'Veteran', 'Reach level 20.', (x) => x.level >= 20, (x) => [x.level, 20]),
  C('gold100', 'Pocket Change', 'Hold 100 gold at once.', (x) => x.gold >= 100, (x) => [x.gold, 100]),
  C('gold1000', 'Nest Egg', 'Hold 1000 gold at once.', (x) => x.gold >= 1000, (x) => [x.gold, 1000]),
  C('first_quest', 'Errand Runner', 'Complete your first quest.', (x) => x.c.quests >= 1, (x) => [x.c.quests || 0, 1]),
  C('quests10', 'Reliable Hand', 'Complete 10 quests.', (x) => x.c.quests >= 10, (x) => [x.c.quests || 0, 10]),
  C('chain_done', 'Storyteller', 'Finish a questline.', (x) => x.c.chains >= 1, (x) => [x.c.chains || 0, 1]),
  C('bounty_first', 'Bounty Hunter', 'Complete a notice-board bounty.', (x) => x.c.bounties >= 1, (x) => [x.c.bounties || 0, 1]),
  C('gather_first', 'Green Thumb', 'Gather your first resource.', (x) => x.c.gathers >= 1, (x) => [x.c.gathers || 0, 1]),
  C('gather_50', 'Forager', 'Gather 50 resources.', (x) => x.c.gathers >= 50, (x) => [x.c.gathers || 0, 50]),
  C('first_fish', 'Gone Fishing', 'Catch your first fish.', (x) => x.c.fish >= 1, (x) => [x.c.fish || 0, 1]),
  C('golden_koi', 'The One That Got Away', 'Catch a Golden Koi.', (x) => x.c.koi >= 1, (x) => [x.c.koi || 0, 1]),
  C('craft_first', 'Apprentice', 'Craft your first item.', (x) => x.c.crafts >= 1, (x) => [x.c.crafts || 0, 1]),
  C('craft_10', 'Artisan', 'Craft 10 items.', (x) => x.c.crafts >= 10, (x) => [x.c.crafts || 0, 10]),
  C('temper_first', 'Fine Tuning', 'Temper a piece of gear.', (x) => x.c.upgrades >= 1, (x) => [x.c.upgrades || 0, 1]),
  C('all_maps', 'Cartographer', 'Enter every map: town, meadow, woods, ruins, dock, crypt, frost.', (x) => MAPS.every((m) => x.visited[m]), (x) => [MAPS.filter((m) => x.visited[m]).length, MAPS.length]),
  C('waystones', 'Well Travelled', 'Attune all three waystones.', (x) => WAYS.every((w) => x.ways[w]), (x) => [WAYS.filter((w) => x.ways[w]).length, 3]),
  C('warden', 'Warden Down', 'Defeat Warden Gravemaw.', (x) => x.c.boss >= 1, (x) => [x.c.boss || 0, 1]),
  C('merchant', 'Shrewd Merchant', 'Sell 20 items to vendors.', (x) => x.c.sells >= 20, (x) => [x.c.sells || 0, 20]),
  // world expansion: new maps, Hollow Depths, world events
  C('frontier', 'Frontier Scout', 'Enter the desert, the marsh, the caverns and the Hollow Depths.', (x) => FRONTIER.every((m) => x.visited[m]), (x) => [FRONTIER.filter((m) => x.visited[m]).length, FRONTIER.length]),
  C('ways6', 'Waystone Wanderer', 'Attune all six waystones.', (x) => WAYS6.every((w) => x.ways[w]), (x) => [WAYS6.filter((w) => x.ways[w]).length, WAYS6.length]),
  C('khet', 'Sun Breaker', 'Defeat Khet, the Sun Colossus.', (x) => x.c.boss_khet >= 1, (x) => [x.c.boss_khet || 0, 1]),
  C('gloomtoad', 'Fen Cleanser', 'Defeat the Old Gloomtoad.', (x) => x.c.boss_gloomtoad >= 1, (x) => [x.c.boss_gloomtoad || 0, 1]),
  C('forgelord', 'Fire Out', 'Defeat Forgelord Ignar.', (x) => x.c.boss_forgelord >= 1, (x) => [x.c.boss_forgelord || 0, 1]),
  C('delver', 'Delver', 'Clear the Hollow Depths.', (x) => x.c.dungeons >= 1, (x) => [x.c.dungeons || 0, 1]),
  C('delver3', 'Depth Dweller', 'Clear the Hollow Depths 3 times.', (x) => x.c.dungeons >= 3, (x) => [x.c.dungeons || 0, 3]),
  C('hollowking', 'Hollow Regicide', 'Defeat the Hollow King.', (x) => x.c.boss_hking >= 1, (x) => [x.c.boss_hking || 0, 1]),
  C('ev_first', 'Right Place, Right Time', 'Take part in a world event.', (x) => x.c.events >= 1, (x) => [x.c.events || 0, 1]),
  C('ev_10', 'Event Regular', 'Take part in 10 world events.', (x) => x.c.events >= 10, (x) => [x.c.events || 0, 10]),
  C('slimeking', 'Crowned Crusher', 'Defeat the Slime King.', (x) => x.c.slimeking >= 1, (x) => [x.c.slimeking || 0, 1]),
  C('stargazer', 'Stargazer', 'Collect 5 star fragments.', (x) => x.c.stars >= 5, (x) => [x.c.stars || 0, 5]),
  C('caravan', 'Window Shopper', 'Buy something from the merchant caravan.', (x) => x.c.caravans >= 1, (x) => [x.c.caravans || 0, 1]),
  C('titan', 'Titan Slayer', 'Defeat a world boss.', (x) => x.c.worldboss >= 1, (x) => [x.c.worldboss || 0, 1]),
];
export const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export class Achievements {
  constructor(scene) {
    this.scene = scene;
    this.acc = 0;
    this.off = bus.on(Events.ACH_EVENT, (e) => this.onEvent(e));
    this.lvOff = bus.on(Events.LEVEL_UP, () => this.check());
    this.check(true);
  }
  destroy() { this.off?.(); this.lvOff?.(); }
  get meta() { return this.scene.meta; }
  bump(k, n = 1) { this.meta.counters[k] = (this.meta.counters[k] || 0) + n; }
  onEvent(e) {
    switch (e.k) {
      case 'kill': this.bump('kills'); if (e.boss) this.bump('boss'); break;
      case 'quest': this.bump('quests'); if (e.bounty) this.bump('bounties'); break;
      case 'chain': this.bump('chains'); break;
      case 'gather': this.bump('gathers', e.n || 1); break;
      case 'fish': this.bump('fish'); if (e.id === 'golden_koi') this.bump('koi'); break;
      case 'craft': this.bump('crafts', e.n || 1); break;
      case 'upgrade': this.bump('upgrades'); this.bump('crafts'); break;
      case 'sell': this.bump('sells', e.n || 1); break;
      case 'use': this.bump('uses'); break;
      case 'bosskill': this.bump(`boss_${e.id}`); break;
      case 'dungeon': this.bump('dungeons'); break;
      case 'event': this.bump('events'); break;
      case 'slimeking': this.bump('slimeking'); break;
      case 'star': this.bump('stars'); break;
      case 'caravan': this.bump('caravans'); break;
      case 'worldboss': this.bump('worldboss'); break;
      default: break;
    }
    this.check();
  }
  ctx() {
    const p = this.scene.player;
    return { c: this.meta.counters, level: p?.level || 1, gold: p?.gold || 0, visited: this.meta.visited, ways: this.scene.questState?.ways || {} };
  }
  progress(a) { const v = a.prog(this.ctx()); return { cur: Math.min(v[0], v[1]), need: v[1] }; }
  check(quiet) {
    const x = this.ctx();
    for (const a of ACHIEVEMENTS) {
      if (this.meta.ach[a.id] || !a.test(x)) continue;
      this.meta.ach[a.id] = Date.now();
      if (quiet) continue;
      audio.play('level', 0.8);
      bus.emit(Events.SYSTEM, `Achievement unlocked: ${a.name}!`);
      bus.emit(Events.TOAST, { title: 'Achievement', text: a.name, sub: a.desc, color: '#ffd84a', badge: true });
    }
  }
  update(dt) { this.acc += dt; if (this.acc > 1.5) { this.acc = 0; this.check(); this.scanCodex(); } }
  // gear codex: anything seen in bag / worn
  scanCodex() {
    const p = this.scene.player, g = this.meta.codex.gear;
    for (const id of p.inventory) g[id] = 1;
    for (const id of Object.values(p.equipped || {})) if (id) g[id] = 1;
  }
  count() { return Object.keys(this.meta.ach).length; }
}
