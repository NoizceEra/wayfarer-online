// Wave 6 — two mid-game quest chains (player level roughly 8-15), DATA ONLY, additive.
//
// Engine contract (src/systems/questSystem.js + src/data/quests.js header):
//   Objective types: kill{id,n} collect{id,n} deliver{id,npc} talk{npc}
//                    explore{zone|area|poi} escort{npc,tex,from,to}
//                    use{id,n} interact{id} craft{id,n}
//                    skill{id,n} daily{n?} pethatch{id?,n?}
//   Reward: { xp, gold, gear, mats:{id:n}, recipes[], statPoints, lore }
//
// This file uses ONLY the five objective types the brief asks for and the
// engine's _bump / checkLoreAndExplore / prog paths already handle:
//   kill      -> { t:'kill', id, n }              (onKill <- ENEMY_TABLE type id)
//   collect   -> { t:'collect', id, n }           (live pack count via onPack; matById)
//   talk      -> { t:'talk', npc }                (quests.talk on registered NPC name)
//   explore   -> { t:'explore', poi }             (POIS key, proximity credit)
//                { t:'explore', area }             (built area id, e.g. crypt / marsh)
//   deliver   -> { t:'deliver', id, npc }         (ready when mat is in pack; item
//                                                  granted via `give` on accept, cons-
//                                                  umed at turn-in by complete()).
// Reward fields used: xp, gold, mats:{id:n}, recipes[], statPoints. No gear/lore
// (gear ids and lore ids are a separate catalogue; see docs/WAVE6_QUESTS.md).
//
// Id provenance (all grepped, see the id-verification table in docs/WAVE6_QUESTS.md):
//   mobs   jobs.js + worldEnemies.js + enemiesExtra.js (ENEMY_TABLE keys)
//   mats   materials.js + materialsExtra.js (MATS / matById keys)
//   npcs   registered giver names: Captain Rusk + Granny Elda (world/areaBuilders.js),
//          Warden Tamsin (quests.js NPC_SPOTS), Fenwarden Moss + Herbwife Briar
//          (data/npcsExtra.js roster, placed by world/townfolk.populateArea)
//   pois   quests.js POIS  |  areas  areas.js AREAS + areasExtra.js EXTRA_AREAS
//   recipes crafting.js RECIPES
//
// Both chains are linear (`pre` prerequisites), non-repeat (no `repeat` flag),
// one-time rewards, and require no engine change. Registration is the parent's
// job (must run BEFORE the QUESTS_BY_ID map is built in quests.js):
//   import { WAVE6_CHAINS, WAVE6_QUESTS } from './quests/wave6.js';
//   QUEST_LIST.push(...WAVE6_QUESTS);
//   Object.assign(CHAINS, WAVE6_CHAINS);
// (mirrors the TUTORIAL_QUESTS / JOB_CHANGE_QUESTS wiring already in quests.js)

export const WAVE6_CHAINS = {
  ashen_watch: {
    id: 'ashen_watch', name: 'The Ashen Watch',
    zones: 'Thistle Town, Tidehollow Ruins, Crypt',
    blurb: 'Warden Tamsin and Captain Rusk open the ruin watch to a newcomer worth vouching for.',
  },
  fen_watch: {
    id: 'fen_watch', name: 'The Fen Watch',
    zones: 'Whisperfen Marsh',
    blurb: 'The will-o-wisps burn too bright, and Fenwarden Moss means to find out why.',
  },
};

// Chain default: level 8 (mid-game), no prereqs, no objectives, no reward.
const W = (o) => ({ lv: 8, pre: [], obj: [], reward: {}, ...o });

