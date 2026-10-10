# Blender promo renders

Marketing stills of the Wayfarer Online "wayfarer" compass-rose emblem, rendered
with Blender 4.5.14 (Cycles, CPU) from `tools/blender_promo.py`.

These are **assets only** — nothing here is wired into the game, no client code
is touched.

## The images

| File | Size | Bytes | What it's for |
|---|---|---|---|
| `public/assets/blender/wayfarer_banner_1920x640.png` | 1920x640 | 1,226,201 | Wide 3:1 lockup (mark left, wordmark right) on the deep-navy field. Site header, X/Twitter banner, YouTube/Discord channel art. Opaque. |
| `public/assets/blender/wayfarer_square_1024.png` | 1024x1024 | 1,076,519 | Square stacked lockup (mark over wordmark). Social avatar, app-store tile, Discord server icon, press-kit logo card. Opaque. |
| `public/assets/blender/wayfarer_hero_plinth_1600.png` | 1600x1600 | 1,773,716 | Hero shot: emblem floating over a hex plinth with a cyan inlay ring. **Transparent background** (73% of pixels fully transparent) so it drops onto any page or slide. |
| `public/assets/blender/wayfarer_crystals_1600x1200.png` | 1600x1200 | 1,341,298 | The game's crystals (green/purple/cyan) clustered on a hex plinth. **Transparent background** (65% transparent). Landing-page section art, token/whitepaper illustration. |

Byte sizes and pixel dimensions above were measured with PIL from the files on
disk, not estimated.

## Regenerating

From the repo root:

```bash
"D:/tools/blender-4.5.14-windows-x64/blender.exe" --background \
    --python tools/blender_promo.py -- "D:/ai-studio/wayfarer-online/public/assets/blender"
```

Full run takes roughly 12-15 minutes on CPU (the 1600px renders dominate). Variants:

```bash
# fast 1/4-resolution drafts (~10s) to check composition before committing
PROMO_QUICK=1 "D:/tools/.../blender.exe" --background \
    --python tools/blender_promo.py -- /tmp/promo_draft

# re-render only some of them (any of: banner,square,hero,crystals)
PROMO_ONLY=hero,crystals "D:/tools/.../blender.exe" --background \
    --python tools/blender_promo.py -- "D:/ai-studio/wayfarer-online/public/assets/blender"
```

The script resets the scene between shots, so any subset renders identically to
a full run.

## Render settings

* Engine **Cycles**, device **CPU**, 160 samples (banner/square) / 192 (hero/crystals),
  adaptive sampling at threshold 0.01, **OpenImageDenoise**.
* `max_bounces` 6 (diffuse 3, glossy 4), `view_transform` **Standard** (no filmic
  curve, so the neon stays saturated), `look` None.
* Output PNG, RGBA, compression 15. `film_transparent` on for hero + crystals.
* **Camera**: orthographic, elevated **20 degrees** above the subject, 18 units out.
  An orthographic camera plus a level angle made everything read as flat vector art;
  the tilt is what reveals the pyramid facets, the plinth's top face and the
  crystals' seating. `ortho_scale` is computed per shot from the real scene bounding
  box (`frame_scene`), projected through the tilted camera's up-axis, so nothing is
  eyeballed off-centre or clipped.
* **Lighting**: three suns (key 3.5 upper-left, cyan rim 2.6 from behind, violet fill
  1.2) plus a soft 5-unit **area light overhead at 1800W** that casts the contact
  shadows grounding the emblem and crystals on their plinths. World is deep navy at
  0.42-0.45 strength.
* **Glare**: compositor `FOG_GLOW` node, threshold 1.0, size 7, mix -0.55 — the neon
  bloom. It is a post pass, so it does not affect the geometry.
* **Palette** (sRGB, converted to linear for the shaders): green `#14F195` cardinal
  arms, purple `#9945FF` diagonal arms, cyan `#03E1FF` hub/ring, off-white `#E1E8F0`
  core and wordmark, navy `#0A0E1A` background, steel `#6B7A99` plinth.
* Materials are Principled BSDF with **modest emission** (green/purple 0.45, cyan 0.60,
  white 1.0) on top of the lit base colour. Earlier drafts ran the emission near 1.0
  and every facet came out the same brightness — the object looked like a flat sticker.
  Letting the suns do most of the shading is what makes it read as a solid.

## Design notes

* **The mark** is the same 8-point compass rose used by the PWA icons
  (`tools/make_pwa_icons.py`): 4 long cardinal arms, 4 short diagonal arms, a cyan
  hub with a white core. Here it is built as real geometry — each arm is a 4-sided
  pyramid (a crystalline needle) with a hub sphere, core sphere and a thin ring.
* **Wordmark** is Blender's bundled font (Bfont) extruded and beveled, in
  `#E1E8F0` / `#14F195`. It is a placeholder-grade typeface; swapping in the brand
  font is the single highest-value improvement if one exists.
* **Chosen look: clean high-resolution 3D, not 1px-outline pixel art.** The in-game
  art is pixel art with a dark outline, which is right at 16-64px. A banner or OG
  image is viewed at 1000px+ on the web, where a crisp render with real speculars
  and bloom sells the game far better. The palette and the mark stay 1:1 with the
  game, so it still reads as the same brand.
* The backdrop on the banner/square is an emission plane behind the subject carrying
  a spherical gradient (lifted navy centre -> near-black edge), so the lockup sits in
  a pool of light rather than on flat navy.

## Honest assessment / known limits

Rated by an independent visual pass: banner ~8/10, square ~7/10, hero ~8/10,
crystals ~7/10. Nothing is broken, but these are the real remaining weaknesses:

* **Contact shadows are soft and shapeless.** The overhead area light grounds the
  objects, but the shadow under the emblem does not reproduce the star silhouette.
  A shaped shadow or a baked AO pass would fix it.
* **The plinth inlay ring is a raised torus, not a flush decal.** It no longer clips
  through the plinth (an earlier draft was a vertical hoop that poked out below the
  base — fixed), but it sits proud of the surface rather than inset.
* **Typeface is generic** (Blender's Bfont). Fine as a placeholder, not ideal for a
  final brand asset.
* **Small-size legibility.** The thin ring and the short purple diagonals blur away
  below ~64px. For a favicon-sized mark, use the existing simplified PWA icons
  rather than these.
* **Opaque banner/square are a specific navy.** If they are dropped on a different
  dark background you will see a rectangle. The hero and crystals are the
  transparent ones for that use.
* **Banner social safe areas** were not specifically designed around; on X the avatar
  circle overlaps the bottom-left of a header, so check the crop before posting there.
