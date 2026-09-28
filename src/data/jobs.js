// RO-like jobs. spriteBody keys map to Ninja Adventure base sheets we seed.
// We keep the anchor sprites but rename everything so this is NOT Lanternfall.
export const JOBS = {
  wayfarer: {
    id: 'wayfarer', name: 'Wayfarer',
    desc: 'Balanced traveler. Sword + lantern. Good first pick.',
    body: 'knight', weapon: 'sword',
    hp: 120, mp: 40, atk: 12, spd: 95,
    abilities: [
      { id: 'slash', name: 'Trail Slash', key: '1', cd: 0.6, desc: 'Quick sword arc.' },
      { id: 'flare', name: 'Waylight', key: '2', cd: 8, desc: 'Warm AoE glow that burns wisps.' },
      { id: 'dash', name: 'Dust Dash', key: '3', cd: 4, desc: 'Short dash, brief iframes.' },
      { id: 'camp', name: 'Make Camp', key: '4', cd: 20, desc: 'Drop a campfire that heals nearby.' },
    ],
  },
  ranger: {
    id: 'ranger', name: 'Ranger',
    desc: 'Long-range archer. Fragile, fast, high crit.',
    body: 'mangreen', weapon: 'bow',
    hp: 90, mp: 55, atk: 10, spd: 105,
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
    hp: 80, mp: 100, atk: 14, spd: 88,
    abilities: [
      { id: 'bolt', name: 'Ember Bolt', key: '1', cd: 0.55, desc: 'Fire a magic bolt.' },
      { id: 'burst', name: 'Moss Burst', key: '2', cd: 9, desc: 'Nature AoE around caster.' },
      { id: 'blink', name: 'Wisp Blink', key: '3', cd: 5, desc: 'Short teleport.' },
      { id: 'ward', name: 'Tide Ward', key: '4', cd: 16, desc: 'Shield that absorbs damage.' },
    ],
  },
  bandit: {
    id: 'bandit', name: 'Bandit',
    desc: 'Fast rogue. Twin fangs, poison tricks.',
    body: 'ninjadark', weapon: 'sai',
    hp: 95, mp: 50, atk: 11, spd: 112,
    abilities: [
      { id: 'stab', name: 'Fang Stab', key: '1', cd: 0.4, desc: 'Very fast stab.' },
      { id: 'fan', name: 'Crow Fan', key: '2', cd: 6, desc: 'Throw 3 kunai in a fan.' },
      { id: 'dash', name: 'Dust Dash', key: '3', cd: 3.5, desc: 'Short dash, brief iframes.' },
      { id: 'smoke', name: 'Smoke Pouch', key: '4', cd: 15, desc: 'Blind nearby enemies.' },
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
