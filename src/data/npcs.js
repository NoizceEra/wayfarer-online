// Data-driven NPC roster (Ninja Adventure character sheets, CC0). Placed by
// world/townfolk.js. Fields:
//   id, name, title?      display; `title` shows after the name in the dialog box
//   sheet                 Actor/Character folder name (must pass tools/validate_sheets.py)
//   role                  merchant | guard | quest | ambient | trainer
//   area                  'town' (Thistle Town, offset px from spawn) | 'dock' | 'frost' (tile coords)
//   at: [a, b]            town: [dx, dy] px from plaza spawn; dock/frost: [tx, ty] tiles
//   wander                roam radius px (0/omitted = stands still)
//   night                 'sleep' (goes indoors, hidden) | 'stay' (default) | [a, b] (walks to a night post)
//   face                  facing while idle (default down)
//   lines                 2-4 flavour lines, cycled per talk (hints for quests/zones/hotkeys)
//   sells                 merchants: consumable item ids from data/items.js (buy via dialog options)
//   shop                  merchants: existing gear shop id ('maren' | 'dovey' | 'bram')
import { EXTRA_NPCS } from './npcsExtra.js';
//   market                true: clerk of the server-wide market board (src/ui/MarketPanel.js)
export const NPCS = [
  // ——— market board clerks (one shared, server-wide board) ———
  { id: 'posey', name: 'Posey', title: 'Market Board', sheet: 'Villager4', role: 'merchant', area: 'town', at: [-150, -40], face: 'right', night: 'stay', market: true,
    lines: ['Pin it on the board and the whole world can buy it! Five percent fee, paid up front.', 'Sold goods pay out by mail - press V to check your mailbox.'] },
  { id: 'gull', name: 'Gull', title: 'Market Board', sheet: 'NinjaGray', role: 'merchant', area: 'dock', at: [17.5, 11], face: 'right', night: 'stay', market: true,
    lines: ['Same board as Thistle Town - the gulls carry the notes. Do not ask.', 'Unsold listings float back to your mailbox when they expire.'] },
  // ——— Thistle Town ———
  { id: 'varro', name: 'Captain Varro', title: 'Gate Captain', sheet: 'Samurai', role: 'guard', area: 'town', at: [-150, 118], face: 'right', night: 'stay',
    lines: ['Thistle Town is a safe zone - no monster will harm you inside the fence.', 'Slimes in Meadowfield are good practice. Press J to swing, 1-4 for skills.', 'Stay sharp past the signposts: they list the level range of every zone.'] },
  { id: 'sera', name: 'Sera', title: 'Gate Guard', sheet: 'SamuraiBlue', role: 'guard', area: 'town', at: [150, 130], face: 'left', night: 'stay',
    lines: ['Halt! ...Oh, it is you. Carry on, traveller.', 'Night patrol is the dull shift. The owls never stop gossiping.', 'Hurt? Press Q to drink a potion. Maren sells them for 3 gold.'] },
  { id: 'hopper', name: 'Hopper', title: 'Fruit Seller', sheet: 'Villager2', role: 'merchant', area: 'town', at: [100, 70], night: 'sleep', sells: ['apple_honey', 'onigiri', 'nut_bag'],
    lines: ['Fresh food, fresh prices! Press H out in the field to eat and heal.', 'Honey from the Mosswood hives. Do not ask about the bees.'] },
  { id: 'lotte', name: 'Lotte', title: 'Baker', sheet: 'Villager5', role: 'merchant', area: 'town', at: [-24, 96], night: 'sleep', sells: ['onigiri', 'noodles', 'fortune_cookie'],
    lines: ['Warm noodles! Nothing heals a sore knee like a full bowl.', 'The cookies say something different every day. Today: "Beware of crabs."'] },
  { id: 'quill', name: 'Quill', title: 'Scribe', sheet: 'Noble', role: 'quest', area: 'town', at: [-118, -60], night: 'sleep',
    lines: ['Check the notice board by the well. Quests track in the top-right corner.', 'Press I for your bag and gear. Dyes are free at the wardrobe.', 'I am cataloguing every monster in Embervale. Bring me sketches! ...Actually, just survive.'] },
  { id: 'wren', name: 'Wren', title: 'Herbalist', sheet: 'Woman', role: 'merchant', area: 'town', at: [196, 40], night: 'sleep', sells: ['potion_small', 'herb_tea', 'medipack'],
    lines: ['Potions, poultices and peppermint. Take your pick.', 'Mosswood herbs are the best, but the Caplings guard them jealously.'], wander: 26 },
  { id: 'jory', name: 'Jory', sheet: 'Boy', role: 'ambient', area: 'town', at: [-40, 150], wander: 90, night: 'sleep',
    lines: ['I am going to be a hero one day! Want to see my wooden sword?', 'Tag! ...you are not playing? Fine.'] },
  { id: 'mimi', name: 'Mimi', sheet: 'EggGirl', role: 'ambient', area: 'town', at: [60, -80], wander: 80, night: 'sleep',
    lines: ['I found a shiny rock! It is probably a gem. Probably.', 'Do you think slimes get cold in winter?'] },
  { id: 'pog', name: 'Pog', sheet: 'EggBoy', role: 'ambient', area: 'town', at: [-180, 40], wander: 70, night: 'sleep',
    lines: ['Shh, I am hiding from Jory.', 'If you see a butterfly, stand still. They land on your hat.'] },
  { id: 'hale', name: 'Hale', title: 'Retired Knight', sheet: 'Knight', role: 'trainer', area: 'town', at: [-110, 100], face: 'up', night: 'stay',
    lines: ['Dodge by timing your dash as the red flash appears. FLEE makes you harder to hit.', 'Spend your stat points when you level up - STR for swords, INT for spells.', 'At level 10 a class change awaits. Choose well.'] },
  { id: 'aurelia', name: 'Lady Aurelia', sheet: 'Princess', role: 'ambient', area: 'town', at: [30, -20], wander: 50, night: 'sleep',
    lines: ['Such a charming little town. The fountain, though... it is a well.', 'Do mind the hem. These boots were not made for slime.'] },
  { id: 'zephyr', name: 'Zephyr', title: 'Wandering Monk', sheet: 'Monk2', role: 'trainer', area: 'town', at: [-90, -100], wander: 40, night: 'sleep',
    lines: ['Breathe. The hero who rests recovers MP faster than one who charges.', 'Waystones remember you. Touch one, travel back to it later from any other.'] },
  { id: 'gaffer', name: 'Gaffer Nib', sheet: 'OldMan3', role: 'ambient', area: 'town', at: [130, -96], wander: 30, night: 'sleep',
    lines: ['In my day slimes were slimes and bats were afraid of us.', 'That Tidehollow... my brother went in. Came out seasoned, he did.'] },
  { id: 'sable', name: 'Sable', title: 'Night Trader', sheet: 'Vampire', role: 'merchant', area: 'town', at: [-200, -20], night: 'stay', sells: ['scroll_home', 'potion_small'],
    lines: ['Ah, a customer. I prefer the evening crowd.', 'A scroll of homecoming, for when the road has been unkind. Press Y to read.', 'No, I am not a vampire. It is... a stage costume.'] },
  { id: 'brindle', name: 'Brindle', title: 'Town Crier', sheet: 'Villager6', role: 'ambient', area: 'town', at: [-60, 30], wander: 60, night: 'sleep',
    lines: ['Hear ye! Dock Town needs crab-catchers, Frostpeak needs wisp-dousers!', 'Press N for the world map. Hear ye, hear ye, press N!'] },
  { id: 'kiko', name: 'Kiko', sheet: 'NinjaGreen', role: 'trainer', area: 'town', at: [170, 96], night: [170, 96], wander: 20,
    lines: ['Ninja training: never stand still while a monster winds up. Red flash means dash.', 'Shhh. You found my hiding spot. Nobody ever finds my hiding spot.'] },
  { id: 'tomas', name: 'Tomas', sheet: 'Village6', role: 'ambient', area: 'town', at: [0, 120], wander: 60, night: 'sleep',
    lines: ['Lovely day for carrying crates from A to B.', 'Bram pays for spares. Sell him your old gear - keep the good stuff.'] },
  { id: 'goldy', name: 'The Golden Statue', sheet: 'GoldStatue', role: 'ambient', area: 'town', at: [-150, -120], night: 'stay',
    lines: ['...', 'It is a statue of a hero with a very confident stance. Someone left a small flower at its feet.'] },

  { id: 'mira', name: 'Mira', title: 'Tinkerer', sheet: 'RobotGrey', role: 'ambient', area: 'town', at: [190, -60], night: 'stay',
    lines: ['Beep. I mean - hello. This is a clockwork costume, not a real robot.', 'Ever wonder how the waystones work? Me neither, I just poke them.'] },
  { id: 'dax', name: 'Dax', title: 'Arena Hopeful', sheet: 'MonkeyBoxerBlue', role: 'ambient', area: 'town', at: [-20, -60], wander: 40, night: 'sleep',
    lines: ['One day I will fight the Warden bare-fisted. Wait, is that wise?', 'Left hook, right hook, run away. That is my whole strategy.'] },
  { id: 'elsbeth', name: 'Elsbeth', title: 'Seamstress', sheet: 'SorcererBlack', role: 'ambient', area: 'town', at: [120, -30], wander: 30, night: 'sleep',
    lines: ['Dovey sells the hats, I sew the hems. Do not tell her I said that.', 'Dyes wash out if you fight in the rain. Not that it rains here.'] },
  { id: 'cleo', name: 'Cleo', sheet: 'NinjaMageOrange', role: 'trainer', area: 'town', at: [-180, 90], night: 'stay', face: 'right',
    lines: ['Mana regenerates while you walk. Cast, step, cast - that is the rhythm.', 'Your 1-4 skills all cost something; watch the blue bar.'] },

  // ——— Coastal Dock Town (tile coords) ———
  { id: 'marek', name: 'Harbourmaster Marek', sheet: 'NinjaBlue', role: 'quest', area: 'dock', at: [20.5, 11], night: 'stay',
    lines: ['Ships come and go. Crabs, however, stay and pinch.', 'Orla wants six crabs off the beach. Take the east path past the lighthouse.', 'The waystone in the plaza links us to Thistle Town.'] },
  { id: 'pellam', name: 'Pellam', title: 'Fishmonger', sheet: 'Hunter', role: 'merchant', area: 'dock', at: [11.5, 14], night: 'sleep', sells: ['fish_fresh', 'sushi', 'shrimp'],
    lines: ['Fresh off the boat! Fish heals more than you would think.', 'Sushi, yes - do not look at me like that, it is the tide that is raw.'] },
  { id: 'sashi', name: 'Sashi', title: 'Noodle Cook', sheet: 'Villager', role: 'merchant', area: 'dock', at: [25, 15.5], night: 'sleep', sells: ['noodles', 'yakitori', 'onigiri'],
    lines: ['Hot skewers for cold mornings. Yakitori by the stick!', 'The sailors always order double. I am running out of bowls.'] },
  { id: 'koa', name: 'Koa', sheet: 'NinjaWater', role: 'ambient', area: 'dock', at: [9, 18], wander: 50, night: 'sleep',
    lines: ['I can hold my breath for three minutes. Nobody believes me.', 'The water changes colour when the tide turns. Watch it.'] },
  { id: 'isolde', name: 'Isolde', title: 'Sea Captain', sheet: 'KnightGold', role: 'ambient', area: 'dock', at: [30, 8], face: 'down', night: 'stay',
    lines: ['My ship sails at dawn... for Frostpeak, once the wisps calm down.', 'Sea legs take a week. Land legs take a lifetime.'] },
  { id: 'tobbit', name: 'Tobbit', title: 'Sailor', sheet: 'Villager3', role: 'ambient', area: 'dock', at: [5, 6], wander: 70, night: 'sleep',
    lines: ['Three sheets to the wind! Not literally. I do not own that many.', 'Watch the boats bob. They tell you if a storm is coming.'] },
  { id: 'nami', name: 'Nami', title: 'Net Mender', sheet: 'Woman', role: 'ambient', area: 'dock', at: [15.5, 26], face: 'right', night: 'sleep',
    lines: ['Crab pinches ruin a good net in seconds.', 'If you find Garrick\'s net on the north-east beach, he will kiss your hand.'] },
  { id: 'basho', name: 'Old Basho', title: 'Poet', sheet: 'Master', role: 'ambient', area: 'dock', at: [34, 18], wander: 30, night: 'sleep',
    lines: ['Old pond... a frog jumps in... the sound of water.', 'The sea is a patient teacher. Also a wet one.'] },
  { id: 'rook', name: 'Rook', title: 'Dock Guard', sheet: 'FighterWhite', role: 'guard', area: 'dock', at: [3.5, 14.5], face: 'right', night: 'stay',
    lines: ['Keep your blade sheathed near the pier, friend.', 'The Harbour Gate leads back to the meadow. Safe road, mostly.'] },
  { id: 'lumi', name: 'Lumi', sheet: 'Cavegirl', role: 'ambient', area: 'dock', at: [22, 4], wander: 60, night: 'sleep',
    lines: ['I collect shells. This one sounds like grumpy crab.', 'Can you hear it?'] },
  { id: 'dorn', name: 'Dorn', title: 'Shipwright', sheet: 'Caveman', role: 'merchant', area: 'dock', at: [29, 21], night: 'sleep', shop: 'bram',
    lines: ['I build the boats. Bram over in Thistle sells the swords. We split the customers.', 'Planks, tar and patience. That is a ship.'] },

  // ——— Frostpeak Outpost (tile coords) ———
  { id: 'yuki', name: 'Yuki', title: 'Outpost Medic', sheet: 'NinjaEskimo', role: 'merchant', area: 'frost', at: [9.5, 34.5], night: 'stay', sells: ['potion_small', 'medipack', 'herb_tea'],
    lines: ['Frostbite is a rotten way to go. Take a medipack.', 'Frost Wisps burn cold. Rime Crawlers bite colder.'] },
  { id: 'nanuk', name: 'Nanuk', title: 'Fur Trader', sheet: 'Eskimo', role: 'merchant', area: 'frost', at: [13.5, 30.5], night: 'sleep', shop: 'dovey',
    lines: ['Capes, hoods, anything warm. Your tunic will not cut it up here.', 'Wolves? No wolves this year. Just wisps.'] },
  { id: 'hildr', name: 'Hildr', title: 'Sentry', sheet: 'FighterRed', role: 'guard', area: 'frost', at: [15.5, 27.5], face: 'up', night: 'stay',
    lines: ['Nothing gets past the outpost on my watch.', 'The Warden below Tidehollow is nothing - wait until you meet what sleeps under this peak.', 'Stand in a glowing circle and you will regret it.'] },
  { id: 'oskar', name: 'Oskar', title: 'Fireside Storyteller', sheet: 'Shaman', role: 'ambient', area: 'frost', at: [7.5, 35.5], night: 'stay', face: 'right',
    lines: ['Once there was a slime so big it swallowed the sun...', 'Sit. Listen. The fire does not bite.'] },
  { id: 'ulla', name: 'Ulla', sheet: 'Villager4', role: 'ambient', area: 'frost', at: [4, 38], wander: 30, night: 'sleep',
    lines: ['Brrr! My nose is an icicle.', 'The soup here is thick enough to stand a spoon in.'] },
  { id: 'fenrir', name: 'Fenrir', title: 'Mountain Guide', sheet: 'NinjaGray', role: 'trainer', area: 'frost', at: [16, 36.5], night: 'stay',
    lines: ['Gear up before the pass. Level 11 is the minimum I would recommend.', 'Keep moving against wisps. Standing still is how they get you.'] },
  { id: 'tiki', name: 'Tiki', sheet: 'Child', role: 'ambient', area: 'frost', at: [12, 38], wander: 50, night: 'sleep',
    lines: ['Look, I made a snow-slime!', 'Do not tell Ulla I went near the pass.'] },
  { id: 'kaze', name: 'Kaze', title: 'Wind Ninja', sheet: 'NinjaLeaf', role: 'ambient', area: 'frost', at: [2.5, 28.5], wander: 14, night: 'stay',
    lines: ['The wind speaks to those who listen. Mostly it says "cold".', 'Ninja rule two: never reveal rule one.'] },
  ...EXTRA_NPCS, // desert / marsh / caverns hubs (data/npcsExtra.js)
];

// Extra idle/hint patter for the Thistle plaza (merged into the `lines` cycle of
// named townsfolk only if they have fewer than four).
export const GENERIC_HINTS = [
  'Tip: hold still next to a campfire to heal faster.',
  'Tip: bosses show red markers on the floor before they strike.',
  'Tip: zoom with - / = keys if the screen feels cramped.',
];

// Sheets the roster needs (loader pulls these lazily into CHARACTERS).
export const NPC_SHEETS = [...new Set(NPCS.map((n) => n.sheet))];
