// Emote catalogue + pixel-art icons (12x12 glyph maps, drawn on demand onto a
// canvas 2D context so both the Phaser bubbles and the DOM emote wheel share
// the exact same art). Animations are tween recipes applied to a hero rig.
const PAL = {
  '.': null,
  'k': '#1a1024', // outline
  'w': '#fff6e0', // white
  'y': '#ffd84a', // yellow
  'o': '#f4a742', // orange
  'r': '#e8564a', // red
  'b': '#5ad0ff', // blue
  'g': '#7dff9a', // green
  'p': '#ff9ad5', // pink
  's': '#f2c9a0', // skin
  'd': '#8a5a2b', // wood
};

const ART = {
  wave: [
    '....kkk.....',
    '...kssk.....',
    '..kssskkk...',
    '..ksssssk...',
    '.kkssssssk..',
    'kssssssssk..',
    'kssssssssk..',
    '.kssssssk...',
    '..kssssk....',
    '...kssk.....',
    '...kssk.....',
    '....kk......',
  ],
  cheer: [
    '.....k......',
    '....kyk.....',
    '....kyk.....',
    '.k..kyk..k..',
    'kyk.kyk.kyk.',
    '.k.kyyyk.k..',
    '..kyyyyyk...',
    '.kyyyyyyyk..',
    '..kyyyyyk...',
    '...kyyyk....',
    '..kyk.kyk...',
    '..k....k....',
  ],
  sit: [
    '............',
    '.kkkkkkkk...',
    '.kddddddk...',
    '.kddddddk...',
    '.kkkkkkkkkk.',
    '.kddddddddk.',
    '.kddddddddk.',
    '.kkkkkkkkkk.',
    '.kdk....kdk.',
    '.kdk....kdk.',
    '.kdk....kdk.',
    '.kk......kk.',
  ],
  dance: [
    '.......kkk..',
    '......kbbbk.',
    '......kbkkk.',
    '......kbk...',
    '......kbk...',
    '......kbk...',
    '......kbk...',
    '..kkk.kbk...',
    '.kbbbkkbk...',
    'kbbbbbbk....',
    'kbbbbbk.....',
    '.kkkkk......',
  ],
  laugh: [
    '...kkkkkk...',
    '..kyyyyyyk..',
    '.kyyyyyyyyk.',
    'kyykyyyykyyk',
    'kykyykyykyyk',
    'kyyyyyyyyyyk',
    'kykkkkkkkkyk',
    'kyykwwwwkyyk',
    '.kykrrrrky..',
    '.kyykkkkyyk.',
    '..kyyyyyyk..',
    '...kkkkkk...',
  ],
  cry: [
    '...kkkkkk...',
    '..kyyyyyyk..',
    '.kyyyyyyyyk.',
    'kykkyyyykkyk',
    'kyyyyyyyyyyk',
    'kybyyyyyybyk',
    'kbbyyyyyybbk',
    'kbbyykkyybbk',
    '.kykyyyykyk.',
    '.kyyyyyyyyk.',
    '..kyyyyyyk..',
    '...kkkkkk...',
  ],
  point: [
    '............',
    '.....kk.....',
    '....kssk....',
    '...kssssk...',
    '..kssssssk..',
    '.kssssssssk.',
    'kkkkssssskkk',
    '...kssssk...',
    '...kssssk...',
    '...kssssk...',
    '...kkkkkk...',
    '............',
  ],
};

export const EMOTES = [
  { id: 'wave',  label: 'Wave',  text: 'waves.',                 key: '1' },
  { id: 'cheer', label: 'Cheer', text: 'cheers!',                key: '2' },
  { id: 'dance', label: 'Dance', text: 'busts out a dance move.', key: '3' },
  { id: 'laugh', label: 'Laugh', text: 'laughs out loud.',       key: '4' },
  { id: 'cry',   label: 'Cry',   text: 'sobs quietly.',          key: '5' },
  { id: 'point', label: 'Point', text: 'points over there.',     key: '6' },
  { id: 'sit',   label: 'Sit',   text: 'sits down to rest.',     key: '7' },
];
export const EMOTE_IDS = EMOTES.map((e) => e.id);
export const emoteById = (id) => EMOTES.find((e) => e.id === id) || null;

// Draw one emote glyph at (ox, oy), `px` screen pixels per art pixel.
export function drawEmote(ctx, id, ox = 0, oy = 0, px = 1) {
  const rows = ART[id]; if (!rows) return false;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PAL[row[x]]; if (!c) continue;
      ctx.fillStyle = c; ctx.fillRect(ox + x * px, oy + y * px, px, px);
    }
  });
  return true;
}

// Standalone canvas element (DOM emote wheel).
export function emoteCanvas(id, px = 3) {
  const c = document.createElement('canvas');
  c.width = 12 * px; c.height = 12 * px;
  drawEmote(c.getContext('2d'), id, 0, 0, px);
  c.style.imageRendering = 'pixelated';
  return c;
}

// Phaser textures `emote.<id>` (12x12), created once per game.
export function ensureEmoteTextures(scene) {
  for (const id of EMOTE_IDS) {
    const key = `emote.${id}`;
    if (scene.textures.exists(key)) continue;
    const t = scene.textures.createCanvas(key, 12, 12);
    drawEmote(t.getContext(), id, 0, 0, 1);
    t.refresh();
  }
}

// Tween recipe for a hero rig (a Phaser Container). Only angle/scale/x are
// animated so the idle bob tween (which owns rig.y) keeps running untouched.
export function playEmoteAnim(scene, rig, id) {
  if (!rig || !scene?.tweens) return;
  scene.tweens.killTweensOf(rig);
  rig.setAngle(0).setScale(1); rig.x = 0;
  const done = () => { rig.setAngle(0).setScale(1); rig.x = 0; };
  const T = (cfg) => scene.tweens.add({ targets: rig, onComplete: done, ...cfg });
  switch (id) {
    case 'wave':  return T({ angle: { from: -10, to: 10 }, duration: 110, yoyo: true, repeat: 5, ease: 'sine.inout' });
    case 'cheer': return T({ scaleY: 1.18, scaleX: 0.9, duration: 140, yoyo: true, repeat: 3, ease: 'quad.out' });
    case 'dance': return T({ angle: { from: -14, to: 14 }, x: { from: -3, to: 3 }, duration: 160, yoyo: true, repeat: 7, ease: 'sine.inout' });
    case 'laugh': return T({ scaleY: 0.9, scaleX: 1.08, duration: 90, yoyo: true, repeat: 7 });
    case 'cry':   return T({ angle: 6, scaleY: 0.94, duration: 400, yoyo: true, repeat: 3, ease: 'sine.inout' });
    case 'point': return T({ angle: 18, duration: 160, hold: 900, yoyo: true });
    case 'sit':   return T({ scaleY: 0.78, scaleX: 1.1, duration: 200, hold: 3200, yoyo: true, ease: 'quad.out' });
    default: return null;
  }
}
