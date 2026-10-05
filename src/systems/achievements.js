// Achievements-lite: 52 achievements, event-driven counters, toasts.
// State: meta.ach = {id: unlockTimestamp}, meta.counters = {name: n}, meta.visited.
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { arenaNet } from '../net/arenaNet.js';

const MAPS = ['town', 'meadow', 'woods', 'ruins', 'dock', 'crypt', 'frost'];
const WAYS = ['town', 'dock', 'frost'];
const FRONTIER = ['desert', 'marsh', 'caverns', 'hollow'];
const WAYS6 = ['town', 'dock', 'frost', 'desert', 'marsh', 'caverns'];
const C = (id, name, desc, test, prog, reward) => ({ id, name, desc, test, prog, reward });

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
  // wave 3: arena (first match, first win, wins, rating milestones)
  C('arena_first', 'Blooded', 'Enter your first arena match.', (x) => x.c.arena_matches >= 1, (x) => [x.c.arena_matches || 0, 1], { xp: 100, gold: 50 }),
  C('arena_win1', 'Crowd Favorite', 'Win your first arena match.', (x) => x.c.arena_wins >= 1, (x) => [x.c.arena_wins || 0, 1], { xp: 200, gold: 100 }),
  C('arena_wins10', 'Arena Regular', 'Win 10 arena matches.', (x) => x.c.arena_wins >= 10, (x) => [x.c.arena_wins || 0, 10], { xp: 500, gold: 250 }),
  C('arena_1200', 'Rising Rating', 'Reach 1200 arena rating.', (x) => x.c.arena_best >= 1200, (x) => [Math.min(x.c.arena_best || 0, 1200), 1200], { xp: 400, gold: 200 }),
  C('arena_1500', 'Arena Elite', 'Reach 1500 arena rating.', (x) => x.c.arena_best >= 1500, (x) => [Math.min(x.c.arena_best || 0, 1500), 1500], { xp: 800, gold: 400 }),
  // wave 3: housing (unlock island, place furniture, claim yield)
  C('home_island', 'Homeward Bound', 'Unlock your home island.', (x) => !!x.housing.unlocked, (x) => [x.housing.unlocked ? 1 : 0, 1], { xp: 150, gold: 100 }),
  C('home_furnish', 'Housewarming', 'Place your first piece of furniture.', (x) => (x.housing.layout || []).length >= 1, (x) => [Math.min((x.housing.layout || []).length, 1), 1], { xp: 100, gold: 50 }),
  C('home_furnish5', 'Interior Designer', 'Place 5 pieces of furniture.', (x) => (x.housing.layout || []).length >= 5, (x) => [Math.min((x.housing.layout || []).length, 5), 5], { xp: 300, gold: 150, mats: { oak_log: 2 } }),
  C('home_harvest', 'Greenhouse', 'Claim your garden yield.', (x) => !!(x.housing.yieldClaim && x.housing.yieldClaim.date), (x) => [x.housing.yieldClaim && x.housing.yieldClaim.date ? 1 : 0, 1], { xp: 100, mats: { dewberry: 2 } }),
  // wave 3: tutorial chain completion
  C('tut_chain', 'Graduate', 'Complete the tutorial questline (First Steps to Egg Tales).', (x) => x.c.chain_tutorial >= 1, (x) => [x.c.chain_tutorial || 0, 1], { xp: 250, gold: 150 }),
  // wave 3: season milestones
  C('season3', 'Season Climber', 'Reach season tier 3.', (x) => x.c.season_best >= 3, (x) => [Math.min(x.c.season_best || 0, 3), 3], { xp: 200, gold: 100 }),
  C('season5', 'Season Regular', 'Reach season tier 5.', (x) => x.c.season_best >= 5, (x) => [Math.min(x.c.season_best || 0, 5), 5], { xp: 350, gold: 175 }),
  C('season10', 'Season Veteran', 'Reach season tier 10.', (x) => x.c.season_best >= 10, (x) => [Math.min(x.c.season_best || 0, 10), 10], { xp: 600, gold: 300 }),
  // wave 3: pets (hatch, duel participation)
  C('pet_hatch', 'New Companion', 'Hatch your first pet.', (x) => x.c.hatches >= 1, (x) => [x.c.hatches || 0, 1], { xp: 150, gold: 75 }),
  C('pet_duel', 'Duel Debut', 'Take part in a pet duel.', (x) => x.c.petduels >= 1, (x) => [x.c.petduels || 0, 1], { xp: 100, gold: 50 }),
  C('pet_duels5', 'Beastmaster', 'Take part in 5 pet duels.', (x) => x.c.petduels >= 5, (x) => [x.c.petduels || 0, 5], { xp: 300, gold: 150 }),
];
export const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export class Achievements {
  constructor(scene) {
    this.scene = scene;
    this.acc = 0;
    this.off = bus.on(Events.ACH_EVENT, (e) => this.onEvent(e));
    this.lvOff = bus.on(Events.LEVEL_UP, () => this.check());
    // wave 3: pet hatch + pet duel participation ride the existing bus events
    // (petMaster.js / petEncounter.js emit PET_HATCH; socialNet.js emits PET_DUEL_START).
    this.petOffs = [
      bus.on(Events.PET_HATCH, () => this.onEvent({ k: 'hatch' })),
      bus.on(Events.PET_DUEL_START, () => this.onEvent({ k: 'petduel' })),
    ];
    // wave 3: arena results via the existing arenaNet subscription pattern
    // (same onMatch/onResult/onRating shape ArenaPanel + seasonSystem.attachGameSources use).
    this.arenaOffs = [
      arenaNet.onMatch(() => this.onEvent({ k: 'arena_match' })),
      arenaNet.onResult((m) => {
        if (Number.isFinite(Number(m?.you?.rating))) this.noteBest('arena_best', Number(m.you.rating));
        this.onEvent({ k: Number(m?.you?.delta) > 0 ? 'arena_win' : 'arena_loss' });
      }),
      arenaNet.onRating((r) => {
        if (r?.rating != null) this.noteBest('arena_best', Number(r.rating));
        this.check();
      }),
    ];
    this.check(true);
  }
  destroy() { this.off?.(); this.lvOff?.(); for (const off of [...(this.petOffs || []), ...(this.arenaOffs || [])]) { try { off?.(); } catch { /* ignore */ } } }
  get meta() { return this.scene.meta; }
  bump(k, n = 1) { this.meta.counters[k] = (this.meta.counters[k] || 0) + n; }
  noteBest(k, v) { if (Number.isFinite(v) && v > (this.meta.counters[k] || 0)) this.meta.counters[k] = v; }
  onEvent(e) {
    switch (e.k) {
      case 'kill': this.bump('kills'); if (e.boss) this.bump('boss'); break;
      case 'quest': this.bump('quests'); if (e.bounty) this.bump('bounties'); break;
      case 'chain': this.bump('chains'); if (e.id) this.bump(`chain_${e.id}`); break;
      case 'arena_match': this.bump('arena_matches'); break;
      case 'arena_win': this.bump('arena_wins'); break;
      case 'hatch': this.bump('hatches'); break;
      case 'petduel': this.bump('petduels'); break;
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
    return { c: this.meta.counters, level: p?.level || 1, gold: p?.gold || 0, visited: this.meta.visited, ways: this.scene.questState?.ways || {}, housing: this.meta.housing || {} };
  }
  progress(a) { const v = a.prog(this.ctx()); return { cur: Math.min(v[0], v[1]), need: v[1] }; }
  // wave 3: season tier is owned by UIScene's SeasonSystem (local emitter, not
  // bus), so mirror the best tier seen into counters via the shared
  // window.__econUI handle (economyUI.js) before testing. Guarded: offline or
  // UI-not-ready simply keeps the last stored best.
  syncSeasonBest() {
    try {
      const t = Number(window.__econUI?.seasonSystem?.getState?.()?.tier);
      if (Number.isFinite(t)) this.noteBest('season_best', t);
    } catch { /* ignore */ }
  }
  // wave 3: rewards reuse the existing grant path — questSystem.grant() handles
  // {xp, gold, mats} (questSystem.js). Fallback covers gold/XP directly.
  grantReward(r) {
    if (!r) return;
    try { if (this.scene.quests?.grant) { this.scene.quests.grant(r); return; } } catch { /* fall through */ }
    try {
      const p = this.scene.player;
      if (r.gold) p.gold += r.gold;
      if (r.xp && this.scene.combat?.grantXp) this.scene.combat.grantXp(r.xp);
    } catch { /* ignore */ }
  }
  check(quiet) {
    this.syncSeasonBest();
    const x = this.ctx();
    for (const a of ACHIEVEMENTS) {
      if (this.meta.ach[a.id] || !a.test(x)) continue;
      this.meta.ach[a.id] = Date.now();
      if (quiet) continue;
      audio.play('level', 0.8);
      this.grantReward(a.reward);
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
