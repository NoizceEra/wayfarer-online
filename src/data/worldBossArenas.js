// Dedicated, lazily-built maps for scheduled world bosses. The overworld has
// one Rift Gate; the active schedule chooses which arena that gate opens.
export const BOSS_ARENAS = [
  { id: 'meadow', name: 'Thornroot Basin', area: 'boss_thornroot', at: { tx: 24, ty: 16 }, theme: 'meadow' },
  { id: 'woods', name: 'Heartwood Hollow', area: 'boss_heartwood', at: { tx: 24, ty: 16 }, theme: 'woods' },
  { id: 'ruins', name: 'Tidefallen Ring', area: 'boss_tidefallen', at: { tx: 24, ty: 16 }, theme: 'ruins' },
];

export const WORLD_BOSS_RIFT = { offset: { x: -190, y: -120 }, color: 0xff704d };

const ARENA_COLOR = { meadow: 0x528e40, woods: 0x22482f, ruins: 0x46525e };
const arenaArea = (id, name, originX, theme) => ({
  id,
  kind: 'outdoor',
  name,
  safe: false,
  lv: [12, 99],
  music: 'tension',
  builder: 'worldBossArena',
  desc: 'A sealed battlefield reached through Thistle Town\'s World Rift.',
  origin: { x: originX, y: 0 },
  size: { w: 48, h: 36 },
  layers: [{ tex: 'tile.grass', color: ARENA_COLOR[theme], r: [0, 0, 48, 36] }],
  spawn: [24, 31],
  exit: [24, 33],
  bossSpot: [24, 16],
  arenaTheme: theme,
  worldBossArena: true,
});

export const WORLD_BOSS_AREAS = {
  boss_thornroot: arenaArea('boss_thornroot', 'Thornroot Basin', 21200, 'meadow'),
  boss_heartwood: arenaArea('boss_heartwood', 'Heartwood Hollow', 22200, 'woods'),
  boss_tidefallen: arenaArea('boss_tidefallen', 'Tidefallen Ring', 23200, 'ruins'),
};
