// RO-like jobs. spriteBody keys map to Ninja Adventure base sheets we seed.
// We keep the anchor sprites but rename everything so this is NOT Lanternfall.
export const JOBS = {
  wayfarer: {
    id: 'wayfarer', name: 'Wayfarer',
    desc: 'Balanced traveler. Sword + lantern. Good first pick.',
    body: 'knight', weapon: 'sword',
    hp: 120, mp: 40, atk: 12, spd: 95, hpLv: 12, mpLv: 4,
    base: { str: 8, agi: 5, vit: 8, int: 4, dex: 5, luk: 4 },
    growth: { str: 0.2, agi: 0.1, vit: 0.2, dex: 0.1 },
    advanced: ['knight', 'lanternwarden'],
    abilities: [
      { id: 'slash', name: 'Trail Slash', key: '1', cd: 0.6, desc: 'Quick sword arc.' },
      { id: 'flare', name: 'Waylight', key: '2', cd: 8, desc: 'Radiant burst that scorches and pushes nearby foes.', fx: { type: 'aoe', radius: 60, mul: 1.1, mp: 15, vfx: 'fx.circleOrange', knock: 180, status: { id: 'burn', chance: 0.65, secs: 3 } } },
      { id: 'dash', name: 'Dust Dash', key: '3', cd: 4, desc: 'Short dash, brief iframes.' },
      { id: 'camp', name: 'Make Camp', key: '4', cd: 20, desc: 'Drop a campfire that heals nearby.' },
    ],
  },
  ranger: {
    id: 'ranger', name: 'Ranger',
    desc: 'Long-range archer. Fragile, fast, high crit.',
    body: 'mangreen', weapon: 'bow',
    hp: 90, mp: 55, atk: 10, spd: 105, hpLv: 9, mpLv: 5,
    base: { str: 4, agi: 8, vit: 5, int: 4, dex: 9, luk: 6 },
    growth: { agi: 0.2, dex: 0.25, luk: 0.1 },
    advanced: ['hunter', 'wildwarden'],
    abilities: [
      { id: 'shot', name: 'Thorn Shot', key: '1', cd: 0.5, desc: 'Fire an arrow.' },
      { id: 'volley', name: 'Leaf Volley', key: '2', cd: 7, desc: 'Fan of 5 arrows.' },
      { id: 'dash', name: 'Dust Dash', key: '3', cd: 4, desc: 'Short dash, brief iframes.' },
      { id: 'snare', name: 'Snare Trap', key: '4', cd: 14, desc: 'Root enemies in a circle.' },
    ],
  },
  arcanist: {
    id: 'arcanist', name: 'Arcanist',
    desc: 'Elemental caster. Big AoE, needs mana.',
    body: 'sorcererorange', weapon: 'wand',
    hp: 80, mp: 100, atk: 14, spd: 88, hpLv: 7, mpLv: 10,
    base: { str: 3, agi: 4, vit: 4, int: 10, dex: 6, luk: 4 },
    growth: { int: 0.3, dex: 0.1, vit: 0.1 },
    advanced: ['elementalist', 'tidecaller'],
    abilities: [
      { id: 'bolt', name: 'Ember Bolt', key: '1', cd: 0.65, desc: 'Fire a magic bolt.' },
      { id: 'burst', name: 'Moss Burst', key: '2', cd: 9, desc: 'Nature AoE around caster.' },
      { id: 'blink', name: 'Wisp Blink', key: '3', cd: 5, desc: 'Short teleport.' },
      { id: 'ward', name: 'Tide Ward', key: '4', cd: 16, desc: 'Shield that absorbs damage.' },
    ],
  },
  bandit: {
    id: 'bandit', name: 'Bandit',
    desc: 'Fast rogue. Twin fangs, shadow tricks.',
    body: 'ninjadark', weapon: 'sai',
    hp: 95, mp: 50, atk: 11, spd: 112, hpLv: 9, mpLv: 5,
    base: { str: 6, agi: 9, vit: 5, int: 3, dex: 6, luk: 8 },
    growth: { str: 0.1, agi: 0.25, luk: 0.2 },
    advanced: ['shadowblade', 'trickster'],
    abilities: [
      { id: 'stab', name: 'Fang Stab', key: '1', cd: 0.4, desc: 'Very fast stab.' },
      { id: 'fan', name: 'Crow Fan', key: '2', cd: 7, desc: 'Throw 3 kunai in a fan.' },
      { id: 'dash', name: 'Dust Dash', key: '3', cd: 3.5, desc: 'Short dash, brief iframes.' },
      { id: 'smoke', name: 'Smoke Pouch', key: '4', cd: 15, desc: 'Blind nearby enemies.' },
    ],
  },
};

