// Data-driven quest catalogue (chains, singles, bounty templates, POIs, lore).
//
// Quest: { id, chain, name, giver, turnIn?, lv, zone, pre[], story, offer, remind, done, obj[], reward, choices? }
// Objective types: kill{id,n} collect{id,n} deliver{id,npc} talk{npc} explore{zone|area|poi}
//                  escort{npc,tex,from,to} use{id,n} interact{id} craft{id,n}
// Reward: { xp, gold, gear, mats:{id:n}, recipes[], statPoints, lore }
// `choices` (optional): [{label, reward}] shown at turn-in; the picked one is granted on top of `reward`.
// Legacy ids (q_meadow..q_final, sq_*) are kept so old saves migrate cleanly.

import { EXTRA_CHAINS, EXTRA_QUESTS, EXTRA_POIS, EXTRA_NPC_SPOTS, EXTRA_LORE, EXTRA_LORE_ON_ENTER } from './questsExtra.js';
import { PET_UNLOCK_QUEST } from './quests/petUnlock.js';
import { TUTORIAL_CHAIN, TUTORIAL_QUESTS } from './quests/tutorial2.js';
import { JOB_CHANGE_CHAINS, JOB_CHANGE_QUESTS } from './quests/jobChange.js';
import { WAVE6_CHAINS, WAVE6_QUESTS } from './quests/wave6.js';

export const NPC_SPOTS = {
  // wild quest givers (overworld tile coords) - WorldScene adds them as real NPCs
  'Farmer Hob': { tex: 'Villager3', tx: 43, ty: 66, zone: 'meadow', text: 'Mind the mud, friend. The meadow never dries out.' },
  'Forager Sable': { tex: 'Hunter', tx: 85, ty: 46, zone: 'woods', text: 'Quiet steps in Mosswood. The caplings are touchy.' },
  'Warden Tamsin': { tex: 'Inspector', tx: 50, ty: 83, zone: 'ruins', text: 'Tidehollow holds more than it shows. Stay sharp.' },
};

// Hand-placed points of interest. area:null = overworld tile coords; else area-relative tiles.
export const POIS = {
  woods_glade: { name: 'Moonlit Glade', area: null, tx: 100, ty: 30, r: 40 },
  ruins_altar: { name: 'Sunken Altar', area: null, tx: 38, ty: 104, r: 40 },
  meadow_lost: { name: 'Tilly\'s Hideout', area: null, tx: 26, ty: 70, r: 26 },
  town_plaza: { name: 'Thistle Plaza', area: null, tx: 64, ty: 66, r: 70 },
  beach_ne: { name: 'Driftwood Cove', area: 'dock', tx: 50, ty: 6, r: 34 },
  dock_square: { name: 'Harbour Square', area: 'dock', tx: 24, ty: 15, r: 40 },
};

const Q = (o) => ({ lv: 1, pre: [], obj: [], reward: {}, ...o });

export const CHAINS = {
  lantern: { id: 'lantern', name: 'The Lantern of Embervale', zones: 'Town, Meadow, Woods, Ruins', blurb: 'Thistle Town\'s lantern is failing. The fault lies far south, in Tidehollow.' },
  harbour: { id: 'harbour', name: 'Harbour Whispers', zones: 'Town, Dock', blurb: 'Letters, nets and strange tides on the coast.' },
  ashen: { id: 'ashen', name: 'Ashenmoor Awakens', zones: 'Crypt, Frostpeak', blurb: 'Something old is stirring beneath Tidehollow, and the cold is listening.' },
  hearth: { id: 'hearth', name: "Elda's Hearth", zones: 'Town, Meadow, Woods', blurb: "Granny Elda's herb lessons lead to Bram's forge." },
};

