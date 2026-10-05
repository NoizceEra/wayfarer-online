// Job-change trial quest chains — DATA ONLY, purely additive.
// Ragnarok Online parallel: each level-10 advanced job gets a 3-step trial
// chain. Every chain opens at level 9 (lv: 9 on the first step) and is
// completable pre-10: all kills/collects/explores are in the
// town/meadow/woods/ruins/dock zones, no crypt/frost/caverns/desert.
//
// Engine contract (src/systems/questSystem.js + src/data/quests.js header):
//   Objective types: kill{id,n} collect{id,n} deliver{id,npc} talk{npc}
//                    explore{zone|area|poi} escort{npc,tex,from,to}
//                    use{id,n} interact{id} craft{id,n}
//                    skill{id,n} daily{n?} pethatch{id?,n?}
//   Reward: { xp, gold, gear, mats:{id:n}, recipes[], statPoints, lore }
// This file uses ONLY kill/collect/talk/explore/skill objectives and ONLY
// xp/gold/mats rewards. No deliver (dodges item-grant edge cases), no
// escort/interact/craft/use (all need world hooks the trials don't need).
// skill steps use id arrays (['dash','blink']) — questSystem._bump matches
// Array.isArray(o.id), so every base class can complete them.
// Enemy ids (dewslime, thornmite, capling, willowisp, bogspirit, rustskull,
// tideeye, shorecrab, mossbat) all spawn in pre-10 zones (worldEnemies.js,
// areas.js). Collect ids (sunpetal, moonmoss, dewberry) are meadow/woods
// pickups. POIs (town_plaza, woods_glade, ruins_altar, dock_square) are in
// quests.js POIS. Giver NPCs are all established quest givers in quests.js.
//
// Chains: linear `pre` prerequisites, lv 9 throughout, non-repeat (no
// `repeat` flag), one-time rewards. Registration is the parent's job — see
// docs/JOB_CHANGE.md for the exact snippet (must run BEFORE the
// QUESTS_BY_ID map is built in quests.js).

export const JOB_CHANGE_CHAINS = {
  job_knight: { id: 'job_knight', name: 'Trial of the Bulwark', zones: 'Town, Ruins', blurb: 'Captain Rusk tests would-be Knights at the old Tidehollow gate.' },
  job_lanternwarden: { id: 'job_lanternwarden', name: 'Trial of the Lantern', zones: 'Town, Meadow, Woods', blurb: 'Pip seeks keepers for the plaza lantern before its light gutters out.' },
  job_hunter: { id: 'job_hunter', name: 'Trial of the Longbow', zones: 'Woods', blurb: 'Forager Sable proves keen eyes in the thickets of Mosswood.' },
  job_wildwarden: { id: 'job_wildwarden', name: 'Trial of Root and Remedy', zones: 'Meadow, Woods', blurb: 'Granny Elda sends green hands into Mosswood to mend what is blighted.' },
  job_elementalist: { id: 'job_elementalist', name: 'Trial of the Raw Current', zones: 'Town, Ruins', blurb: 'Maren demands proof that a caster can hold raw power without breaking.' },
  job_tidecaller: { id: 'job_tidecaller', name: 'Trial of the Turning Tide', zones: 'Dock, Ruins', blurb: 'Dockmaster Orla reads the strange tides for those who would call them.' },
  job_shadowblade: { id: 'job_shadowblade', name: 'Trial of the Quiet Knife', zones: 'Meadow, Ruins', blurb: 'Warden Tamsin watches from the dark to name the next shadow.' },
  job_trickster: { id: 'job_trickster', name: 'Trial of the Crooked Smile', zones: 'Town, Meadow', blurb: 'Old Tob laughs at straight roads and rewards those who walk crooked.' },
};

const J = (o) => ({ lv: 9, pre: [], obj: [], reward: {}, ...o });

