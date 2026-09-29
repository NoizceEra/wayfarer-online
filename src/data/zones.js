// One continuous open world, 4 named districts (larger scale than Lanternfall).
// WorldScene builds these from rectangles — no Tiled files needed for v1.
export const ZONES = [
  {
    id: 'town', name: 'Thistle Town', safe: true, level: 1,
    rect: { x: 48, y: 48, w: 32, h: 32 },
    desc: 'Market, inn, job board. No combat.',
    music: 'village',
  },
  {
    id: 'meadow', name: 'Meadowfield', safe: false, level: 1,
    rect: { x: 8, y: 8, w: 112, h: 112 },
    desc: 'Open fields. Dew Slimes and Moss Bats (Lv 1-4).',
    music: 'forest',
  },
  {
    id: 'woods', name: 'Mosswood', safe: false, level: 4,
    rect: { x: 80, y: 16, w: 40, h: 56 },
    desc: 'Dense woods. Thornmites, Caplings, Willowisps (Lv 4-8).',
    music: 'forest',
  },
  {
    id: 'ruins', name: 'Tidehollow Ruins', safe: false, level: 8,
    rect: { x: 16, y: 80, w: 48, h: 40 },
    desc: 'Sunken ruins gate (Lv 8+). Bog Spirits, Rust Skulls, Tide Eyes.',
    music: 'ruins',
  },
];

export const QUESTS = [
  { id: 'q_meadow', name: 'Field Notes', zone: 'meadow', text: 'Defeat 5 Dew Slimes for Pip in Thistle Town.', need: { enemy: 'dewslime', count: 5 }, reward: { xp: 60, gold: 25 } },
  { id: 'q_woods', name: 'Moss & Moths', zone: 'woods', text: 'Defeat 5 Thornmites in Mosswood for Pip.', need: { enemy: 'thornmite', count: 5 }, reward: { xp: 140, gold: 60 } },
  { id: 'q_ruins', name: 'Tidehollow Lantern', zone: 'ruins', text: 'Defeat 3 Bog Spirits deep in Tidehollow for Maren.', need: { enemy: 'bogspirit', count: 3 }, reward: { xp: 300, gold: 150 } },
  { id: 'q_ruins2', name: 'Rattle & Rust', zone: 'ruins', text: 'Defeat 4 Rust Skulls still guarding the old gate.', need: { enemy: 'rustskull', count: 4 }, reward: { xp: 380, gold: 180 } },
  { id: 'q_final', name: 'Eye of the Tide', zone: 'ruins', text: 'Defeat 2 Tide Eyes to close the rift. Maren will owe you one.', need: { enemy: 'tideeye', count: 2 }, reward: { xp: 520, gold: 260 } },
];
