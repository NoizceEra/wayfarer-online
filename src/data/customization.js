import { itemsForSlot } from './gear.js';
// Modular customization layers. Bodies are base sprites; everything else is
// tint + procedural overlay so Creator works with zero new art files.
// Drop future CC0 hair/armor sheets into public/assets/custom/ and extend HAIRS.
export const SKINS = [
  { id: 'porcelain', name: 'Porcelain', tint: 0xf2d3b3 },
  { id: 'ivory', name: 'Ivory', tint: 0xf6e0c8 },
  { id: 'peach', name: 'Peach', tint: 0xf0b98d },
  { id: 'sand', name: 'Sand', tint: 0xe0ac69 },
  { id: 'olive', name: 'Olive', tint: 0xc9a66b },
  { id: 'clay', name: 'Clay', tint: 0xc68642 },
  { id: 'bark', name: 'Bark', tint: 0x8d5524 },
  { id: 'umber', name: 'Umber', tint: 0x6b4026 },
  { id: 'ebony', name: 'Ebony', tint: 0x4a2c1e },
  { id: 'moss', name: 'Moss', tint: 0xa8c686 },
  { id: 'frost', name: 'Frost', tint: 0xb9d8ee },
  { id: 'dusk', name: 'Dusk', tint: 0xb9a3d6 },
  { id: 'rose', name: 'Rose', tint: 0xe3a1ae },
];

export const HAIR_STYLES = [
  { id: 'none', name: 'Hooded' },
  { id: 'crop', name: 'Crop' },
  { id: 'bob', name: 'Bob' },
  { id: 'mop', name: 'Mop' },
  { id: 'tail', name: 'Tail' },
  { id: 'bun', name: 'Bun' },
  { id: 'spiky', name: 'Spiky' },
  { id: 'long', name: 'Long' },
  { id: 'twin', name: 'Twin Tails' },
  { id: 'curly', name: 'Curly' },
  { id: 'mohawk', name: 'Mohawk' },
  { id: 'swoop', name: 'Swoop' },
  { id: 'braid', name: 'Braid' },
  { id: 'topknot', name: 'Topknot' },
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
  { id: 'auburn', name: 'Auburn', tint: 0x8e3b22 },
  { id: 'chestnut', name: 'Chestnut', tint: 0x8d5a34 },
  { id: 'wheat', name: 'Wheat', tint: 0xd9b870 },
  { id: 'rose', name: 'Rose', tint: 0xe86fa0 },
  { id: 'crimson', name: 'Crimson', tint: 0xb3202a },
  { id: 'teal', name: 'Teal', tint: 0x1abc9c },
  { id: 'sky', name: 'Sky', tint: 0x6cc4ee },
  { id: 'storm', name: 'Storm', tint: 0x7f8c9b },
  { id: 'midnight', name: 'Midnight', tint: 0x2c2a5a },
  { id: 'mint', name: 'Mint', tint: 0x9be8c0 },
];

// Face: eyes + eye colour + markings are a painted overlay (systems/heroArt.js).
export const EYES = [
  { id: 'dot', name: 'Classic' },
  { id: 'bright', name: 'Bright' },
  { id: 'sleepy', name: 'Sleepy' },
  { id: 'wide', name: 'Wide' },
  { id: 'lashes', name: 'Lashes' },
  { id: 'fierce', name: 'Fierce' },
  { id: 'happy', name: 'Happy' },
  { id: 'wink', name: 'Wink' },
];
export const EYE_COLORS = [
  { id: 'ink', name: 'Ink', tint: 0x1a1a22 },
  { id: 'brown', name: 'Brown', tint: 0x6b3f1e },
  { id: 'hazel', name: 'Hazel', tint: 0x9a7a2e },
  { id: 'green', name: 'Green', tint: 0x3f9a4a },
  { id: 'sky', name: 'Sky', tint: 0x3a8ee0 },
  { id: 'violet', name: 'Violet', tint: 0x8a4ad6 },
  { id: 'ruby', name: 'Ruby', tint: 0xd02a3a },
  { id: 'gold', name: 'Gold', tint: 0xe8b22a },
];
export const MARKS = [
  { id: 'none', name: 'None' },
  { id: 'freckles', name: 'Freckles' },
  { id: 'blush', name: 'Blush' },
  { id: 'scar', name: 'Scar' },
  { id: 'warpaint', name: 'War Paint' },
  { id: 'beauty', name: 'Beauty Mark' },
  { id: 'stripes', name: 'Tide Stripes' },
  { id: 'stars', name: 'Star Dots' },
  { id: 'tears', name: 'Teardrop' },
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
  { id: 'coral', name: 'Coral', tint: 0xe9725c },
  { id: 'rose', name: 'Rose', tint: 0xe86fa0 },
  { id: 'teal', name: 'Teal', tint: 0x1f9e8e },
  { id: 'sky', name: 'Sky', tint: 0x6cb4e8 },
  { id: 'lime', name: 'Lime', tint: 0x9bc53d },
  { id: 'orange', name: 'Pumpkin', tint: 0xe67e22 },
  { id: 'cocoa', name: 'Cocoa', tint: 0x7a4a22 },
  { id: 'violet', name: 'Violet', tint: 0x9b59b6 },
  { id: 'crimson', name: 'Crimson', tint: 0x8e1f2f },
  { id: 'sand', name: 'Sand', tint: 0xd9c08a },
];

export const ACCESSORIES = [
  { id: 'none', name: 'None' },
  { id: 'scarf', name: 'Scarf' },
  { id: 'cape', name: 'Cape' },
  { id: 'shades', name: 'Shades' },
  { id: 'flower', name: 'Flower' },
];

// Creator shows only these; cape/shades live on as wearable gear (old saves still render).
export const CREATOR_ACCESSORIES = ACCESSORIES.filter((a) => ['none', 'scarf', 'flower'].includes(a.id));

// Starter cosmetics: pick one per slot at creation (granted + equipped on a new game).
export const STARTER_SLOTS = ['head', 'face', 'body', 'back', 'feet'];
export const starterChoices = (slot) => [
  { id: 'none', name: 'None' },
  ...itemsForSlot(slot).filter((g) => g.starter).map((g) => ({ id: g.id, name: g.name })),
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
    eyes: 'dot',
    eyeColor: 'ink',
    mark: 'none',
    starter: {},
  };
}
