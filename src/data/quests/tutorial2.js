// Tutorial / onboarding quest chain — DATA ONLY, purely additive.
// Engine contract (src/systems/questSystem.js + src/data/quests.js header):
//   Objective types: kill{id,n} collect{id,n} deliver{id,npc} talk{npc}
//                    explore{zone|area|poi} escort{npc,tex,from,to}
//                    use{id,n} interact{id} craft{id,n}
//                    skill{id,n} daily{n?} pethatch{id?,n?}
//   Reward: { xp, gold, gear, mats:{id:n}, recipes[], statPoints, lore }
// Every objective below uses a type the engine's _bump/_bumpType + grant()/
// rewardLines() already handles. No engine changes needed.
//
// Coverage mapping (requested onboarding beats -> engine-supported step):
//   movement          -> explore POI (town_plaza; checkLoreAndExplore proximity credit)
//   first combat hit  -> kill dewslime x1 (kill credit fires only on a kill, so the
//                        "first hit" beat is approximated by a first-kill step)
//   gathering         -> collect sunpetal (live pack-count progress via onPack)
//   crafting          -> craft herbal_tonic (crafting.js calls quests.onCraft)
//   first skill cast  -> { t:'skill', id:'dash', n:1 } via onSkill <- SKILL_CAST
//                        (WorldScene.cast emits AFTER the learn/cooldown guards,
//                        so credit = a genuine cast. CLASS CAVEAT, verified in
//                        jobs.js: 'dash' exists in wayfarer/ranger/bandit
//                        abilities; arcanist has 'blink' instead (keys 3).
//                        _bump requires exact o.id===id and obj is AND-only, so
//                        data-only cannot express cross-class OR. Arcanist
//                        starters cannot complete tut_skills until the engine
//                        accepts an id list — see docs/TUTORIAL_QUEST_CHAIN.md.)
//   pet/master intro  -> talk to Pet Master Li, then a genuine generic
//                        { t:'pethatch' } capture step (PET_HATCH from
//                        petEncounter._attemptCapture; wisps spawn from kills,
//                        capture needs a Wayfarer Orb ~25g — chain pays 60g+)
//   daily reward      -> { t:'daily' } side quest (onDaily <- DAILY_REWARD
//                        claimed-only). OPTIONAL side quest, pre:[] and NOT in
//                        the chain: daily claim is once-per-day, so chain-gating
//                        on it could stall a new player for 24h.
//
// Chain: linear `pre` prerequisites (tut_steps..tut_hatch), lv 1 throughout,
// non-repeat (no `repeat` flag), one-time rewards. tut_daily is a standalone
// side quest (no chain, no pre). Registration is the parent's job — see
// docs/TUTORIAL_QUEST_CHAIN.md for the exact snippet (must run BEFORE the
// QUESTS_BY_ID map is built in quests.js).

export const TUTORIAL_CHAIN = {
  id: 'tutorial',
  name: 'Wayfarer Basics',
  zones: 'Town, Meadow',
  blurb: 'Pip, Granny Elda and Maren teach a new arrival to walk, fight, gather, brew, and meet Pet Master Li.',
};

const T = (o) => ({ lv: 1, pre: [], obj: [], reward: {}, zone: 'town', ...o });

