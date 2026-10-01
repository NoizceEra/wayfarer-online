// server/rewards.js - the authoritative server-side reward table. Mirrors the CLIENT's
// merged ENEMY_TABLE (src/data/jobs.js + enemiesExtra.js + worldEnemies.js = 84 types;
// importing jobs.js alone shows only 8, and every boss lives in the merged part).
// server/rewards.test.mjs fails if the two ever drift.
//
// Owner's rule (verbatim): "Remove idle gold accumulation, it should only be per-kill.
// The same goes for the cryptocurrency rewards distribution, it's only a certain type of
// enemy that receives a certain amount."
//
//   gold   [min, max] awarded on kill. Nothing in this file accrues with time.
//   crypto units awarded on kill, and ONLY for boss types, tiered by hp. Ordinary enemies
//          pay none. Bosses are timer-gated (BOSS_SLOT_MS = 10 min in
//          src/data/worldEvents.js), which is what keeps crypto emissions bounded.
//   cap    plausibility bound on how many of THIS type a client may claim between two
//          saves: perSec of wall time plus a burst floor. The relay cannot tell which
//          enemy actually died, so it credits each type at that type's own value and
//          refuses claims above what a real player could have killed.
//
// Crypto is DATA AND ACCOUNTING ONLY. Minting, wallets, staking and on-chain distribution
// are parked by the owner's decision; no chain access belongs in the relay.

