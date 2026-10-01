// Roster additions for the expansion maps (spread into data/npcs.js NPCS). Same schema as
// npcs.js: area 'desert' | 'marsh' | 'caverns', `at` = [tx, ty] tiles from the area origin.
// Sheets are all existing, validated Actor/Character folders.
export const EXTRA_NPCS = [
  // ——— Mirage Oasis Camp (Sunscorch Desert) ———
  { id: 'zahra', name: 'Caravan Master Zahra', sheet: 'Sultan', role: 'quest', area: 'desert', at: [13.5, 27.5], night: 'stay', face: 'left',
    lines: ['Welcome to the Mirage Oasis! The scarabs have eaten half my caravan. Thin them out and I will make it worth your while.', 'Follow the packed-sand road east. The Temple of the Sunken Sun stands at the end of it.', 'The waystone keeps our camp on your map. Touch it and come back any time.'] },
  { id: 'nuru', name: 'Healer Nuru', title: 'Desert Medic', sheet: 'Monk2', role: 'merchant', area: 'desert', at: [6.5, 26], night: 'stay', sells: ['potion_small', 'medipack', 'herb_tea', 'water_flask'],
    lines: ['Heatstroke is a rotten way to go. Take a medipack.', 'Sun aloe grows by the far oasis. It heals anything - burns, bites, bad moods.'] },
  { id: 'oreth', name: 'Sandguard Oreth', title: 'Camp Guard', sheet: 'KnightGold', role: 'guard', area: 'desert', at: [3.6, 33], face: 'right', night: 'stay',
    lines: ['Nothing with a stinger gets past me. Not on my watch.', 'When the sky turns orange, find cover: sandstorms blind you completely.'] },
  { id: 'kesh', name: 'Kesh', title: 'Nomad Trader', sheet: 'NinjaYellow', role: 'merchant', area: 'desert', at: [15, 33.5], night: 'stay', shop: 'dovey',
    lines: ['Cloaks, wraps and hats, cut for the dunes. Tell your friends.', 'I have walked to every edge of the map. The best sunsets are here.'] },
  { id: 'amun', name: 'Little Amun', sheet: 'Boy', role: 'ambient', area: 'desert', at: [9, 35.5], wander: 50, night: 'stay',
    lines: ['I found a scarab and it tried to eat me. So I named it Brad.', 'The oasis fish are huge! Bigger than my arm. Well, bigger than my finger.'] },
  { id: 'basim', name: 'Storyteller Basim', sheet: 'Master', role: 'ambient', area: 'desert', at: [12, 35], night: 'stay', face: 'left',
    lines: ['They say the Sun Colossus once held the sky on its shoulders. Then it got tired.', 'The temple gate opens only to those who do not run at the first sting.'] },

  // ——— Fenwatch Stilts (Whisperfen Marsh) ———
  { id: 'moss', name: 'Fenwarden Moss', sheet: 'MaskFrog', role: 'quest', area: 'marsh', at: [13, 27.5], night: 'stay', face: 'left',
    lines: ['Mind the boardwalk, traveller. Step off it and the fen will keep your boots. And possibly you.', 'The will-o-wisps are led by something ancient on the far island. Douse the wisps and the path grows safer.', 'Touch the waystone. It is the only thing around here that stays put.'] },
  { id: 'briar', name: 'Herbwife Briar', title: 'Fen Herbalist', sheet: 'Cavegirl', role: 'merchant', area: 'marsh', at: [6.5, 26.5], night: 'stay', sells: ['potion_small', 'herb_tea', 'medipack', 'nut_bag'],
    lines: ['Glowcaps, fen lilies, and a good tea to go with them.', 'Glowcaps shine brightest at night. Do not eat them. Do not ask how I know.'] },
  { id: 'tull', name: 'Boatwright Tull', title: 'Stilt Smith', sheet: 'Caveman', role: 'merchant', area: 'marsh', at: [14.5, 34], night: 'stay', shop: 'bram',
    lines: ['Boards, rope and steel. Everything a swamp demands.', 'Fell a toad and it leaves you a heap of slime. Worth a coin or two, strangely.'] },
  { id: 'rook2', name: 'Stiltwatch Hale', title: 'Sentry', sheet: 'FighterRed', role: 'guard', area: 'marsh', at: [4.4, 33], face: 'right', night: 'stay',
    lines: ['I watch the mist. The mist watches me. It is a stalemate.', 'Stay on the planks and you live longer. Simple.'] },
  { id: 'reedpell', name: 'Reed Pell', sheet: 'Boy', role: 'ambient', area: 'marsh', at: [9, 35.5], wander: 46, night: 'stay',
    lines: ['Did you see the lights? Follow them and you never come back. That is the rule.', 'Toads are not slimy. Toads are... dewy.'] },
  { id: 'gossamer', name: 'Old Gossamer', sheet: 'OldWoman', role: 'ambient', area: 'marsh', at: [11.5, 24.5], night: 'stay', face: 'down',
    lines: ['The fen was a lake once. Then the lake forgot itself.', 'When the fog lifts the wisps sleep. When it thickens, well, pack a lantern.'] },

  // ——— Emberdeep Outpost (Emberdeep Caverns) ———
  { id: 'forgekeeper', name: 'Forgekeeper Dorn', sheet: 'Caveman2', role: 'quest', area: 'caverns', at: [9.5, 40], night: 'stay', face: 'left',
    lines: ['The slimes out there are more magma than slime. They hit like hammers.', 'Something big keeps the forge fires burning down the tunnels. The Forgelord is not hospitable.', 'Touch the waystone. It is our only way out that does not involve lava.'] },
  { id: 'kala', name: 'Miner Kala', title: 'Crystal Broker', sheet: 'Cavegirl2', role: 'merchant', area: 'caverns', at: [5, 37.5], night: 'stay', sells: ['potion_small', 'medipack', 'meat', 'scroll_ice'],
    lines: ['Potions and pork. The two things a miner needs.', 'Fire crystals are pure heat. Do not keep them in your pockets. Seriously.'] },
  { id: 'brynja', name: 'Shieldmaiden Brynja', title: 'Outpost Guard', sheet: 'FighterWhite', role: 'guard', area: 'caverns', at: [4.4, 42.5], face: 'right', night: 'stay',
    lines: ['Bats, imps, golems. A quiet week.', 'The lava looks solid in the dark. It is not.'] },
  { id: 'kilm', name: 'Smith Kilm', title: 'Forge Smith', sheet: 'DemonRed', role: 'merchant', area: 'caverns', at: [12, 38.5], night: 'stay', shop: 'bram',
    lines: ['Hot iron, hotter prices. Sell me your spares.', 'Yes, I am a demon. No, it is not a costume. I like the forge.'] },
];