export const WAVE6_QUESTS = [
  // ═══ Chain 1: The Ashen Watch (Town -> Tidehollow Ruins -> Crypt -> Town) ═══
  W({ id: 'aw_answer', chain: 'ashen_watch', name: 'The Watch Answers', giver: 'Captain Rusk', turnIn: 'Warden Tamsin', zone: 'ruins',
    story: 'Rusk will not post a name to the ruin watch until Tamsin, who trusts no one, vouches for them.',
    offer: 'Warden Tamsin keeps the ruin watch and vouches for no one Rusk has not sent. Find her at Tidehollow, look the Sunken Altar over with her, and she will judge whether the watch has room for you.',
    remind: 'Report to Warden Tamsin at the Sunken Altar in Tidehollow.',
    done: 'Rusk sent you, did he? Then look at the altar - really look, the way a watcher looks. ...Good. The watch will take you.',
    obj: [{ t: 'talk', npc: 'Warden Tamsin' }, { t: 'explore', poi: 'ruins_altar' }],
    reward: { xp: 180, gold: 75 } }),
  W({ id: 'aw_salvage', chain: 'ashen_watch', name: 'Salvage the Watch', giver: 'Warden Tamsin', zone: 'ruins', pre: ['aw_answer'],
    story: 'The watch rebuilds its barricades from whatever the drowned ruins give up.',
    offer: 'The barricades rot faster than we can mend them. Bring me four Rust Scrap off the gate skulls and three Bone Shard from the crypt sleepers. Ugly, but it holds.',
    remind: 'Gather 4 Rust Scrap (Rust Skulls) and 3 Bone Shard (Bone Sentinels).',
    done: 'Scrap and bone. The gate will stand another winter. You have watch eyes after all.',
    obj: [{ t: 'collect', id: 'rust_scrap', n: 4 }, { t: 'collect', id: 'bone_shard', n: 3 }],
    reward: { xp: 340, gold: 140, mats: { guard_elixir: 1 } } }),
  W({ id: 'aw_gate', chain: 'ashen_watch', name: 'Hold the Old Gate', giver: 'Warden Tamsin', zone: 'ruins', pre: ['aw_salvage'],
    story: 'Rust Skulls rattle the old gate while bog spirits drift through the breach behind them.',
    offer: 'Four Rust Skulls rattle at the old gate, and three Bog Spirits drift through the breach behind them. Hold the line, Wayfarer. Do not let a single one past you.',
    remind: 'Defeat 4 Rust Skulls and 3 Bog Spirits in Tidehollow.',
    done: 'The gate holds, and it holds because of you. The watch owes you a barricade of thanks.',
    obj: [{ t: 'kill', id: 'rustskull', n: 4 }, { t: 'kill', id: 'bogspirit', n: 3 }],
    reward: { xp: 430, gold: 175, mats: { greater_potion: 1 } } }),
  W({ id: 'aw_ledger', chain: 'ashen_watch', name: 'A Ledger in Grave Dust', giver: 'Captain Rusk', turnIn: 'Granny Elda', zone: 'town', pre: ['aw_gate'],
    story: 'Rusk wants the crypt dust read by the one alchemist who remembers the old plague.',
    offer: 'Granny Elda reads the old dust better than any scholar. Carry her three Grave Dust off the crypt sleepers - she will know what is waking down there, and why.',
    remind: 'Deliver 3 Grave Dust to Granny Elda at her cottage.',
    done: 'Grave dust, is it? Hm. ...Ashenmoor is not merely waking, dear. It is remembering. Tell Rusk I said so.',
    give: { grave_dust: 3 },
    obj: [{ t: 'deliver', id: 'grave_dust', npc: 'Granny Elda' }],
    reward: { xp: 380, gold: 165, recipes: ['guard_elixir'] } }),
  W({ id: 'aw_breach', chain: 'ashen_watch', name: 'Into the Breach', giver: 'Captain Rusk', zone: 'crypt', pre: ['aw_ledger'],
    story: 'Rusk fears the crypt below Tidehollow stands open. Descend and count the sleepers still on their posts.',
    offer: 'So the crypt is open. Go down, walk its halls until you find the Bone Sentinels standing their old posts, and put four of them back to rest. Bring back three Tide Shard - the eyes that guard them will not part with one easily.',
    remind: 'Defeat 4 Bone Sentinels in the Crypt of Ashenmoor, then gather 3 Tide Shard.',
    done: 'Four sleepers set down, and the shards to prove it. The watch will remember your name, Wayfarer.',
    obj: [{ t: 'kill', id: 'bonesentinel', n: 4 }, { t: 'collect', id: 'tide_shard', n: 3 }, { t: 'explore', area: 'crypt' }],
    reward: { xp: 560, gold: 225, mats: { greater_potion: 2 }, statPoints: 1 } }),
  W({ id: 'aw_eye', chain: 'ashen_watch', name: 'The Eye That Watches', giver: 'Warden Tamsin', zone: 'ruins', pre: ['aw_breach'],
    story: 'A Tide Eye anchors the whole breach, and Tamsin means to have it unmade.',
    offer: 'One Tide Eye anchors the breach - you have felt it watching you since you went below. Unmake it. Two of them, if you have the nerve for it.',
    remind: 'Defeat 2 Tide Eyes in Tidehollow.',
    done: 'Unmade, and the old gate breathes easier for it. You are watch, Wayfarer - swear it or not.',
    obj: [{ t: 'kill', id: 'tideeye', n: 2 }],
    reward: { xp: 620, gold: 250, statPoints: 2 } }),

  // ═══ Chain 2: The Fen Watch (Whisperfen Marsh) ═══
  W({ id: 'fw_lights', chain: 'fen_watch', name: 'Lights on the Boardwalk', giver: 'Fenwarden Moss', zone: 'marsh', lv: 10,
    story: 'The will-o-wisps burn brighter than Moss has ever seen, and Briar has not slept.',
    offer: 'The wisps burn brighter than I have ever seen them, and Briar has not slept for it. Douse five of the lights, then go tell Briar the boardwalk is safer. Stay on the planks.',
    remind: 'Douse 5 Will-o-Wisps in the fen, then speak to Herbwife Briar.',
    done: 'Five lights out, and Briar warned. Good. Something is feeding those wisps, and I mean to find what.',
    obj: [{ t: 'kill', id: 'mwisp', n: 5 }, { t: 'talk', npc: 'Herbwife Briar' }, { t: 'explore', area: 'marsh' }],
    reward: { xp: 500, gold: 175, mats: { herbal_tonic: 2 } } }),
  W({ id: 'fw_harvest', chain: 'fen_watch', name: 'Briar\'s Basket', giver: 'Herbwife Briar', zone: 'marsh', lv: 10, pre: ['fw_lights'],
    story: 'Briar brews a lantern-tea strong enough to hold the dark back, but her basket is bare.',
    offer: 'A lantern-tea for the long mist - but my basket is bare and the mist is coming. Five Glowcaps off the hummocks, and three Fen Lily from the shallows. Mind the toads; they bite.',
    remind: 'Gather 5 Glowcap and 3 Fen Lily in the fen.',
    done: 'Bright caps and pale lilies, every one. This will hold a lamp burning until dawn. Take a draught for the road.',
    obj: [{ t: 'collect', id: 'glow_cap', n: 5 }, { t: 'collect', id: 'fen_lily', n: 3 }],
    reward: { xp: 540, gold: 185, mats: { mana_draught: 2 } } }),
  W({ id: 'fw_toads', chain: 'fen_watch', name: 'Toads on the Planks', giver: 'Fenwarden Moss', zone: 'marsh', lv: 11, pre: ['fw_harvest'],
    story: 'Fen Toads have overrun the stilt-rafts, and leeches work beneath them.',
    offer: 'The toads are all over the rafts again, and leeches under the planks for good measure. Eight toads, five leeches, and the fisherfolk can work the fen come morning.',
    remind: 'Defeat 8 Fen Toads and 5 Mire Leeches in the fen.',
    done: 'The rafts are clear. You have fen hands now, Wayfarer - steady ones.',
    obj: [{ t: 'kill', id: 'mtoad', n: 8 }, { t: 'kill', id: 'mleech', n: 5 }],
    reward: { xp: 620, gold: 205, mats: { greater_potion: 1 } } }),
  W({ id: 'fw_tonic', chain: 'fen_watch', name: 'A Draught for the Wardens', giver: 'Herbwife Briar', turnIn: 'Fenwarden Moss', zone: 'marsh', lv: 11, pre: ['fw_toads'],
    story: 'Briar\'s lantern-tea is brewed at last. Carry it to Moss at the Fenwatch stilts.',
    offer: 'Here - the tonic is brewed, and toad slime binds it. Carry it to Moss at the Fenwatch stilts and tell him the light will hold the whole night through.',
    remind: 'Deliver the tonic (4 Toad Slime) to Fenwarden Moss.',
    done: 'Briar\'s brew, is it? Then the light will hold. You carry good news better than most carry swords.',
    give: { toad_slime: 4 },
    obj: [{ t: 'deliver', id: 'toad_slime', npc: 'Fenwarden Moss' }],
    reward: { xp: 560, gold: 200, mats: { empty_vial: 2 } } }),
  W({ id: 'fw_deep', chain: 'fen_watch', name: 'What Feeds the Lights', giver: 'Fenwarden Moss', zone: 'marsh', lv: 12, pre: ['fw_tonic'],
    story: 'Wisp-light runs toward the far reach, where the Gloom Kappa nest over something they hoard.',
    offer: 'Glowcaps and wisp-light both run toward the far reach, where the Gloom Kappa nest. Four kappa, three lurkers, and we will see what they have been hoarding out there.',
    remind: 'Defeat 4 Gloom Kappa and 3 Mire Lurkers in the fen.',
    done: 'So that is what fed the lights. You have done the fen a kindness it will not soon forget.',
    obj: [{ t: 'kill', id: 'mkappa', n: 4 }, { t: 'kill', id: 'mirelurker', n: 3 }],
    reward: { xp: 720, gold: 235, mats: { guard_elixir: 1 }, statPoints: 1 } }),
  W({ id: 'fw_gloomtoad', chain: 'fen_watch', name: 'The Old Gloomtoad', giver: 'Fenwarden Moss', zone: 'marsh', lv: 13, pre: ['fw_deep'],
    story: 'The Gloomtoad broods on its island and dreams the lights. While it breathes, the fen cannot sleep.',
    offer: 'It was never the wisps, Wayfarer - the Old Gloomtoad dreams them. Row out to the island in the north-east and end the dream. Bring me a Wisp Lantern from the isle, so I know you stood where it sleeps.',
    remind: 'Defeat the Old Gloomtoad on its island in the north-east of the fen, then bring back 3 Wisp Lantern.',
    done: 'The fen sighs, and sleeps at last. Whatever else you are, the marsh calls you warden now.',
    obj: [{ t: 'kill', id: 'gloomtoad', n: 1 }, { t: 'collect', id: 'wisp_lantern', n: 3 }],
    reward: { xp: 1700, gold: 520, statPoints: 2 } }),
];