// ── Level-10 specialisations (2 per base class) ─────────────────────────────
// bonus: flat stat bonus; hpMul/mpMul/crit/aspd/move: derived-stat modifiers.
// abilities: two new skills on keys 5/6 (learn with skill points, Lv 1-5).
// fx types (handled in systems/skillFx.js): aoe | heal | buff | shot | strike.
// Damage skills can also provide knock and status ({ id, chance, secs }) for
// lightweight class identity without adding bespoke combat branches.
export const ADVANCED = {
  knight: {
    id: 'knight', name: 'Knight', base: 'wayfarer',
    desc: 'Sword-and-board bruiser. Tough, hits hard up close.',
    bonus: { str: 6, vit: 6 }, hpMul: 1.15,
    abilities: [
      { id: 'bash', name: 'Shield Bash', key: '5', cd: 7, icon: 'icon.slash', desc: 'Slam foes back; slows and may briefly stun.', fx: { type: 'aoe', radius: 44, mul: 1.6, slow: 2.5, mp: 12, shake: 0.004, knock: 260, status: { id: 'stun', chance: 0.45, secs: 0.8 } } },
      { id: 'bulwark', name: 'Bulwark', key: '6', cd: 18, icon: 'icon.ward', desc: 'Brief invulnerability + 25% ATK.', fx: { type: 'buff', secs: 8, atkMul: 1.25, ward: 1.5, mp: 20 } },
    ],
  },
  lanternwarden: {
    id: 'lanternwarden', name: 'Lantern Warden', base: 'wayfarer',
    desc: 'Keeper of the light. Heals and scorches with radiance.',
    bonus: { vit: 5, int: 4, luk: 2 }, mpMul: 1.2,
    abilities: [
      { id: 'beacon', name: 'Beacon', key: '5', cd: 14, icon: 'icon.camp', desc: 'Heal 35% of max HP.', fx: { type: 'heal', pct: 0.35, mp: 20 } },
      { id: 'sunburst', name: 'Sunburst', key: '6', cd: 10, icon: 'icon.flare', desc: 'Wide radiant burst that leaves foes burning.', fx: { type: 'aoe', radius: 78, mul: 1.3, mp: 24, vfx: 'fx.explosion', knock: 180, status: { id: 'burn', chance: 0.8, secs: 3.5 } } },
    ],
  },
  hunter: {
    id: 'hunter', name: 'Hunter', base: 'ranger',
    desc: 'Deadly marksman. Big single shots and arrow rain.',
    bonus: { dex: 8, agi: 3, luk: 2 }, crit: 4,
    abilities: [
      { id: 'pierce', name: 'Piercing Shot', key: '5', cd: 6, icon: 'icon.shot', desc: 'One heavy arrow (x2.4).', fx: { type: 'shot', n: 1, spread: 0, mul: 2.4, kind: 'arrow', mp: 14 } },
      { id: 'arrowrain', name: 'Arrow Rain', key: '6', cd: 12, icon: 'icon.volley', desc: 'Arrows fall around you, slowing caught foes.', fx: { type: 'aoe', radius: 84, mul: 1.1, mp: 26, vfx: 'fx.explosion', knock: 150, status: { id: 'slow', chance: 0.8, secs: 2 } } },
    ],
  },
  wildwarden: {
    id: 'wildwarden', name: 'Wildwarden', base: 'ranger',
    desc: 'Nature skirmisher. Thorns, mending and swiftness.',
    bonus: { vit: 4, dex: 5, int: 3 }, move: 0.05,
    abilities: [
      { id: 'thornwall', name: 'Thornwall', key: '5', cd: 11, icon: 'icon.snare', desc: 'Thorns poison and heavily slow caught foes.', fx: { type: 'aoe', radius: 66, mul: 0.7, slow: 5, mp: 16, status: { id: 'poison', chance: 0.85, secs: 5 } } },
      { id: 'wildmend', name: 'Wildmend', key: '6', cd: 16, icon: 'icon.camp', desc: 'Heal 30% HP and run faster.', fx: { type: 'heal', pct: 0.3, mp: 18, spdMul: 1.3, secs: 5 } },
    ],
  },
  elementalist: {
    id: 'elementalist', name: 'Elementalist', base: 'arcanist',
    desc: 'Raw destructive magic. Glass cannon.',
    bonus: { int: 9, dex: 3 }, mpMul: 1.1,
    abilities: [
      { id: 'meteor', name: 'Meteor', key: '5', cd: 12, icon: 'icon.burst', desc: 'Crushing fire blast that leaves a burn.', fx: { type: 'aoe', radius: 72, mul: 2.2, mp: 35, shake: 0.005, vfx: 'fx.explosion', knock: 320, status: { id: 'burn', chance: 1, secs: 4 } } },
      { id: 'chain', name: 'Spark Chain', key: '6', cd: 8, icon: 'icon.bolt', desc: 'Fan of 5 fire bolts.', fx: { type: 'shot', n: 5, spread: 0.28, mul: 0.9, kind: 'fire', mp: 22 } },
    ],
  },
  tidecaller: {
    id: 'tidecaller', name: 'Tidecaller', base: 'arcanist',
    desc: 'Water mage. Crowd control and restoration.',
    bonus: { int: 6, vit: 4, luk: 2 }, hpMul: 1.1,
    abilities: [
      { id: 'tidal', name: 'Tidal Surge', key: '5', cd: 10, icon: 'icon.ward', desc: 'Wave that knocks foes back and slows them.', fx: { type: 'aoe', radius: 66, mul: 1.0, slow: 4, mp: 25, knock: 250 } },
      { id: 'mist', name: 'Healing Mist', key: '6', cd: 15, icon: 'icon.camp', desc: 'Heal 40% of max HP.', fx: { type: 'heal', pct: 0.4, mp: 30 } },
    ],
  },
  shadowblade: {
    id: 'shadowblade', name: 'Shadowblade', base: 'bandit',
    desc: 'Assassin. Dash-strikes and a whirl of fangs.',
    bonus: { agi: 7, str: 4, luk: 2 }, crit: 6, aspd: 0.08,
    abilities: [
      { id: 'shadowstep', name: 'Shadowstep', key: '5', cd: 6, icon: 'icon.dash', desc: 'Dash through foes, cutting them.', fx: { type: 'strike', dist: 72, mul: 1.8, radius: 30, mp: 12 } },
      { id: 'fangdance', name: 'Fang Dance', key: '6', cd: 9, icon: 'icon.stab', desc: 'Spin slash that makes enemies bleed.', fx: { type: 'aoe', radius: 42, mul: 2.0, mp: 18, vfx: 'fx.slashArc', knock: 220, status: { id: 'bleed', chance: 0.85, secs: 4 } } },
    ],
  },
  trickster: {
    id: 'trickster', name: 'Trickster', base: 'bandit',
    desc: 'Lucky rogue. Traps, feints and dirty tricks.',
    bonus: { luk: 9, agi: 3, dex: 2 }, crit: 3,
    abilities: [
      { id: 'caltrops', name: 'Caltrops', key: '5', cd: 10, icon: 'icon.smoke', desc: 'Scatter spikes that slow and make foes bleed.', fx: { type: 'aoe', radius: 70, mul: 0.6, slow: 5, mp: 14, status: { id: 'bleed', chance: 0.5, secs: 3 } } },
      { id: 'feint', name: 'Feint', key: '6', cd: 16, icon: 'icon.fan', desc: '+30% ATK and +25% speed, 6s.', fx: { type: 'buff', secs: 6, atkMul: 1.3, spdMul: 1.25, mp: 18 } },
    ],
  },
};