export const QUEST_LIST = [
  // ═══ Chain A: The Lantern of Embervale (Town -> Meadow -> Woods -> Ruins -> Crypt door) ═══
  Q({ id: 'q_meadow', chain: 'lantern', name: 'Field Notes', giver: 'Pip', lv: 1, zone: 'meadow',
    story: 'Pip tends the plaza lantern, but the meadow oil-wells are clogged with slimes.',
    offer: 'Slimes in the meadow, friend! They keep fouling the lantern oil wells. Thin out five of them and come tell me.',
    remind: 'Five Dew Slimes, out in the meadow. You can do it!',
    done: 'Five slimes fewer - the oil runs clear again! Take this cloak, it was my father\'s.',
    obj: [{ t: 'kill', id: 'dewslime', n: 5 }], reward: { xp: 60, gold: 25, gear: 'traveler_cloak' } }),
  Q({ id: 'q_woods', chain: 'lantern', name: 'Moss & Moths', giver: 'Pip', lv: 3, zone: 'woods', pre: ['q_meadow'],
    story: 'The oil is clean, but the wicks keep dying. Pip blames Thornmites nesting in Mosswood.',
    offer: 'The oil is clean now, but the wicks still gutter. I found thorny little nests in Mosswood. Would you clear five Thornmites?',
    remind: 'Thornmites in Mosswood, east of town. Five of them.',
    done: 'The wicks hold! Mosswood is safer too. These boots will get you further.',
    obj: [{ t: 'kill', id: 'thornmite', n: 5 }], reward: { xp: 140, gold: 60, gear: 'swift_boots', lore: 'lore_lantern' } }),
  Q({ id: 'q_ruins', chain: 'lantern', name: 'Tidehollow Lantern', giver: 'Maren', lv: 6, zone: 'ruins', pre: ['q_woods'],
    story: 'Maren recognises the lantern design: it was forged in Tidehollow, where bog spirits now drift.',
    offer: 'Pip showed me the lantern\'s maker\'s mark. Tidehollow! Its spirits have gone sour. Put three Bog Spirits to rest and I will make it worth your while.',
    remind: 'Three Bog Spirits deep in Tidehollow, south of town.',
    done: 'The ruins are quieter already. That glimmer orb is yours - it once lit the old gate.',
    obj: [{ t: 'kill', id: 'bogspirit', n: 3 }], reward: { xp: 300, gold: 150, gear: 'glimmer_orb' } }),
  Q({ id: 'q_ruins2', chain: 'lantern', name: 'Rattle & Rust', giver: 'Maren', lv: 7, zone: 'ruins', pre: ['q_ruins'],
    story: 'Rust Skulls still guard the old gate to the lower ruins.',
    offer: 'Rust Skulls guard the old gate, and something is waking them. Four should do for now.',
    remind: 'Four Rust Skulls at the old gate.',
    done: 'Good, good. Nobody has held that gate in a hundred years. Wear this with pride.',
    obj: [{ t: 'kill', id: 'rustskull', n: 4 }], reward: { xp: 380, gold: 180, gear: 'horned_helm', mats: { scroll_might: 1 } } }),
  Q({ id: 'q_final', chain: 'lantern', name: 'Eye of the Tide', giver: 'Maren', lv: 8, zone: 'ruins', pre: ['q_ruins2'],
    story: 'Tide Eyes keep the rift open. Close it and Maren will owe you one.',
    offer: 'Tide Eyes hold the rift open. Defeat two, bring me a sigil shard, and Maren will owe you one.',
    remind: 'Two Tide Eyes in the ruins.',
    done: 'You did it! The rift is shut. Keep this mantle, you earned it.',
    obj: [{ t: 'kill', id: 'tideeye', n: 2 }], reward: { xp: 520, gold: 260, gear: 'royal_mantle', mats: { tide_sigil: 1 } } }),
  Q({ id: 'q_sigil', chain: 'lantern', name: 'The Sigil Below', giver: 'Maren', turnIn: 'Captain Rusk', lv: 9, zone: 'town', pre: ['q_final'],
    story: 'The sigil pulses with cold light. Captain Rusk at the inn knows what sleeps beneath Tidehollow.',
    offer: 'This sigil is older than the town. Take it to Captain Rusk at the Sleepy Lantern. He has guarded the Crypt stairs for years.',
    remind: 'Bring the Tide Sigil to Captain Rusk in the inn.',
    done: 'Gods. A Tide Sigil. Ashenmoor is waking, then. I will need you down there, Wayfarer - come back when you are ready.',
    obj: [{ t: 'deliver', id: 'tide_sigil', npc: 'Captain Rusk' }], reward: { xp: 240, gold: 120, statPoints: 2, lore: 'lore_sigil' } }),

  // ═══ Chain B: Harbour Whispers (Town -> Dock) ═══
  Q({ id: 'q_letter', chain: 'harbour', name: 'Letter for the Dockmaster', giver: 'Brom', turnIn: 'Dockmaster Orla', lv: 2, zone: 'dock',
    story: 'Brom has a sealed letter for Dockmaster Orla but his shop cannot close.',
    offer: 'Sister Maren\'s stock ships through me, and I have a letter for Dockmaster Orla. Take the Harbour Gate south-east? I would be grateful.',
    remind: 'Deliver the sealed letter to Dockmaster Orla in Coastal Dock Town.',
    done: 'From Brom? Ha, he never writes. ...Oh. Oh, that is news. Thank you, traveller.',
    give: { sealed_letter: 1 }, obj: [{ t: 'deliver', id: 'sealed_letter', npc: 'Dockmaster Orla' }], reward: { xp: 90, gold: 40 } }),
  Q({ id: 'sq_crabs', chain: 'harbour', name: 'Crab Cull', giver: 'Dockmaster Orla', lv: 2, zone: 'dock', pre: ['q_letter'],
    story: 'Crabs have overrun Driftwood Beach and the nets are going unmended.',
    offer: 'Shore crabs have taken Driftwood Beach. Thin out six and the fishers can work again.',
    remind: 'Six Shore Crabs on Driftwood Beach, east of the harbour.',
    done: 'The beach is clear! Choose your thanks.',
    obj: [{ t: 'kill', id: 'shorecrab', n: 6 }], reward: { xp: 180, gold: 90 },
    choices: [{ label: 'Take a tip (+60g)', reward: { gold: 60 } }, { label: 'Take supplies (2 Greater Potions)', reward: { mats: { greater_potion: 2 } } }] }),
  Q({ id: 'sq_net', chain: 'harbour', name: "Garrick's Net", giver: 'Old Garrick', lv: 2, zone: 'dock', pre: ['sq_crabs'],
    story: "Old Garrick lost his net on the north-east beach. It was his father's.",
    offer: "My net, lad. Lost in the north-east corner of Driftwood Beach. It was my father's. Would you fetch it?",
    remind: 'Find the tangled net in the north-east corner of Driftwood Beach.',
    done: 'My net! Thirty years it has served me. Here, this is for you.',
    obj: [{ t: 'interact', id: 'garrick_net' }], reward: { xp: 140, gold: 70 } }),
  Q({ id: 'q_mackerel', chain: 'harbour', name: 'Silver Linings', giver: 'Fisher Dunn', lv: 3, zone: 'dock', pre: ['sq_net'],
    story: 'Fisher Dunn swears the mackerel run is on. Try a rod at the pier ends (press E at the ripples).',
    offer: 'Mackerel are running! But my back is gone. Fish three Silver Mackerel off the pier for the harbour supper. Look for ripples in the water and press E.',
    remind: 'Three Silver Mackerel. Fish at the ripples beside the piers (E to cast).',
    done: 'Beautiful! Silver as a new coin. Take the recipe: grilled, they are divine.',
    obj: [{ t: 'collect', id: 'silver_mackerel', n: 3 }], reward: { xp: 160, gold: 60, mats: { scroll_stew: 1 } } }),
  Q({ id: 'q_pippa', chain: 'harbour', name: 'Lost Kite', giver: 'Sailor Finn', lv: 3, zone: 'dock', pre: ['q_mackerel'],
    story: 'Little Mira wandered onto the beach chasing her kite. Walk her back to Harbour Square.',
    offer: 'Little Mira has wandered off again, chasing her kite onto Driftwood Cove. Walk her back to Harbour Square? Crabs are about, so stay close.',
    remind: 'Find Mira at Driftwood Cove and walk her to Harbour Square.',
    done: 'There you are, Mira! Thank you. She would have followed that kite to the moon.',
    obj: [{ t: 'escort', npc: 'Mira', tex: 'Child', from: 'beach_ne', to: 'dock_square' }], reward: { xp: 200, gold: 80, gear: 'feather_charm' } }),
  Q({ id: 'q_feast', chain: 'harbour', name: 'Harbour Feast', giver: 'Dockmaster Orla', lv: 4, zone: 'dock', pre: ['q_pippa'],
    story: 'The harbour is throwing a feast. Orla needs grilled fish, cooked on the campfire at the pier.',
    offer: 'The harbour is throwing a feast to thank you. Bring me two Grilled Fish. You can cook at the campfire on the quay.',
    remind: 'Craft two Grilled Fish at the campfire.',
    done: 'Gulls and gladness - the feast is perfect. You are a friend of the harbour, always.',
    obj: [{ t: 'craft', id: 'grilled_fish', n: 2 }], reward: { xp: 320, gold: 150, statPoints: 2, lore: 'lore_harbour' } }),

  // ═══ Chain C: Ashenmoor Awakens (Town inn -> Crypt -> Frostpeak) ═══
  Q({ id: 'sq_bones', chain: 'ashen', name: 'Bones and Barrows', giver: 'Captain Rusk', lv: 9, zone: 'crypt', pre: ['q_sigil'],
    story: 'Rusk needs the Crypt\'s guards put back to rest before anything worse wakes.',
    offer: 'The Crypt stairs are under Tidehollow. Put eight Bone Sentinels back to rest. Bring a torch and a friend if you have either.',
    remind: 'Eight Bone Sentinels in the Crypt of Ashenmoor.',
    done: 'Eight fewer. The dead sleep easier. Here, for your trouble.',
    obj: [{ t: 'kill', id: 'bonesentinel', n: 8 }], reward: { xp: 520, gold: 210 } }),
  Q({ id: 'q_bats', chain: 'ashen', name: 'Wings in the Dark', giver: 'Captain Rusk', lv: 10, zone: 'crypt', pre: ['sq_bones'],
    story: 'Grave Bats scatter the ossuary and drown out the warden\'s approach.',
    offer: 'Grave Bats keep nesting in the ossuaries. Five of them should do, then the road to the warden is clear.',
    remind: 'Five Grave Bats in the Crypt ossuaries.',
    done: 'Quiet at last. Next, the warden himself.',
    obj: [{ t: 'kill', id: 'gravebat', n: 5 }], reward: { xp: 560, gold: 220, mats: { greater_potion: 2 } } }),
  Q({ id: 'sq_warden', chain: 'ashen', name: 'Wake the Warden', giver: 'Captain Rusk', lv: 11, zone: 'crypt', pre: ['q_bats'],
    story: 'Warden Gravemaw guards the chamber at the top of the Crypt. End it.',
    offer: 'Warden Gravemaw sleeps atop the Crypt. It guards what lies below. Defeat it, Wayfarer.',
    remind: 'Defeat Warden Gravemaw in the chamber at the top of the Crypt.',
    done: 'Gravemaw... fallen. I never thought I would see it. Take this, you earned it twice over.',
    obj: [{ t: 'kill', id: 'gravemaw', n: 1 }], reward: { xp: 900, gold: 400, lore: 'lore_warden' } }),
  Q({ id: 'q_frostnote', chain: 'ashen', name: 'Word to the Pass', giver: 'Captain Rusk', turnIn: 'Scout Ilka', lv: 11, zone: 'frost', pre: ['sq_warden'],
    story: 'The cold from the north answers the Crypt. Rusk writes to Scout Ilka at Frostpeak Outpost.',
    offer: 'The cold in the north answers the Crypt. Take this note to Scout Ilka at Frostpeak Outpost, past the Frostpeak Pass gate, far north-west.',
    remind: 'Bring Rusk\'s note to Scout Ilka at Frostpeak Outpost.',
    done: 'From Rusk? Then it is true. Thank you for the long walk, I have a cold job that needs doing.',
    give: { frost_note: 1 }, obj: [{ t: 'deliver', id: 'frost_note', npc: 'Scout Ilka' }], reward: { xp: 400, gold: 150 } }),
  Q({ id: 'sq_wisps', chain: 'ashen', name: 'Cold Snap', giver: 'Scout Ilka', lv: 11, zone: 'frost', pre: ['q_frostnote'],
    story: 'Frost Wisps circle the pass, snuffing every torch.',
    offer: 'Frost Wisps snuff every torch along the pass. Douse six and my scouts can see again.',
    remind: 'Six Frost Wisps circling the pass.',
    done: 'Warm again! Thank you.',
    obj: [{ t: 'kill', id: 'frostwisp', n: 6 }], reward: { xp: 640, gold: 240 } }),
  Q({ id: 'sq_crawlers', chain: 'ashen', name: 'Rime Rot', giver: 'Scout Ilka', lv: 12, zone: 'frost', pre: ['sq_wisps'],
    story: 'Rime Crawlers gnaw the snowfield. Clear them and the pass is yours.',
    offer: 'Rime Crawlers are eating the snowfield alive. Clear five and Frostpeak is safe.',
    remind: 'Five Rime Crawlers in the snowfield.',
    done: 'The pass is open. You have done more for the north than the army ever did.',
    obj: [{ t: 'kill', id: 'rimecrawler', n: 5 }], reward: { xp: 780, gold: 300, statPoints: 3, lore: 'lore_frost' } }),

  // ═══ Chain D: Elda's Hearth (Town -> Meadow -> Woods -> forge) ═══
  Q({ id: 'q_elda1', chain: 'hearth', name: 'Sunpetal Tea', giver: 'Granny Elda', lv: 1, zone: 'meadow',
    story: 'Granny Elda\'s remedies need sunpetals from the meadow. Herbs glitter in the grass: press E to pick.',
    offer: 'Sunpetals, dear, for my tea. Golden flowers in the meadow, press E beside them. Four should do.',
    remind: 'Four Sunpetals from the meadow.',
    done: 'Lovely! Your hands have a green touch. Here, have a few vials for later.',
    obj: [{ t: 'collect', id: 'sunpetal', n: 4 }], reward: { xp: 40, gold: 15, mats: { empty_vial: 3 } } }),
  Q({ id: 'q_elda2', chain: 'hearth', name: 'Berry Good', giver: 'Granny Elda', lv: 1, zone: 'meadow', pre: ['q_elda1'],
    story: 'Bushes of dewberries dot the meadow. Elda wants a basket for her tarts.',
    offer: 'Now for sweetness: five dewberries from the meadow bushes, and I will teach you my tart.',
    remind: 'Five Dewberries from meadow bushes.',
    done: 'Plump as plums! Here, the tart recipe.',
    obj: [{ t: 'collect', id: 'dewberry', n: 5 }], reward: { xp: 50, gold: 15, recipes: ['berry_tart'] } }),
  Q({ id: 'q_elda3', chain: 'hearth', name: 'First Brew', giver: 'Granny Elda', lv: 2, zone: 'town', pre: ['q_elda2'],
    story: 'Time to brew. The alchemy table stands near Maren\'s stall in Thistle Town (U opens the crafting panel).',
    offer: 'Time to brew, dear. At the alchemy table by Maren\'s stall, make two Herbal Tonics. Press E at the table, or U for the craft panel.',
    remind: 'Craft two Herbal Tonics at the alchemy table near Maren.',
    done: 'Clear as spring water. You are a natural.',
    obj: [{ t: 'craft', id: 'herbal_tonic', n: 2 }], reward: { xp: 70, gold: 20, recipes: ['mana_draught'] } }),
  Q({ id: 'q_elda4', chain: 'hearth', name: "Maren's Verdict", giver: 'Granny Elda', lv: 2, zone: 'town', pre: ['q_elda3'],
    story: 'Elda wants Maren\'s opinion on your tonic, and you should taste your own work.',
    offer: 'Drink one of your tonics yourself, dear, then ask Maren what she thinks. A brewer who will not taste is no brewer.',
    remind: 'Drink a Herbal Tonic (open your Pack in the craft panel) and talk to Maren.',
    done: 'Elda sent you? Hm. Not bad at all! Not bad at all. I will stock your work.',
    turnIn: 'Maren',
    obj: [{ t: 'use', id: 'herbal_tonic', n: 1 }, { t: 'talk', npc: 'Maren' }], reward: { xp: 90, gold: 30 } }),
  Q({ id: 'q_elda5', chain: 'hearth', name: 'Mosswood Moonmoss', giver: 'Granny Elda', lv: 4, zone: 'woods', pre: ['q_elda4'],
    story: 'The best remedies need moonmoss, which grows only in the glow of Mosswood.',
    offer: 'Strong remedies need moonmoss. It glows in Mosswood, east of town. Gather four and visit the Moonlit Glade, the light there is healing.',
    remind: 'Four Moonmoss from Mosswood, and visit the Moonlit Glade.',
    done: 'Oh, it glows! Forgive an old woman her delight. Take this, and a word: Bram needs help at the forge.',
    obj: [{ t: 'collect', id: 'moonmoss', n: 4 }, { t: 'explore', poi: 'woods_glade' }], reward: { xp: 180, gold: 50, recipes: ['mushroom_skewer', 'swift_tonic'] } }),
  Q({ id: 'q_bram', chain: 'hearth', name: 'Forge Fuel', giver: 'Bram', lv: 5, zone: 'town', pre: ['q_elda5'],
    story: 'Bram\'s forge is cold: no logs, no iron. Gather oak from the meadow and iron ore from the old stones.',
    offer: 'Elda sent you? Good. The forge needs fuel and iron. Six oak logs and four iron ore. Ore sits in veins in Mosswood and the ruins.',
    remind: 'Six Oak Logs and four Iron Ore.',
    done: 'Now THAT is a pile of good iron. Stay and learn: I will teach you to smelt and to temper gear at the anvil.',
    obj: [{ t: 'collect', id: 'oak_log', n: 6 }, { t: 'collect', id: 'iron_ore', n: 4 }], reward: { xp: 260, gold: 90, statPoints: 2, recipes: ['iron_ingot', 'temper_weapon', 'temper_armor', 'temper_helm', 'guard_elixir'], lore: 'lore_hearth' } }),

  // ═══ Singles ═══
  Q({ id: 'q_tob', name: "Old Tob's Tale", giver: 'Old Tob', lv: 1, zone: 'town',
    story: 'Old Tob swears Tidehollow and the crypt are connected. Ask around town.',
    offer: 'Tidehollow and the crypt are one and the same hole, mark me. Ask young Tilly and Old Wick what they have heard, then come tell me if I am a fool.',
    remind: 'Talk to Tilly and Old Wick, then return to Tob.',
    done: 'They said the same? Then I am not senile yet. Here, a coin for your legs.',
    obj: [{ t: 'talk', npc: 'Tilly' }, { t: 'talk', npc: 'Old Wick' }], reward: { xp: 40, gold: 30, lore: 'lore_tob' } }),
  Q({ id: 'q_cartographer', name: "The Cartographer's Request", giver: 'Old Wick', lv: 4, zone: 'woods',
    story: 'Old Wick wants a fresh map: Mosswood, Tidehollow Ruins and Dock Town.',
    offer: 'My maps are forty years old. Visit Mosswood, Tidehollow and Dock Town, and I shall redraw them. Gold for each.',
    remind: 'Visit Mosswood, Tidehollow Ruins and Coastal Dock Town.',
    done: 'Ah, a fresh map! The edges are sharper than I remember. Here, pay.',
    obj: [{ t: 'explore', zone: 'woods' }, { t: 'explore', zone: 'ruins' }, { t: 'explore', area: 'dock' }], reward: { xp: 240, gold: 120 } }),
  Q({ id: 'q_hob1', name: 'Bat Trouble', giver: 'Farmer Hob', lv: 1, zone: 'meadow',
    story: 'Moss Bats keep stealing Farmer Hob\'s seed.',
    offer: 'Moss Bats keep pinching my seed! Would you chase off six of them? They nest in the long grass.',
    remind: 'Six Moss Bats in the meadow.',
    done: 'Ha! Seeds will sprout. Thank you, friend.',
    obj: [{ t: 'kill', id: 'mossbat', n: 6 }], reward: { xp: 70, gold: 25, mats: { dewberry: 3 } } }),
  Q({ id: 'q_hob2', name: 'Slime Jam', giver: 'Farmer Hob', lv: 2, zone: 'meadow', pre: ['q_hob1'],
    story: 'Hob swears slime gel makes the best fence paste.',
    offer: 'Slime gel! Makes the best fence paste. Bring me six blobs and I will pay handsomely.',
    remind: 'Six Slime Gel from Dew Slimes.',
    done: 'Sticky, sweet, and sturdy. You are a fine friend.',
    obj: [{ t: 'collect', id: 'slime_gel', n: 6 }], reward: { xp: 90, gold: 45 } }),
  Q({ id: 'q_sable', name: 'Spore Season', giver: 'Forager Sable', lv: 4, zone: 'woods',
    story: 'Caplings shed the spores Sable uses in her remedies.',
    offer: 'Caplings shed the spores I need for my skewers. Gather five Cap Spores from those little ones, will you?',
    remind: 'Five Cap Spores from Caplings.',
    done: 'Perfect. These will season a dozen meals.',
    obj: [{ t: 'collect', id: 'cap_spore', n: 5 }], reward: { xp: 150, gold: 60, recipes: ['mushroom_skewer'] } }),
  Q({ id: 'q_tamsin', name: 'Sealing Stones', giver: 'Warden Tamsin', lv: 7, zone: 'ruins',
    story: 'Tamsin needs iron to reinforce the ruin gate and a look at the Sunken Altar.',
    offer: 'The old gate needs iron staves, and I need eyes on the Sunken Altar. Four iron ore, and a look at the altar.',
    remind: 'Four Iron Ore and visit the Sunken Altar.',
    done: 'The altar still hums. Good. Stay alert, there is more below.',
    obj: [{ t: 'collect', id: 'iron_ore', n: 4 }, { t: 'explore', poi: 'ruins_altar' }], reward: { xp: 300, gold: 130, mats: { guard_elixir: 1 } } }),

  PET_UNLOCK_QUEST,
];

