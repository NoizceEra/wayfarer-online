import Phaser from 'phaser';

// Runtime-authored gear art (CC0, ours): 16×16 worn head overlays registered
// to the Ninja Adventure body frames + 12×12 inventory/shop icons, all in the
// same chunky-pixel style as the Ninja Adventure pack: hard 1px dark outlines,
// 2-3 tone shading per surface, no anti-aliasing or gradients.
// Generated once in BootScene.create().

function px(g, x, y, w, h, color, a) {
  g.fillStyle(color, a ?? 1).fillRect(x, y, w, h);
}

const OUTLINE  = 0x1a1a22;
const SHADOW_A = 0.6; // shadow layer alpha for outlines drawn over color

// Shared 1px outline helper — draws a rectangular border in OUTLINE color
function outline(g, x, y, w, h) {
  g.fillStyle(OUTLINE, 1);
  g.fillRect(x, y, w, 1);         // top
  g.fillRect(x, y + h - 1, w, 1); // bottom
  g.fillRect(x, y, 1, h);         // left
  g.fillRect(x + w - 1, y, 1, h); // right
}

const HEADS = {
  straw_hat(g) {
    // Wide woven brim + rounded dome + contrasting band
    // Dome
    px(g, 4, 1, 8, 5, 0xc9a83c); // dome mid
    px(g, 4, 1, 2, 5, 0xf5e08a); // dome highlight (left face)
    px(g, 10, 2, 2, 4, 0x9e7e28); // dome shadow (right edge)
    // Brim
    px(g, 1, 6, 14, 2, 0xc9a83c);
    px(g, 1, 6, 14, 1, 0xf5e08a); // brim top highlight
    px(g, 2, 7, 12, 1, 0x9e7e28); // brim underside shadow
    // Band
    px(g, 4, 5, 8, 1, 0xb03a2e);
    // Outline
    outline(g, 4, 1, 8, 5); // dome
    g.fillStyle(OUTLINE, 1);
    g.fillRect(1, 6, 14, 1);  // brim top edge
    g.fillRect(1, 8, 14, 1);  // brim bottom edge
    g.fillRect(1, 6, 1, 3);   // brim left
    g.fillRect(14, 6, 1, 3);  // brim right
  },
  leather_cap(g) {
    // Rounded leather cap with stitched seam
    // Dome
    px(g, 3, 2, 10, 5, 0x7a4820); // base
    px(g, 3, 2, 2, 5, 0xa86030);  // highlight
    px(g, 11, 3, 2, 4, 0x4e2e10); // deep shadow
    // Brim strip
    px(g, 2, 7, 12, 1, 0x4e2e10);
    px(g, 3, 7, 10, 1, 0x7a4820); // brim face
    // Stitch
    for (let i = 0; i < 3; i++) {
      px(g, 6 + i * 2, 3, 1, 2, 0x2c1608);
    }
    // Outline
    g.fillStyle(OUTLINE, 1);
    g.fillRect(3, 2, 10, 1);   // top
    g.fillRect(3, 7, 10, 1);   // brim bottom
    g.fillRect(2, 7, 1, 1);    // brim left end
    g.fillRect(13, 7, 1, 1);
    g.fillRect(3, 2, 1, 5);    // left side
    g.fillRect(12, 2, 1, 5);   // right side
  },
  iron_helm(g) {
    // Full metal helmet: dome + cheek guards + eye slit + nose guard
    // Main dome
    px(g, 2, 1, 12, 7, 0x808e8e); // base metal
    px(g, 2, 1, 3, 7, 0xcad5d5);  // highlight band (left face)
    px(g, 12, 2, 2, 6, 0x505e5e); // deep shadow (right edge)
    // Cheek guards
    px(g, 2, 6, 3, 2, 0x6a7878);
    px(g, 11, 6, 3, 2, 0x6a7878);
    // Eye slit (dark cutout)
    px(g, 3, 4, 10, 1, OUTLINE);
    px(g, 3, 5, 4, 1, OUTLINE);
    px(g, 9, 5, 4, 1, OUTLINE);
    // Nose guard
    px(g, 7, 5, 2, 4, 0x5a6a6a);
    px(g, 7, 5, 1, 4, 0x7e9090); // highlight
    // Rivets
    px(g, 3, 2, 1, 1, 0xcad5d5);
    px(g, 12, 2, 1, 1, 0xcad5d5);
    // Outline
    g.fillStyle(OUTLINE, 1);
    g.fillRect(2, 1, 12, 1);   // top
    g.fillRect(2, 8, 12, 1);   // bottom
    g.fillRect(2, 1, 1, 7);    // left
    g.fillRect(13, 1, 1, 7);   // right
    g.fillRect(2, 6, 1, 2);    // cheek-left outer
    g.fillRect(13, 6, 1, 2);   // cheek-right outer
  },
  mage_hat(g) {
    // Tall pointed wizard hat with star-studded brim
    // Brim
    px(g, 1, 7, 14, 2, 0x1e3070);
    px(g, 1, 7, 14, 1, 0x3050a8); // brim top highlight
    px(g, 2, 8, 12, 1, 0x111e48); // brim underside
    // Cone
    px(g, 5, 3, 6, 4, 0x243a90);
    px(g, 6, 1, 4, 2, 0x243a90);
    px(g, 7, 0, 2, 1, 0x243a90);
    // Cone highlight
    px(g, 5, 3, 1, 4, 0x4060c0);
    px(g, 6, 1, 1, 2, 0x4060c0);
    // Stars on brim
    px(g, 4, 7, 1, 1, 0xf4e042);
    px(g, 9, 7, 1, 1, 0xf4e042);
    px(g, 11, 8, 1, 1, 0xf4e042);
    // Outline
    g.fillStyle(OUTLINE, 1);
    g.fillRect(7, 0, 2, 1);    // tip
    g.fillRect(6, 1, 1, 2);    // left taper
    g.fillRect(10, 1, 1, 2);
    g.fillRect(5, 3, 1, 4);    // left side
    g.fillRect(11, 3, 1, 4);
    g.fillRect(1, 7, 14, 1);   // brim top
    g.fillRect(1, 9, 14, 1);   // brim bottom
    g.fillRect(1, 7, 1, 2);    // brim ends
    g.fillRect(14, 7, 1, 2);
  },
  tide_crown(g) {
    // Regal crown with 3 spikes + aquamarine gem centerpiece
    // Crown base band
    px(g, 3, 5, 10, 3, 0xd4a820);
    px(g, 3, 5, 10, 1, 0xf8d84a);  // top highlight
    px(g, 3, 7, 10, 1, 0x9a7810);  // bottom shadow
    // Three spikes
    px(g, 3, 2, 2, 3, 0xd4a820);   // left spike
    px(g, 3, 2, 1, 3, 0xf8d84a);
    px(g, 7, 1, 2, 4, 0xd4a820);   // center spike (tallest)
    px(g, 7, 1, 1, 4, 0xf8d84a);
    px(g, 11, 2, 2, 3, 0xd4a820);  // right spike
    px(g, 11, 2, 1, 3, 0xf8d84a);
    // Gem in center spike
    px(g, 7, 3, 2, 2, 0x45c8b8);
    px(g, 7, 3, 1, 1, 0x80e8da);   // gem highlight
    // Decorative dots on band
    px(g, 5, 6, 1, 1, 0xf8d84a);
    px(g, 10, 6, 1, 1, 0xf8d84a);
    // Outline
    g.fillStyle(OUTLINE, 1);
    // Spike outlines (simplified)
    g.fillRect(3, 2, 1, 1); g.fillRect(4, 2, 1, 1); g.fillRect(5, 2, 1, 3);
    g.fillRect(4, 5, 1, 1); g.fillRect(3, 5, 1, 1);
    g.fillRect(7, 1, 1, 1); g.fillRect(8, 1, 1, 1);
    g.fillRect(6, 5, 1, 1); g.fillRect(9, 5, 1, 1);
    g.fillRect(11, 2, 1, 1); g.fillRect(12, 2, 1, 1); g.fillRect(10, 2, 1, 3);
    g.fillRect(11, 5, 1, 1); g.fillRect(12, 5, 1, 1);
    g.fillRect(3, 8, 10, 1);  // band bottom
    g.fillRect(3, 5, 1, 3);   // band left
    g.fillRect(12, 5, 1, 3);  // band right
  },
  bone_veil(g) {
    // Pale mourning veil: cowl hood + dark eye hollows + tattered hem
    // Hood
    px(g, 3, 1, 10, 7, 0xd5cfc1); // bone cloth
    px(g, 3, 1, 2, 7, 0xf2ecdd);  // highlight (left face)
    px(g, 11, 2, 2, 6, 0x8f8a7d); // shadow (right edge)
    // Eye hollows
    px(g, 5, 4, 2, 2, OUTLINE);
    px(g, 9, 4, 2, 2, OUTLINE);
    px(g, 5, 4, 1, 1, 0x3a2430);  // faint glimmer
    // Tattered hem
    px(g, 3, 8, 2, 1, 0xd5cfc1);
    px(g, 6, 8, 2, 2, 0xd5cfc1);
    px(g, 9, 8, 1, 1, 0xd5cfc1);
    px(g, 11, 8, 2, 2, 0xd5cfc1);
    // Stitch marks
    px(g, 6, 2, 1, 1, 0x8f8a7d);
    px(g, 9, 6, 1, 1, 0x8f8a7d);
    // Outline
    g.fillStyle(OUTLINE, 1);
    g.fillRect(3, 1, 10, 1);   // top
    g.fillRect(3, 1, 1, 7);    // left
    g.fillRect(12, 1, 1, 7);   // right
    g.fillRect(4, 8, 1, 1); g.fillRect(8, 8, 1, 1); g.fillRect(10, 8, 1, 1); // hem gaps
  },
};