export const TUTORIAL_QUESTS = [
  T({ id: 'tut_steps', chain: 'tutorial', name: 'First Steps', giver: 'Pip', zone: 'town',
    story: 'Pip shows every newcomer around Thistle Plaza before letting them past the gate.',
    offer: 'New boots, eh? Walk with me a moment — meet me at Thistle Plaza in the middle of town and we will get you started.',
    remind: 'Take a walk to Thistle Plaza, in the middle of town. Follow the tracker.',
    done: 'There you are! Legs work fine. Thistle Town is yours to wander now.',
    obj: [{ t: 'explore', poi: 'town_plaza' }],
    reward: { xp: 10, gold: 5 } }),
  T({ id: 'tut_blade', chain: 'tutorial', name: 'First Blood', giver: 'Pip', zone: 'meadow', pre: ['tut_steps'],
    story: 'Dew Slimes clog the meadow paths west of town. Pip wants one cleared to prove the newcomer can fight.',
    offer: 'Slimes on the meadow path, friend. Drive off just one Dew Slime and come back — swing with click, keep moving.',
    remind: 'Defeat one Dew Slime out in the meadow, west of town.',
    done: 'One slime fewer! You hold a blade like you mean it. The meadow is that way whenever you want more.',
    obj: [{ t: 'kill', id: 'dewslime', n: 1 }],
    reward: { xp: 20, gold: 10 } }),
  T({ id: 'tut_gather', chain: 'tutorial', name: 'Golden Petals', giver: 'Granny Elda', zone: 'meadow', pre: ['tut_blade'],
    story: 'Granny Elda brews tonics for every bruised newcomer, but her basket is empty.',
    offer: 'Sunpetals, dear — golden flowers in the meadow grass. Press E beside them to pick. Two will fill my basket.',
    remind: 'Pick two Sunpetals in the meadow (E beside the golden flowers).',
    done: 'Lovely, golden ones! Your hands have a green touch. Now let us brew them.',
    obj: [{ t: 'collect', id: 'sunpetal', n: 2 }],
    reward: { xp: 20, gold: 10, mats: { empty_vial: 1 } } }),
  T({ id: 'tut_brew', chain: 'tutorial', name: 'Brew and Sip', giver: 'Granny Elda', zone: 'town', pre: ['tut_gather'],
    story: 'Elda teaches the newcomer to brew a Herbal Tonic and taste their own work.',
    offer: 'At the alchemy table by Maren’s stall, brew one Herbal Tonic — press E at the table, or U for the craft panel. Then drink it yourself, dear. A brewer who will not taste is no brewer.',
    remind: 'Craft one Herbal Tonic at the alchemy table, then drink it from your pack.',
    done: 'Clear as spring water, and you tasted your own work. A real brewer already.',
    obj: [{ t: 'craft', id: 'herbal_tonic', n: 1 }, { t: 'use', id: 'herbal_tonic', n: 1 }],
    reward: { xp: 30, gold: 15 } }),
  T({ id: 'tut_skills', chain: 'tutorial', name: 'Words of Power', giver: 'Maren', zone: 'town', pre: ['tut_brew'],
    story: 'Maren teaches newcomers to spend their momentum: cast the sprint-art, then report back.',
    offer: 'Steel is only half of it, friend. Cast Dust Dash — press 3, feel the wind take you — then come tell me how it felt.',
    remind: 'Cast your mobility art (press 3 — Dust Dash or Wisp Blink), then talk to Maren by her stall.',
    done: 'Good. Arts win the fights that blades cannot. Spend your skill points wisely as you level.',
    obj: [{ t: 'skill', id: ['dash', 'blink'], n: 1 }, { t: 'talk', npc: 'Maren' }],
    reward: { xp: 20, gold: 10 } }),
  T({ id: 'tut_pet', chain: 'tutorial', name: 'Egg Tales', giver: 'Pet Master Li', turnIn: 'Pet Master Li', zone: 'town', pre: ['tut_skills'],
    story: 'Pet Master Li has wandered into Thistle Town with dormant eggs. He tells the newcomer how companions work.',
    offer: 'Wayfarer! I carry eggs from the Wandering Hatchery, but that tale starts with a deed: hear me out, and if you want an egg of your own, bring me a sunpetal and a moonmoss after. (Ask me about “The Wandering Hatchery” next.)',
    remind: 'Talk to Pet Master Li in town about his hatchery eggs.',
    done: 'The eggs sleep until touched by sunpetal and moonmoss. Come back with one of each and an egg will wake for you.',
    obj: [{ t: 'talk', npc: 'Pet Master Li' }],
    reward: { xp: 20, gold: 10 } }),
  T({ id: 'tut_hatch', chain: 'tutorial', name: 'First Friend', giver: 'Pet Master Li', turnIn: 'Pet Master Li', zone: 'meadow', pre: ['tut_pet'],
    story: 'Li lends the newcomer a first orb on credit of courage: catch the wisp that follows battle, and a companion wakes.',
    offer: 'Words are wind — try it! Buy a Wayfarer Orb (25g), fell a beast until a wisp shimmers free, then capture it. Any wisp will do for your first friend.',
    remind: 'Capture any wild wisp (kill meadow beasts until one shimmers, then use a Wayfarer Orb).',
    done: 'It chose you, you know. Feed it, name it, and it will never leave your side.',
    obj: [{ t: 'pethatch', n: 1 }],
    reward: { xp: 30, gold: 15 } }),
  // OPTIONAL side quest — deliberately NOT in the chain (no `chain`, no `pre`):
  // daily claim is once-per-day, so chain-gating on it could stall a new
  // player for 24h. Available from level 1 alongside the chain.
  T({ id: 'tut_daily', name: 'A Habit of Returns', giver: 'Maren', zone: 'town',
    story: 'Maren rewards wayfarers who check back every day: claim the daily reward from the notice board.',
    offer: 'Come back every day, friend, and the town provides. Claim today’s daily reward and I will have a little extra for you.',
    remind: 'Claim the daily reward (notice board / daily panel).',
    done: 'Every day you return, Thistle Town grows a little fonder of you.',
    obj: [{ t: 'daily', n: 1 }],
    reward: { xp: 15, gold: 10 } }),
];