export const JOB_CHANGE_QUESTS = [
  // ═══ Knight (base: wayfarer) — giver: Captain Rusk ═══
  J({ id: 'jk_oath', chain: 'job_knight', name: 'Swear the Oath', giver: 'Captain Rusk', zone: 'town',
    story: 'Rusk swears no soft hand holds the Tidehollow gate. Kneel, listen, and take the oath.',
    offer: 'You want to stand the gate, do you? Then kneel. Hear the oath of the bulwark, and swear it back to me.',
    remind: 'Report to Captain Rusk and swear the oath of the bulwark.',
    done: 'Risen, sworn, and steady. Now prove the oath means something.',
    obj: [{ t: 'talk', npc: 'Captain Rusk' }],
    reward: { xp: 150, gold: 60 } }),
  J({ id: 'jk_gate', chain: 'job_knight', name: 'Hold the Gate', giver: 'Captain Rusk', zone: 'ruins', pre: ['jk_oath'],
    story: 'Rust Skulls still rattle at the old Tidehollow gate. A Knight does not yield it.',
    offer: 'Words are wind. Four Rust Skulls rattle at the old gate even now. Break them, hold the line, and return.',
    remind: 'Defeat four Rust Skulls at the old Tidehollow gate.',
    done: 'The gate held. You held it. One trial remains.',
    obj: [{ t: 'kill', id: 'rustskull', n: 4 }],
    reward: { xp: 320, gold: 130, mats: { greater_potion: 1 } } }),
  J({ id: 'jk_duel', chain: 'job_knight', name: 'Eye to Eye', giver: 'Captain Rusk', zone: 'ruins', pre: ['jk_gate'],
    story: 'Tide Eyes watch the gate for weakness. Meet one stare-for-stare and do not blink first.',
    offer: 'Two Tide Eyes watch the gate, waiting for a weak moment. Give them a strong one instead. Do not come back blinking.',
    remind: 'Defeat two Tide Eyes in Tidehollow.',
    done: 'Eye to eye, and you never blinked. The bulwark has a new Knight.',
    obj: [{ t: 'kill', id: 'tideeye', n: 2 }],
    reward: { xp: 420, gold: 170, mats: { guard_elixir: 1 } } }),

  // ═══ Lantern Warden (base: wayfarer) — giver: Pip ═══
  J({ id: 'jl_spark', chain: 'job_lanternwarden', name: 'Tend the Spark', giver: 'Pip', zone: 'town', pre: [],
    story: 'Pip tends the plaza lantern alone and needs hands that understand light.',
    offer: 'The plaza lantern gutters every dusk and I am only one pair of hands! Come to Thistle Plaza, hear what the light needs, and we will see if you are keeper-stock.',
    remind: 'Meet Pip at Thistle Plaza and hear out the lantern-keeper.',
    done: 'You listened to a lantern. Most folk never do. Good.',
    obj: [{ t: 'talk', npc: 'Pip' }, { t: 'explore', poi: 'town_plaza' }],
    reward: { xp: 150, gold: 60 } }),
  J({ id: 'jl_oil', chain: 'job_lanternwarden', name: 'Oil for the Light', giver: 'Pip', zone: 'meadow', pre: ['jl_spark'],
    story: 'Lantern oil starts as meadow sunpetals. Gather them golden and unbruised.',
    offer: 'Oil starts as flowers, friend — four sunpetals from the meadow, golden and unbruised. The light can taste a careless hand.',
    remind: 'Gather four Sunpetals in the meadow.',
    done: 'Golden, every one. You have gentle hands. Now the hard part.',
    obj: [{ t: 'collect', id: 'sunpetal', n: 4 }],
    reward: { xp: 300, gold: 120, mats: { empty_vial: 2 } } }),
  J({ id: 'jl_rekindle', chain: 'job_lanternwarden', name: 'Rekindle the Glade', giver: 'Pip', zone: 'woods', pre: ['jl_oil'],
    story: 'Willowisps in Mosswood snuff every stray flame. Drive them back so the light can spread.',
    offer: 'Willowisps hate lanterns — four of them drift in Mosswood, snuffing every spark. Drive them back and the light goes with you.',
    remind: 'Defeat four Willowisps in Mosswood.',
    done: 'The glade burns steady. Keeper, the lantern is yours to ward.',
    obj: [{ t: 'kill', id: 'willowisp', n: 4 }],
    reward: { xp: 420, gold: 170, mats: { sunpetal: 3 } } }),

  // ═══ Hunter (base: ranger) — giver: Forager Sable ═══
  J({ id: 'jh_eye', chain: 'job_hunter', name: 'Keen Eyes', giver: 'Forager Sable', zone: 'woods', pre: [],
    story: 'Sable trusts no bow she has not seen draw. Come quiet into Mosswood and listen.',
    offer: 'Hunters hear before they shoot. Come into Mosswood, quiet steps, and hear what I hear before you loose a single shaft.',
    remind: 'Find Forager Sable in Mosswood and learn the hunter’s listen.',
    done: 'Still as stone. You might make a bow sing yet.',
    obj: [{ t: 'talk', npc: 'Forager Sable' }],
    reward: { xp: 150, gold: 60 } }),
  J({ id: 'jh_thorn', chain: 'job_hunter', name: 'Thin the Thicket', giver: 'Forager Sable', zone: 'woods', pre: ['jh_eye'],
    story: 'Thornmites nest thick along the game trails. Clear them without trampling the moss.',
    offer: 'Five Thornmites choke the game trails. Feather them cleanly — a hunter’s shaft never tramples the moss it walks on.',
    remind: 'Defeat five Thornmites in Mosswood.',
    done: 'Clean kills, clean trails. Now for fur and fang.',
    obj: [{ t: 'kill', id: 'thornmite', n: 5 }],
    reward: { xp: 320, gold: 130, mats: { greater_potion: 1 } } }),
  J({ id: 'jh_cap', chain: 'job_hunter', name: 'Capling Cull', giver: 'Forager Sable', zone: 'woods', pre: ['jh_thorn'],
    story: 'Caplings overrun the spore beds. Four precise kills prove the longbow’s worth.',
    offer: 'Caplings overrun my spore beds. Four of them, and I want every shaft through the cap — precision, not butchery.',
    remind: 'Defeat four Caplings in Mosswood.',
    done: 'Through the cap, every one. Hunter, the longbow is yours.',
    obj: [{ t: 'kill', id: 'capling', n: 4 }],
    reward: { xp: 420, gold: 170, mats: { moonmoss: 3 } } }),

  // ═══ Wildwarden (base: ranger) — giver: Granny Elda ═══
  J({ id: 'jw_root', chain: 'job_wildwarden', name: 'Root Knowledge', giver: 'Granny Elda', zone: 'meadow', pre: [],
    story: 'Elda knows greenhands by their baskets. Fill one with dewberries and she will judge.',
    offer: 'You want to ward the wild, dear? Then know it first. Five dewberries from the meadow bushes — taste one yourself, so you know what you guard.',
    remind: 'Gather five Dewberries in the meadow for Granny Elda.',
    done: 'Plump and sweet. You know what the wild is for, at least.',
    obj: [{ t: 'collect', id: 'dewberry', n: 5 }],
    reward: { xp: 160, gold: 65 } }),
  J({ id: 'jw_glade', chain: 'job_wildwarden', name: 'Walk the Moonlit Glade', giver: 'Granny Elda', zone: 'woods', pre: ['jw_root'],
    story: 'Moonmoss only glows for those who walk softly. Gather it in the Moonlit Glade.',
    offer: 'Moonmoss glows in Mosswood for soft feet only. Four sprigs, and walk the Moonlit Glade while you are there — let it look you over.',
    remind: 'Gather four Moonmoss and visit the Moonlit Glade.',
    done: 'The glade looked you over and did not frown. One trial left.',
    obj: [{ t: 'collect', id: 'moonmoss', n: 4 }, { t: 'explore', poi: 'woods_glade' }],
    reward: { xp: 320, gold: 130, mats: { empty_vial: 2 } } }),
  J({ id: 'jw_blight', chain: 'job_wildwarden', name: 'Cut the Blight', giver: 'Granny Elda', zone: 'woods', pre: ['jw_glade'],
    story: 'Blighted Caplings spread rot through the spore beds. Cull them — mercy, swiftly given.',
    offer: 'Blight in the spore beds, dear, and Caplings spreading it. Four of them, swiftly and kindly. Sometimes warding means cutting.',
    remind: 'Defeat four Caplings in Mosswood.',
    done: 'Swift and kind. The wild has a new warden.',
    obj: [{ t: 'kill', id: 'capling', n: 4 }],
    reward: { xp: 420, gold: 170, mats: { dewberry: 4 } } }),

  // ═══ Elementalist (base: arcanist) — giver: Maren ═══
  J({ id: 'je_surge', chain: 'job_elementalist', name: 'Hold the Surge', giver: 'Maren', zone: 'town', pre: [],
    story: 'Maren tests casters the same way: spend your art twice and stay standing.',
    offer: 'Raw power first, control second. Cast your mobility art twice before me — spend the current, stay standing, and we will talk.',
    remind: 'Cast your mobility art (press 3) twice, then return to Maren.',
    done: 'Spent and standing. Power you have. Control is the question.',
    obj: [{ t: 'skill', id: ['dash', 'blink'], n: 2 }],
    reward: { xp: 160, gold: 65 } }),
  J({ id: 'je_bog', chain: 'job_elementalist', name: 'Burn Out the Bog', giver: 'Maren', zone: 'ruins', pre: ['je_surge'],
    story: 'Bog Spirits in Tidehollow drink stray magic. Burn four out and waste nothing.',
    offer: 'Four Bog Spirits in Tidehollow, fat on stray magic. Burn them out — and waste nothing. An elementalist who spills power spills lives.',
    remind: 'Defeat four Bog Spirits in Tidehollow.',
    done: 'Nothing spilled, nothing wasted. Now face what watches.',
    obj: [{ t: 'kill', id: 'bogspirit', n: 4 }],
    reward: { xp: 340, gold: 140, mats: { greater_potion: 1 } } }),
  J({ id: 'je_eye', chain: 'job_elementalist', name: 'Unmake the Watcher', giver: 'Maren', zone: 'ruins', pre: ['je_bog'],
    story: 'A Tide Eye anchors the stray current. Unmake it and the trial is done.',
    offer: 'One Tide Eye anchors the whole stray current. Unmake it — all of it, at once — and call yourself elementalist.',
    remind: 'Defeat one Tide Eye in Tidehollow.',
    done: 'Unmade, utterly. The current answers to you now.',
    obj: [{ t: 'kill', id: 'tideeye', n: 1 }],
    reward: { xp: 430, gold: 175, mats: { moonmoss: 3 } } }),

  // ═══ Tidecaller (base: arcanist) — giver: Dockmaster Orla ═══
  J({ id: 'jt_ebb', chain: 'job_tidecaller', name: 'Read the Ebb', giver: 'Dockmaster Orla', zone: 'dock', pre: [],
    story: 'Orla reads tides the way scholars read books. Learn the letters first.',
    offer: 'You want to call the tide? Then read it first. Walk Harbour Square, watch the water, and tell me which way it leans today.',
    remind: 'Visit Harbour Square and report to Dockmaster Orla.',
    done: 'You read it true. The water noticed you noticing.',
    obj: [{ t: 'explore', poi: 'dock_square' }, { t: 'talk', npc: 'Dockmaster Orla' }],
    reward: { xp: 150, gold: 60 } }),
  J({ id: 'jt_cull', chain: 'job_tidecaller', name: 'Clear the Shallows', giver: 'Dockmaster Orla', zone: 'dock', pre: ['jt_ebb'],
    story: 'Shore Crabs overrun Driftwood Cove and muddy the tide-pools. Thin them out.',
    offer: 'Six Shore Crabs muddy the tide-pools at Driftwood Cove. Clear them so the water runs honest again.',
    remind: 'Defeat six Shore Crabs at Driftwood Cove.',
    done: 'The pools run clear. Now follow the strangeness to its source.',
    obj: [{ t: 'kill', id: 'shorecrab', n: 6 }],
    reward: { xp: 320, gold: 130, mats: { greater_potion: 1 } } }),
  J({ id: 'jt_source', chain: 'job_tidecaller', name: 'Face the Source', giver: 'Dockmaster Orla', zone: 'ruins', pre: ['jt_cull'],
    story: 'The strange tides rise from Tidehollow. Three Bog Spirits guard the source — settle them.',
    offer: 'The strange tides rise from Tidehollow, not the sea. Three Bog Spirits coil at the source. Settle them, and the tide is yours to call.',
    remind: 'Defeat three Bog Spirits in Tidehollow.',
    done: 'Settled. Listen — the tide says your name now. Tidecaller.',
    obj: [{ t: 'kill', id: 'bogspirit', n: 3 }],
    reward: { xp: 420, gold: 170, mats: { guard_elixir: 1 } } }),

  // ═══ Shadowblade (base: bandit) — giver: Warden Tamsin ═══
  J({ id: 'js_whisper', chain: 'job_shadowblade', name: 'Walk Unheard', giver: 'Warden Tamsin', zone: 'ruins', pre: [],
    story: 'Tamsin speaks softly in the ruins and expects answers softer still.',
    offer: 'Loud feet die loud deaths down here. Find me at the Sunken Altar without stirring the stones — then we will see if shadow wants you.',
    remind: 'Visit the Sunken Altar and report to Warden Tamsin.',
    done: 'Unheard. The dark kept you. Interesting.',
    obj: [{ t: 'explore', poi: 'ruins_altar' }, { t: 'talk', npc: 'Warden Tamsin' }],
    reward: { xp: 150, gold: 60 } }),
  J({ id: 'js_bats', chain: 'job_shadowblade', name: 'Night Hunt', giver: 'Warden Tamsin', zone: 'meadow', pre: ['js_whisper'],
    story: 'Moss Bats hear everything. Take six without ever being heard yourself.',
    offer: 'Six Moss Bats in the meadow. They hear everything — so be nothing. No warnings, no chases, just shadows.',
    remind: 'Defeat six Moss Bats in the meadow.',
    done: 'Nothing but shadows. Now for prey with teeth.',
    obj: [{ t: 'kill', id: 'mossbat', n: 6 }],
    reward: { xp: 320, gold: 130, mats: { greater_potion: 1 } } }),
  J({ id: 'js_skulls', chain: 'job_shadowblade', name: 'Skulls in the Dark', giver: 'Warden Tamsin', zone: 'ruins', pre: ['js_bats'],
    story: 'Rust Skulls guard the old gate and never sleep. Neither must a shadowblade.',
    offer: 'Three Rust Skulls at the old gate. They never sleep, never blink. Be quieter than their vigil.',
    remind: 'Defeat three Rust Skulls at the old Tidehollow gate.',
    done: 'Quieter than vigil. Rise, shadowblade — the dark is yours.',
    obj: [{ t: 'kill', id: 'rustskull', n: 3 }],
    reward: { xp: 420, gold: 170, mats: { empty_vial: 2 } } }),

  // ═══ Trickster (base: bandit) — giver: Old Tob ═══
  J({ id: 'jo_ear', chain: 'job_trickster', name: 'A Crooked Ear', giver: 'Old Tob', zone: 'town', pre: [],
    story: 'Old Tob trusts town gossip over road signs. Prove you can work a crowd.',
    offer: 'Straight roads are for straight folk, ha! Work the town for me: hear what Tilly and Old Wick are saying, then bring the best bits back to Tob.',
    remind: 'Talk to Tilly and Old Wick, then return to Old Tob.',
    done: 'Ha! You work a crowd like a market cutpurse. But can you walk one?',
    obj: [{ t: 'talk', npc: 'Tilly' }, { t: 'talk', npc: 'Old Wick' }],
    reward: { xp: 150, gold: 60 } }),
  J({ id: 'jo_berry', chain: 'job_trickster', name: 'Sweet Fingers', giver: 'Old Tob', zone: 'meadow', pre: ['jo_ear'],
    story: 'Dewberries stain honest fingers. Gather five without the bushes noticing.',
    offer: 'Five dewberries, meadow bushes. Quick fingers, no scratches — a trickster leaves the bush thinking it still has them.',
    remind: 'Gather five Dewberries in the meadow.',
    done: 'Not a scratch on you. Now the punchline needs teeth.',
    obj: [{ t: 'collect', id: 'dewberry', n: 5 }],
    reward: { xp: 300, gold: 120, mats: { dewberry: 2 } } }),
  J({ id: 'jo_slime', chain: 'job_trickster', name: 'Slip the Slimes', giver: 'Old Tob', zone: 'meadow', pre: ['jo_berry'],
    story: 'Five Dew Slimes, one laughing rogue. Slip among them and leave none standing.',
    offer: 'Five Dew Slimes, and only your wits between you and a gumming. Slip among them, trip them over each other, and come back laughing.',
    remind: 'Defeat five Dew Slimes in the meadow.',
    done: 'Back and laughing! Crookedest smile I ever saw. Trickster, and no mistake.',
    obj: [{ t: 'kill', id: 'dewslime', n: 5 }],
    reward: { xp: 420, gold: 170, mats: { slime_gel: 3 } } }),
];