QUEST_LIST.push(...EXTRA_QUESTS); // desert / marsh / caverns / Hollow Depths / world-event quests (data/questsExtra.js)
QUEST_LIST.push(...TUTORIAL_QUESTS); // onboarding chain: First Steps -> Egg Tales (data/quests/tutorial2.js)
QUEST_LIST.push(...JOB_CHANGE_QUESTS); // RO-style job-change trial chains (data/quests/jobChange.js)
QUEST_LIST.push(...WAVE6_QUESTS); // mid-game chains: The Ashen Watch / The Fen Watch (data/quests/wave6.js)
export const QUESTS_BY_ID = Object.fromEntries(QUEST_LIST.map((q) => [q.id, q]));

// Legacy (pre-v2) quest order: questState.idx indexed these.
export const LEGACY_MAIN = ['q_meadow', 'q_woods', 'q_ruins', 'q_ruins2', 'q_final'];
export const LEGACY_SIDE = ['sq_crabs', 'sq_net', 'sq_bones', 'sq_warden', 'sq_wisps', 'sq_crawlers'];

// Bounty templates (notice board). Reward scales with player level at accept time.
export const BOUNTY_TEMPLATES = [
  { id: 'bt_slime', name: 'Slime Sweep', lv: [1, 5], zone: 'meadow', obj: { t: 'kill', id: 'dewslime', n: 8 }, text: 'Clear eight Dew Slimes from the meadow.' },
  { id: 'bt_bat', name: 'Bat Patrol', lv: [1, 6], zone: 'meadow', obj: { t: 'kill', id: 'mossbat', n: 8 }, text: 'Chase eight Moss Bats off the farms.' },
  { id: 'bt_herbs', name: 'Herb Run', lv: [1, 99], zone: 'meadow', obj: { t: 'collect', id: 'sunpetal', n: 6 }, text: 'Bring six Sunpetals for the apothecary.' },
  { id: 'bt_berry', name: 'Berry Basket', lv: [1, 99], zone: 'meadow', obj: { t: 'collect', id: 'dewberry', n: 8 }, text: 'Pick eight Dewberries for the harvest pies.' },
  { id: 'bt_thorn', name: 'Mosswood Pest Control', lv: [4, 9], zone: 'woods', obj: { t: 'kill', id: 'thornmite', n: 8 }, text: 'Cull eight Thornmites in Mosswood.' },
  { id: 'bt_cap', name: 'Cap Culling', lv: [4, 9], zone: 'woods', obj: { t: 'kill', id: 'capling', n: 8 }, text: 'Trim eight Caplings in Mosswood.' },
  { id: 'bt_moss', name: 'Moss Harvest', lv: [4, 99], zone: 'woods', obj: { t: 'collect', id: 'moonmoss', n: 6 }, text: 'Gather six Moonmoss for the night market.' },
  { id: 'bt_wisp', name: 'Wisp Watch', lv: [5, 12], zone: 'woods', obj: { t: 'kill', id: 'willowisp', n: 6 }, text: 'Douse six Willowisps before dark.' },
  { id: 'bt_rust', name: 'Gate Duty', lv: [8, 14], zone: 'ruins', obj: { t: 'kill', id: 'rustskull', n: 6 }, text: 'Smash six Rust Skulls at the old gate.' },
  { id: 'bt_bog', name: 'Bog Watch', lv: [8, 14], zone: 'ruins', obj: { t: 'kill', id: 'bogspirit', n: 6 }, text: 'Settle six Bog Spirits in Tidehollow.' },
  { id: 'bt_ore', name: 'Iron for the Smith', lv: [5, 99], zone: 'ruins', obj: { t: 'collect', id: 'iron_ore', n: 5 }, text: 'Bring five Iron Ore to the smithy.' },
  { id: 'bt_fish', name: "Cook's Catch", lv: [1, 99], zone: 'dock', obj: { t: 'collect', id: 'pond_carp', n: 3 }, text: 'Catch three Pond Carp for the plaza stew.' },
  { id: 'bt_sent', name: 'Crypt Patrol', lv: [9, 99], zone: 'crypt', obj: { t: 'kill', id: 'bonesentinel', n: 6 }, text: 'Put six Bone Sentinels to rest.' },
  { id: 'bt_frost', name: 'Frost Patrol', lv: [11, 99], zone: 'frost', obj: { t: 'kill', id: 'frostwisp', n: 6 }, text: 'Douse six Frost Wisps in the pass.' },
];

