import Phaser from 'phaser';

// Runtime-authored gear art (CC0, ours): 16×16 worn head overlays registered
// to the Ninja Adventure body frames + 12×12 inventory/shop icons, all in the
// same chunky-pixel style. Generated once in BootScene.create().
function px(g, x, y, w, h, color) { g.fillStyle(color, 1).fillRect(x, y, w, h); }

const OUTLINE = 0x1c1c22;

function headBase(g) {
  // transparent 16×16; head occupies roughly x4..11, y1..7 (sprite space)
}

const HEADS = {
  straw_hat(g) {
    headBase(g);
    px(g, 2, 6, 12, 2, 0xd9b64a); px(g, 2, 6, 12, 1, 0xf2dd9a); // brim
    px(g, 5, 2, 6, 4, 0xd9b64a); px(g, 5, 2, 2, 4, 0xf2dd9a);   // dome
    px(g, 5, 5, 6, 1, 0xb03a2e);                                // band
    px(g, 2, 6, 12, 1, OUTLINE); px(g, 2, 7, 12, 1, OUTLINE);
  },
  leather_cap(g) {
    headBase(g);
    px(g, 4, 2, 8, 5, 0x8d5524); px(g, 4, 2, 2, 5, 0xb9772f);  // dome
    px(g, 3, 6, 10, 1, 0x5a3a1e);                               // brim
    px(g, 4, 2, 8, 1, OUTLINE); px(g, 4, 6, 8, 1, OUTLINE);
    px(g, 7, 3, 2, 2, 0x5a3a1e);                                // stitch
  },
  iron_helm(g) {
    headBase(g);
    px(g, 3, 1, 10, 7, 0x95a5a6); px(g, 3, 1, 2, 7, 0xd5dbdb); // dome + shine
    px(g, 3, 1, 10, 1, OUTLINE); px(g, 3, 7, 10, 1, OUTLINE);
    px(g, 3, 1, 1, 7, OUTLINE); px(g, 12, 1, 1, 7, OUTLINE);
    px(g, 4, 4, 4, 1, OUTLINE); px(g, 9, 4, 3, 1, OUTLINE);    // eye slit
    px(g, 7, 4, 2, 4, 0x5d6d7e);                                 // nose guard
  },
  mage_hat(g) {
    headBase(g);
    px(g, 2, 7, 12, 1, 0x1e2a5a); px(g, 2, 7, 12, 1, OUTLINE); // brim
    px(g, 5, 4, 6, 3, 0x2e4a8d); px(g, 6, 1, 4, 3, 0x2e4a8d);
    px(g, 7, 0, 2, 1, 0x2e4a8d); px(g, 5, 4, 1, 3, 0x5a7bd5);  // shade
    px(g, 9, 5, 1, 1, 0xf4c542);                                // star dot
  },
  tide_crown(g) {
    headBase(g);
    px(g, 4, 5, 8, 2, 0xf4c542); px(g, 4, 5, 8, 1, 0xfff1a8);  // band
    px(g, 4, 2, 2, 3, 0xf4c542); px(g, 7, 1, 2, 4, 0xf4c542); px(g, 10, 2, 2, 3, 0xf4c542); // spikes
    px(g, 7, 5, 2, 2, 0x76d7c4);                                // gem
  },
};

function drawIcon(g, item) {
  const c = item.tint ?? 0xcccccc;
  const light = Phaser.Display.Color.IntegerToColor(c).brighten(30).color;
  if (item.slot === 'head') {
    px(g, 2, 7, 8, 2, c); px(g, 3, 4, 6, 3, c); px(g, 3, 4, 2, 3, light);
    px(g, 2, 7, 8, 1, OUTLINE); px(g, 3, 4, 6, 1, OUTLINE);
  } else if (item.slot === 'chest') {
    px(g, 3, 2, 6, 8, c); px(g, 1, 3, 2, 4, c); px(g, 9, 3, 2, 4, c);
    px(g, 3, 2, 2, 8, light); px(g, 5, 2, 2, 1, OUTLINE);
    px(g, 3, 9, 6, 1, OUTLINE);
  } else if (item.slot === 'weapon') {
    if (item.kind === 'bow') {
      px(g, 2, 1, 2, 10, c); px(g, 4, 2, 1, 2, light); px(g, 8, 3, 2, 1, 0x8d5524);
      px(g, 4, 5, 5, 1, 0xd5dbdb);
    } else if (item.kind === 'wand') {
      px(g, 2, 6, 7, 2, 0x8d5524); px(g, 8, 4, 4, 4, c); px(g, 9, 5, 2, 2, light);
    } else {
      px(g, 7, 1, 3, 7, c); px(g, 7, 1, 1, 7, light); // blade
      px(g, 5, 8, 7, 1, 0x8d5524); px(g, 7, 9, 3, 2, 0x5a3a1e); // guard+grip
      px(g, 7, 1, 3, 1, OUTLINE);
    }
  } else {
    // trinket gem
    px(g, 4, 2, 4, 2, c); px(g, 3, 4, 6, 4, c); px(g, 5, 8, 2, 2, c);
    px(g, 4, 4, 2, 2, light); px(g, 3, 4, 6, 1, OUTLINE);
  }
}

export function makeGearTextures(scene, gearMap) {
  for (const [id, draw] of Object.entries(HEADS)) {
    const key = `gear.head.${id}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, 16, 16);
    g.destroy();
  }
  for (const item of Object.values(gearMap)) {
    const key = `gear.icon.${item.id}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    drawIcon(g, item);
    g.generateTexture(key, 12, 12);
    g.destroy();
  }
}