// Open-world enemy table (reskinned Ninja Adventure monsters, new names/lore).
export const ENEMY_TABLE = {
  dewslime: { name: 'Dew Slime', sprite: 'Slime', hp: 30, atk: 6, xp: 8, gold: [1, 4], zones: ['meadow'] },
  mossbat: { name: 'Moss Bat', sprite: 'BlueBat', hp: 24, atk: 7, xp: 9, gold: [1, 5], zones: ['meadow', 'woods'] },
  thornmite: { name: 'Thornmite', sprite: 'SpiderRed', hp: 36, atk: 8, xp: 12, gold: [2, 6], zones: ['woods'] },
  capling: { name: 'Capling', sprite: 'Mushroom', hp: 42, atk: 9, xp: 14, gold: [2, 7], zones: ['woods'] },
  willowisp: { name: 'Willowisp', sprite: 'LanternGreen', hp: 34, atk: 11, xp: 16, gold: [3, 8], zones: ['woods', 'ruins'] },
  bogspirit: { name: 'Bog Spirit', sprite: 'Spirit', hp: 60, atk: 13, xp: 24, gold: [4, 10], zones: ['ruins'] },
  rustskull: { name: 'Rust Skull', sprite: 'Skull', hp: 55, atk: 12, xp: 22, gold: [3, 9], zones: ['ruins'] },
  tideeye: { name: 'Tide Eye', sprite: 'Eye', hp: 70, atk: 15, xp: 30, gold: [5, 12], zones: ['ruins'] },
};
