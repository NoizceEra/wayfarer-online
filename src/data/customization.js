// Modular customization layers. Bodies are base sprites; everything else is
// tint + procedural overlay so Creator works with zero new art files.
// Drop future CC0 hair/armor sheets into public/assets/custom/ and extend HAIRS.
export const SKINS = [
  { id: 'porcelain', name: 'Porcelain', tint: 0xf2d3b3 },
  { id: 'sand', name: 'Sand', tint: 0xe0ac69 },
  { id: 'clay', name: 'Clay', tint: 0xc68642 },
  { id: 'bark', name: 'Bark', tint: 0x8d5524 },
  { id: 'moss', name: 'Moss', tint: 0xa8c686 },
];

export const HAIR_STYLES = [
  { id: 'none', name: 'Hooded' },
  { id: 'crop', name: 'Crop' },
  { id: 'bob', name: 'Bob' },
  { id: 'mop', name: 'Mop' },
  { id: 'tail', name: 'Tail' },
  { id: 'bun', name: 'Bun' },
];

export const HAIR_COLORS = [
  { id: 'raven', name: 'Raven', tint: 0x23232b },
  { id: 'bark', name: 'Bark', tint: 0x5a3a1e },
  { id: 'ember', name: 'Ember', tint: 0xd35400 },
  { id: 'gold', name: 'Gold', tint: 0xf1c40f },
  { id: 'moss', name: 'Moss', tint: 0x5da24a },
  { id: 'tide', name: 'Tide', tint: 0x2e86c1 },
  { id: 'lilac', name: 'Lilac', tint: 0xaf7ac5 },
  { id: 'snow', name: 'Snow', tint: 0xecf0f1 },
];

export const TOPS = [
  { id: 'travel', name: 'Travel Green', tint: 0x5da24a },
  { id: 'rust', name: 'Rust', tint: 0xb03a2e },
  { id: 'tide', name: 'Tide Blue', tint: 0x2e86c1 },
  { id: 'gold', name: 'Harvest', tint: 0xd4ac0d },
  { id: 'plum', name: 'Plum', tint: 0x7d3c98 },
  { id: 'slate', name: 'Slate', tint: 0x5d6d7e },
  { id: 'snow', name: 'Snow', tint: 0xeaecee },
  { id: 'night', name: 'Night', tint: 0x212f3c },
];

export const ACCESSORIES = [
  { id: 'none', name: 'None' },
  { id: 'scarf', name: 'Scarf' },
  { id: 'cape', name: 'Cape' },
  { id: 'shades', name: 'Shades' },
  { id: 'flower', name: 'Flower' },
];

export const WEAPONS = [
  { id: 'sword', name: 'Travel Sword' },
  { id: 'bigSword', name: 'Greatblade' },
  { id: 'bow', name: 'Yew Bow' },
  { id: 'wand', name: 'Twig Wand' },
  { id: 'sai', name: 'Fang' },
  { id: 'ninjaku', name: 'Chain Stick' },
];

export function defaultHero() {
  return {
    name: 'Wayfarer',
    job: 'wayfarer',
    body: 'knight',
    skin: 'sand',
    hair: 'mop',
    hairColor: 'bark',
    top: 'travel',
    accessory: 'scarf',
    weapon: 'sword',
    palette: 'classic',
  };
}
