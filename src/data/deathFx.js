// Data-driven death / hit-reaction family for every monster def (`def.deathFx`), read by
// systems/skillVfx.js (hitReact / deathFx) from Enemy.hurt / Enemy.die.
//   slime | bones | ghost | bug | beast | plant | fire | ice | water | ink | blood | boss
// Families are inferred from the sheet name; an explicit `deathFx` on a def always wins
// (e.g. set `deathFx: 'ice'` inside data/worldEnemies.js).
import { ENEMY_TABLE } from './jobs.js';
import './worldEnemies.js';

const BY_SPRITE = [
  [/^Slime|Mollusc/, 'slime'],
  [/^Skull/, 'bones'],
  [/^Spirit|^Lantern|^Eye/, 'ghost'],
  [/^Flam|^Heart/, 'fire'],
  [/^Spider|Larva|Bat$|^Owl|^Yellows|Reptile|Lizard|Snake/, 'bug'],
  [/^Mushroom|^Bamboo|^Kappa/, 'plant'],
  [/Octopus/, 'ink'],
  [/^Axolot/, 'water'],
];
const BY_ID = {
  rexling: 'beast', frostwisp: 'ice', frostgel: 'ice', icejelly: 'ice', snowspecter: 'ghost', glaciersnail: 'ice',
  bloodheart: 'blood', bloodeye: 'blood', gravemaw: 'boss', redclaw: 'boss', glacierwyrm: 'ice',
  cavern_magmacrab: 'fire', crypt_voidwisp: 'ghost', forest_briarsapling: 'plant', desert_sandstalker: 'bug', frost_rimebat: 'ice', hollow_abysseye: 'ghost',
};

for (const [id, def] of Object.entries(ENEMY_TABLE)) {
  if (def.deathFx) continue;
  const fam = BY_ID[id] || (BY_SPRITE.find(([re]) => re.test(def.sprite)) || [])[1];
  def.deathFx = fam || 'beast';
}