export const ENEMY_REWARDS = {
  ashghost: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  bamboolet: { gold: [4, 9], crypto: 0, cap: { perSec: 1, burst: 8 } },
  bandit_racoon: { gold: [6, 14], crypto: 0, cap: { perSec: 1, burst: 8 } },
  beachsnail: { gold: [3, 8], crypto: 0, cap: { perSec: 1, burst: 8 } },
  bloodeye: { gold: [6, 14], crypto: 0, cap: { perSec: 1, burst: 8 } },
  bloodheart: { gold: [6, 13], crypto: 0, cap: { perSec: 1, burst: 8 } },
  bogspirit: { gold: [4, 10], crypto: 0, cap: { perSec: 1, burst: 8 } },
  bonesentinel: { gold: [6, 14], crypto: 0, cap: { perSec: 1, burst: 8 } },
  bramblesnake: { gold: [3, 8], crypto: 0, cap: { perSec: 1, burst: 8 } },
  burrower: { gold: [2, 6], crypto: 0, cap: { perSec: 1, burst: 8 } },
  capling: { gold: [2, 7], crypto: 0, cap: { perSec: 1, burst: 8 } },
  cbat: { gold: [9, 20], crypto: 0, cap: { perSec: 1, burst: 8 } },
  ccyclops: { gold: [16, 32], crypto: 0, cap: { perSec: 0.2, burst: 2 } },  // Coal Cyclops (elite, hp 240)
  cgolem: { gold: [15, 30], crypto: 0, cap: { perSec: 0.2, burst: 2 } },  // Obsidian Golem (elite, hp 290)
  cimp: { gold: [11, 24], crypto: 0, cap: { perSec: 1, burst: 8 } },
  cryptadder: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  csalamander: { gold: [13, 26], crypto: 0, cap: { perSec: 0.2, burst: 2 } },  // Lava Salamander (elite, hp 200)
  cslime: { gold: [10, 22], crypto: 0, cap: { perSec: 1, burst: 8 } },
  dcactus: { gold: [8, 16], crypto: 0, cap: { perSec: 1, burst: 8 } },
  dcobra: { gold: [9, 19], crypto: 0, cap: { perSec: 1, burst: 8 } },
  dewslime: { gold: [1, 4], crypto: 0, cap: { perSec: 1, burst: 8 } },
  dguardian: { gold: [14, 28], crypto: 0, cap: { perSec: 0.2, burst: 2 } },  // Tomb Guardian (elite, hp 240)
  djackal: { gold: [10, 22], crypto: 0, cap: { perSec: 1, burst: 8 } },
  dscarab: { gold: [8, 17], crypto: 0, cap: { perSec: 1, burst: 8 } },
  dscorpion: { gold: [9, 18], crypto: 0, cap: { perSec: 1, burst: 8 } },
  dwraith: { gold: [10, 20], crypto: 0, cap: { perSec: 1, burst: 8 } },
  embercyclops: { gold: [6, 14], crypto: 0, cap: { perSec: 1, burst: 8 } },
  fernlizard: { gold: [3, 9], crypto: 0, cap: { perSec: 1, burst: 8 } },
  fieldmouse: { gold: [1, 3], crypto: 0, cap: { perSec: 1, burst: 8 } },
  forgelord: { gold: [320, 520], crypto: 20, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Forgelord Ignar (boss, hp 1450)
  frostgel: { gold: [7, 16], crypto: 0, cap: { perSec: 1, burst: 8 } },
  frostwisp: { gold: [7, 15], crypto: 0, cap: { perSec: 1, burst: 8 } },
  gelblue: { gold: [2, 5], crypto: 0, cap: { perSec: 1, burst: 8 } },
  gelgreen: { gold: [1, 4], crypto: 0, cap: { perSec: 1, burst: 8 } },
  glaciersnail: { gold: [8, 18], crypto: 0, cap: { perSec: 1, burst: 8 } },
  glacierwyrm: { gold: [220, 360], crypto: 10, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Glacier Wyrm (boss, hp 980)
  gloomtoad: { gold: [130, 210], crypto: 10, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Old Gloomtoad (boss, hp 720)
  gorselizard: { gold: [1, 5], crypto: 0, cap: { perSec: 1, burst: 8 } },
  gravebat: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  gravedigger: { gold: [6, 14], crypto: 0, cap: { perSec: 1, burst: 8 } },
  gravemaw: { gold: [140, 220], crypto: 10, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Warden Gravemaw (boss, hp 640)
  hcrawler: { gold: [8, 17], crypto: 0, cap: { perSec: 1, burst: 8 } },
  hhound: { gold: [10, 20], crypto: 0, cap: { perSec: 1, burst: 8 } },
  hking: { gold: [300, 480], crypto: 20, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // The Hollow King (boss, hp 1750)
  hknight: { gold: [9, 18], crypto: 0, cap: { perSec: 1, burst: 8 } },
  hlantern: { gold: [0, 0], crypto: 0, cap: { perSec: 1, burst: 8 } },
  hootling: { gold: [3, 8], crypto: 0, cap: { perSec: 1, burst: 8 } },
  hwarden: { gold: [120, 200], crypto: 10, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Hollow Warden (boss, hp 820)
  hwraith: { gold: [8, 16], crypto: 0, cap: { perSec: 1, burst: 8 } },
  icejelly: { gold: [7, 16], crypto: 0, cap: { perSec: 1, burst: 8 } },
  khet: { gold: [260, 420], crypto: 20, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Khet, the Sun Colossus (boss, hp 1150)
  lilykappa: { gold: [4, 9], crypto: 0, cap: { perSec: 1, burst: 8 } },
  meadowcap: { gold: [2, 6], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mirefiend: { gold: [6, 13], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mkappa: { gold: [8, 18], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mleech: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mossbat: { gold: [1, 5], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mossbear: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mserpent: { gold: [7, 15], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mspore: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mstalker: { gold: [7, 16], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mtoad: { gold: [6, 14], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mudmollusc: { gold: [4, 11], crypto: 0, cap: { perSec: 1, burst: 8 } },
  mwisp: { gold: [6, 14], crypto: 0, cap: { perSec: 1, burst: 8 } },
  pondaxolot: { gold: [3, 8], crypto: 0, cap: { perSec: 1, burst: 8 } },
  redclaw: { gold: [70, 120], crypto: 5, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Old Redclaw (boss, hp 330)
  reedoctopus: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  rexling: { gold: [7, 15], crypto: 0, cap: { perSec: 1, burst: 8 } },
  rimecrawler: { gold: [8, 18], crypto: 0, cap: { perSec: 1, burst: 8 } },
  rimelizard: { gold: [8, 18], crypto: 0, cap: { perSec: 1, burst: 8 } },
  ruinlantern: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  rustskull: { gold: [3, 9], crypto: 0, cap: { perSec: 1, burst: 8 } },
  sandadder: { gold: [3, 8], crypto: 0, cap: { perSec: 1, burst: 8 } },
  shadehound: { gold: [7, 15], crypto: 0, cap: { perSec: 1, burst: 8 } },
  shorecrab: { gold: [3, 8], crypto: 0, cap: { perSec: 1, burst: 8 } },
  slimeking: { gold: [90, 160], crypto: 10, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Slime King Gloop (boss, hp 620)
  snowspecter: { gold: [8, 18], crypto: 0, cap: { perSec: 1, burst: 8 } },
  stinger: { gold: [2, 7], crypto: 0, cap: { perSec: 1, burst: 8 } },
  thornmite: { gold: [2, 6], crypto: 0, cap: { perSec: 1, burst: 8 } },
  tideeye: { gold: [5, 12], crypto: 0, cap: { perSec: 1, burst: 8 } },
  tideoctopus: { gold: [3, 9], crypto: 0, cap: { perSec: 1, burst: 8 } },
  willowisp: { gold: [3, 8], crypto: 0, cap: { perSec: 1, burst: 8 } },
  worldtitan: { gold: [400, 650], crypto: 20, cap: { perSec: 0.0016666666666666668, burst: 1 } },  // Ancient Thornback (boss, hp 3600)
  yeti: { gold: [10, 22], crypto: 0, cap: { perSec: 1, burst: 8 } },
};

// Highest single-kill gold in the roster (a world boss). Derived, never hand-written.
export const MAX_GOLD_PER_KILL = 650;

export function rewardFor(id) { return ENEMY_REWARDS[id] || { gold: [0, 0], crypto: 0, cap: { perSec: 0, burst: 0 } }; }
export function paysCrypto(id) { return (ENEMY_REWARDS[id]?.crypto || 0) > 0; }
export const ROSTER_SIZE = 84;
