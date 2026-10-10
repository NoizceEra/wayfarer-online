import Phaser from 'phaser';

// ─────────────────────────────────────────────────────────────────────────────
// Normal-mapped 2D lighting SPIKE (one sprite).
//
// What this does
//   Phaser 3.90 ships a built-in forward-diffuse pipeline, `Light2D`, whose
//   fragment shader (renderer/webgl/shaders/Light.frag) samples a *normal map*
//   alongside the sprite texture:
//       normal = normalize(uInverseRotationMatrix * (normalMap.rgb * 2.0 - 1.0))
//       diffuse = max(dot(normal, lightNormal), 0) * light.color * attenuation
//   A sprite opts in with `sprite.setPipeline('Light2D')`, and its normal map is
//   the texture's `dataSource` — loaded with the two-URL form of the loader:
//       this.load.spritesheet(key, [spriteUrl, normalUrl], { frameWidth, frameHeight })
//
//   So NO custom pipeline is required: the effect rides Phaser's own pipeline and
//   composes with the rest of the scene exactly like any other Game Object (it is
//   still under the day/night MULTIPLY grade quad at depth 2330 and the CRT
//   scanline overlay, so it is graded/tinted like everything else).
//
// Canvas safety
//   `setPipeline` looks up `renderer.pipelines`, which only exists on the WebGL
//   renderer; on the Canvas renderer it is a guarded no-op (components/Pipeline.js)
//   and the sprite falls back to the ordinary canvas sprite path. So under
//   `?renderer=canvas` the sprite still draws normally (never black, never gone) —
//   it simply gets no directional shading. The code below only touches the lights
//   API when the renderer is actually WebGL.
//
// This is deliberately a ONE-sprite demo, gated behind `?nlspike=1`.
// ─────────────────────────────────────────────────────────────────────────────

const SPRITE_KEY = 'mon.nlspike_gemgolem';
const SPRITE_URL = 'assets/custom/nlspike/gemgolem.png';
const NORMAL_URL = 'assets/custom/nlspike/gemgolem_n.png';

export function isWebGL(game) {
  return !!(game && game.renderer && game.renderer.type === Phaser.WEBGL);
}

export function installNormalLightDemo(scene, opts = {}) {
  const webgl = isWebGL(scene.game);
  const p = scene.player;
  const px = opts.x != null ? opts.x : (p ? Math.round(p.x) + 44 : 1024);
  const py = opts.y != null ? opts.y : (p ? Math.round(p.y) : 1024);
  const radius = opts.radius != null ? opts.radius : 96;
  const intensity = opts.intensity != null ? opts.intensity : 3.0;
  const ambient = opts.ambient != null ? opts.ambient : 0x505050;

  const build = () => {
    // A single monster frame (down-facing, frame 0), grounded like the game's monsters.
    const spr = scene.add.sprite(px, py, SPRITE_KEY, 0).setOrigin(0.5, 1).setDepth(1500);

    let light = null;
    if (webgl) {
      scene.lights.enable().setAmbientColor(ambient);
      light = scene.lights.addLight(px, py - 8, radius, 0xffd9a0, intensity);
      spr.setPipeline('Light2D');
    }

    const handle = {
      webgl,
      renderer: webgl ? 'webgl' : 'canvas',
      sprite: spr,
      light,
      key: SPRITE_KEY,
      spritePos() { return { x: spr.x, y: spr.y }; },
      lightPos() { return light ? { x: light.x, y: light.y } : null; },
      setLight(x, y) { if (light) { light.x = x; light.y = y; } },
      setAmbient(c) { if (webgl) scene.lights.setAmbientColor(c); },
      setLighting(on) {
        if (!webgl) return false;
        if (on) { spr.setPipeline('Light2D'); } else { spr.resetPipeline(); }
        return true;
      },
      pipelineName() { return spr.getPipelineName(); },
    };
    if (typeof window !== 'undefined') window.__nlspike = handle;
    return handle;
  };

  if (scene.textures.exists(SPRITE_KEY)) return build();
  scene.load.spritesheet(SPRITE_KEY, [SPRITE_URL, NORMAL_URL], { frameWidth: 16, frameHeight: 16 });
  scene.load.once('complete', build);
  scene.load.start();
  return null;
}

// Wait for the world scene to be live, then install the demo once.
export function install(game, opts = {}) {
  const attach = () => {
    if (typeof window !== 'undefined' && window.__nlspike) return true;
    const w = game.scene.getScene('world');
    if (w && w.sys && w.sys.isActive()) { installNormalLightDemo(w, opts); return true; }
    return false;
  };
  if (attach()) return;
  const iv = setInterval(() => { if (attach()) clearInterval(iv); }, 400);
  setTimeout(() => clearInterval(iv), 90000);
}
