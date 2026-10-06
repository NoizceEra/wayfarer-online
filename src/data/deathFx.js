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
  // Lowercase "biome pack" custom sheets (keys are monster IDs, not sheet names).
  // The BY_SPRITE regexes below are written for the TitleCase Ninja-Adventure
  // names, so every one of these used to fall through to the default 'beast'
  // family — a treant died like a bear and a crab like a boar. Match the type.
  moss_treant: 'plant', dewbeetle: 'bug', coralcrab: 'bug', bogleech: 'bug',
  shadowwraith: 'ghost', bonehound: 'bones', icegolem: 'ice', reefjelly: 'slime',
  frostfox: 'ice', csalamander: 'fire',
};

// Family resolution order (first hit wins):
//   1. an explicit `def.deathFx`            — authored intent always wins
//   2. BY_ID                                — lowercase/edge-case ids the regexes cannot see
//   3. def.boss                             — every boss gets the boss effect
//   4. BY_SPRITE                            — TitleCase Ninja-Adventure sheet names
//   5. 'beast'                              — default
// Step 3 matters: 10 monsters carry `boss: true` but only 2 were listed in BY_ID,
// so the other 8 (Khet, Ancient Thornback, Forgelord Ignar, Old Gloomtoad, Hollow
// Warden, The Hollow King, Slime King Gloop, ...) died with a trash-mob 'beast'
// effect. Putting the boss rule after BY_ID keeps deliberate exceptions like
// glacierwyrm ('ice') intact while filling the gap for everything else.
for (const [id, def] of Object.entries(ENEMY_TABLE)) {
  if (def.deathFx) continue;
  const byId = BY_ID[id];
  const bySprite = (BY_SPRITE.find(([re]) => re.test(def.sprite)) || [])[1];
  def.deathFx = byId || (def.boss ? 'boss' : null) || bySprite || 'beast';
}