function drawIcon(g, item) {
  const c = item.tint ?? 0xcccccc;
  const light = Phaser.Display.Color.IntegerToColor(c).brighten(35).color;
  const dark  = Phaser.Display.Color.IntegerToColor(c).darken(30).color;

  if (item.slot === 'head') {
    // Helmet silhouette
    px(g, 2, 4, 8, 5, c);
    px(g, 3, 2, 6, 2, c);
    px(g, 2, 4, 2, 5, light);  // highlight
    px(g, 8, 5, 2, 4, dark);   // shadow
    px(g, 3, 6, 4, 1, OUTLINE); // eye slit
    g.fillStyle(OUTLINE, 1);
    g.fillRect(2, 4, 8, 1); g.fillRect(2, 9, 8, 1);
    g.fillRect(2, 4, 1, 5); g.fillRect(9, 4, 1, 5);
    g.fillRect(3, 2, 6, 1); g.fillRect(3, 4, 1, 1); g.fillRect(8, 4, 1, 1);
  } else if (item.slot === 'chest') {
    // Tunic/chestpiece
    px(g, 2, 1, 8, 9, c);      // body
    px(g, 0, 2, 2, 5, c);      // left arm
    px(g, 10, 2, 2, 5, c);     // right arm
    px(g, 2, 1, 2, 9, light);  // highlight left
    px(g, 8, 2, 2, 8, dark);   // shadow right
    px(g, 5, 3, 2, 5, dark);   // center division
    g.fillStyle(OUTLINE, 1);
    g.fillRect(2, 1, 8, 1); g.fillRect(2, 10, 8, 1);
    g.fillRect(2, 1, 1, 9); g.fillRect(9, 1, 1, 9);
    g.fillRect(0, 2, 1, 5); g.fillRect(2, 2, 1, 1);
    g.fillRect(10, 2, 1, 5); g.fillRect(9, 2, 1, 1);
    g.fillRect(0, 7, 2, 1); g.fillRect(10, 7, 2, 1);
  } else if (item.slot === 'weapon') {
    if (item.kind === 'bow') {
      px(g, 1, 0, 2, 12, c);   // limb
      px(g, 1, 0, 1, 12, light);
      px(g, 9, 1, 2, 10, c);   // grip
      g.lineStyle(1, 0xd5d5d5, 0.9);
      g.lineBetween(3, 1, 10, 4);  // string top
      g.lineBetween(3, 11, 10, 8); // string bottom
      g.fillStyle(OUTLINE, 1);
      g.fillRect(1, 0, 2, 1); g.fillRect(1, 11, 2, 1);
      g.fillRect(1, 0, 1, 12);
    } else if (item.kind === 'wand') {
      px(g, 2, 4, 8, 2, 0x7a4820); // shaft
      px(g, 2, 4, 8, 1, 0xa86030); // shaft highlight
      px(g, 8, 1, 4, 4, c);         // orb
      px(g, 8, 1, 2, 2, light);     // orb shine
      px(g, 10, 3, 2, 2, dark);     // orb shadow
      g.fillStyle(OUTLINE, 1);
      g.fillRect(2, 4, 8, 1); g.fillRect(2, 6, 8, 1);
      g.fillRect(2, 4, 1, 2); g.fillRect(9, 4, 1, 2);
      g.fillRect(8, 1, 4, 1); g.fillRect(8, 5, 4, 1);
      g.fillRect(8, 1, 1, 4); g.fillRect(11, 1, 1, 4);
    } else {
      // Sword / melee
      px(g, 6, 0, 3, 7, c);    // blade
      px(g, 6, 0, 1, 7, light); // blade bevel
      px(g, 8, 1, 1, 6, dark);  // blade shadow
      px(g, 4, 7, 7, 1, 0x8d6030); // guard
      px(g, 6, 8, 3, 3, 0x5a3a1e); // grip
      px(g, 6, 11, 3, 1, 0x8d6030); // pommel
      g.fillStyle(OUTLINE, 1);
      g.fillRect(6, 0, 3, 1); g.fillRect(6, 7, 3, 1);
      g.fillRect(6, 0, 1, 7); g.fillRect(8, 0, 1, 7);
      g.fillRect(4, 7, 7, 1); g.fillRect(4, 8, 1, 1); g.fillRect(10, 8, 1, 1);
    }
  } else {
    // Trinket: faceted gem
    px(g, 3, 0, 6, 2, c);      // top facet
    px(g, 1, 2, 10, 4, c);     // wide mid
    px(g, 3, 6, 6, 4, c);      // bottom taper
    px(g, 5, 10, 2, 2, c);     // tip
    px(g, 1, 2, 3, 4, light);  // left highlight
    px(g, 8, 3, 3, 5, dark);   // right shadow
    px(g, 4, 1, 2, 2, 0xffffff, 0.6); // sparkle
    g.fillStyle(OUTLINE, 1);
    g.fillRect(3, 0, 6, 1); g.fillRect(1, 2, 1, 4);
    g.fillRect(10, 2, 1, 4); g.fillRect(3, 6, 1, 4);
    g.fillRect(8, 6, 1, 4); g.fillRect(5, 10, 1, 2);
    g.fillRect(6, 10, 1, 2); g.fillRect(5, 12, 2, 1);
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
