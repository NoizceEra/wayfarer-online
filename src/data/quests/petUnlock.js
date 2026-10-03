// "The Wandering Hatchery" — pet unlock quest data
// Purely additive; imported by data/quests.js.

export const PET_UNLOCK_QUEST = {
  id: 'q_pet_unlock',
  name: 'The Wandering Hatchery',
  giver: 'Pet Master Li',
  turnIn: 'Pet Master Li',
  lv: 5,
  zone: 'town',
  pre: [],
  story: 'Pet Master Li has wandered into Thistle Town with three dormant eggs. He needs a sunpetal and a moonmoss to wake one.',
  offer: 'Wayfarer! I carry eggs from the Wandering Hatchery, but they sleep until touched by sunpetal and moonmoss. Bring me one of each, choose the egg that calls to you, and I will teach you to raise it.',
  remind: 'One Sunpetal from the meadow, one Moonmoss from Mosswood. Then we wake the egg.',
  done: 'The egg stirs! Hold it close, and speak its name.',
  obj: [
    { t: 'collect', id: 'sunpetal', n: 1 },
    { t: 'collect', id: 'moonmoss', n: 1 },
  ],
  reward: { xp: 120, gold: 25 },
};