// Lore pages (unlocked by finishing quests that name them, or by the flags below)
export const LORE = {
  lore_tob: { name: "Old Tob's Hunch", text: 'Tob swears that Tidehollow and the Crypt of Ashenmoor are one hole, dug in two ages. Tilly heard groans under the cliffs; Wick remembers the old Harbour Gate rotting away. Maybe Tob is right.' },
  lore_lantern: { name: 'The Plaza Lantern', text: 'Thistle Town\'s plaza lantern is older than the town. Pip\'s father lit it each dusk; the flame never needed oil until the slimes came. Its maker\'s mark points south, to Tidehollow.' },
  lore_sigil: { name: 'The Tide Sigil', text: 'The Tide Sigil is a key-shard. It pulses cold when Ashenmoor stirs. Captain Rusk says there are seven. Maren only ever found one.' },
  lore_harbour: { name: 'Harbour Custom', text: 'Coastal Dock Town hangs a lantern for every safe return. The feast after the crab cull is the first in a decade.' },
  lore_warden: { name: 'Warden Gravemaw', text: 'Gravemaw was not a monster once. Rusk whispers that it was the captain of the Ashenmoor guard, bound to its post by the same sigil that opens the crypt.' },
  lore_frost: { name: 'The Cold Answers', text: 'Whatever sleeps beneath Ashenmoor has a twin in the snows. The Frost Wisps are its breath. Ilka guards the pass so the winter does not walk south.' },
  lore_hearth: { name: "Elda's Rule of Three", text: "Elda's rule: pick with care, brew with patience, share with neighbours. Bram adds: and never forget to temper the blade." },
  lore_meadow: { name: 'Meadowfield', text: 'The meadow is the town\'s larder: sunpetals, dewberries and a great many slimes. Nobody has ever explained the slimes.' },
  lore_woods: { name: 'Mosswood', text: 'Mosswood glows faintly at night where moonmoss grows. Foragers say you can tell the season by which mushrooms are angry.' },
  lore_ruins: { name: 'Tidehollow', text: 'Tidehollow sank when the tide-gods left. The Rust Skulls wear what remains of the harbour guard.' },
  lore_crypt: { name: 'Ashenmoor', text: 'Ashenmoor\'s crypts run deep. The upper halls are for warriors, the ossuaries for the forgotten, the warden\'s chamber for the one who would not rest.' },
  lore_frostpass: { name: 'Frostpeak Pass', text: 'Frostpeak Pass is the only road north. Snow hides crevasses, and wisps hide worse.' },
  lore_dock: { name: 'Coastal Dock Town', text: 'Dock Town started as a single pier. Fishermen say mackerel respect the pier ends more than any law.' },
};
// Lore unlocked by first entering a zone/area.
export const LORE_ON_ENTER = { meadow: 'lore_meadow', woods: 'lore_woods', ruins: 'lore_ruins', crypt: 'lore_crypt', frost: 'lore_frostpass', dock: 'lore_dock' };

Object.assign(CHAINS, EXTRA_CHAINS);
Object.assign(CHAINS, { tutorial: TUTORIAL_CHAIN });
Object.assign(CHAINS, JOB_CHANGE_CHAINS);
Object.assign(CHAINS, WAVE6_CHAINS);
Object.assign(POIS, EXTRA_POIS);
Object.assign(NPC_SPOTS, EXTRA_NPC_SPOTS);
Object.assign(LORE, EXTRA_LORE);
Object.assign(LORE_ON_ENTER, EXTRA_LORE_ON_ENTER);
