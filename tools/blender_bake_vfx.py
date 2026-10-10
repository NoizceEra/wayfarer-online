#!/usr/bin/env python3
"""
blender_bake_vfx.py — bake procedural 3D effect animations into low-res pixel-art
spritesheets that match Wayfarer Online's art style.

WHY THIS FILE HAS TWO MODES
---------------------------
The deliverable is "a reusable Blender script that renders an effect animation to a
pixel-art spritesheet (posterise + outline + nearest-neighbour)". The rendering half
must run inside Blender, but the posterise / outline half needs PIL — which Blender's
bundled Python does NOT ship. So this single file is BOTH:

  * orchestrator  (run with the *system* python that has Pillow):
        python tools/blender_bake_vfx.py [effect ...]
      For each effect it shells out to Blender for the raw render, then post-processes
      the raw frames with PIL and writes the final spritesheet into
      public/assets/custom/fx/.

  * render stage  (run *by* Blender, invoked automatically by the orchestrator):
        "<blender>" --background --python tools/blender_bake_vfx.py -- --render <effect> <rawdir>

Add a new effect by dropping one entry into EFFECTS below (metadata + a build()
function). The same script then bakes it — nothing else to touch.

STYLE RULES APPLIED (the game's art contract)
---------------------------------------------
  1. Orthographic camera, pure-emission (flat colour) materials.
  2. Render at an integer multiple of the target (SUPER=4), then downscale with
     Image.NEAREST only.
  3. Posterise to a small fixed per-effect palette (nearest-colour) with a hard
     alpha threshold, so anti-aliased render edges become crisp pixel edges.
  4. Add a 1px dark outline in PIL — the game's OUTLINE colour 0x14,0x1b,0x1b
     (src/systems/heroArt.js).
  5. Transparent background (RGBA, film_transparent=True).

SCREEN MAPPING: the ortho camera sits at (0,-10,0) looking +Y, so screen-right = +X,
screen-up = +Z, and a SMALLER y is NEARER the camera (drawn on top). Effects use that
to layer concentric shells front-to-back so the hot core is never occluded.
"""

import os
import sys
import math
import subprocess

# ── shared constants ─────────────────────────────────────────────────────────
OUTLINE = (0x14, 0x1B, 0x1B, 255)          # the game's 1px outline (heroArt.js)
SUPER = 4                                   # render at 4x the target, then NEAREST down
DEFAULT_BLENDER = os.environ.get(
    "BLENDER_BIN", "D:/tools/blender-4.5.14-windows-x64/blender.exe"
)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, "public", "assets", "custom", "fx")

# ── effect registry ──────────────────────────────────────────────────────────
# Each entry: metadata used by both modes + a build() that only touches bpy.
#   out        : final spritesheet filename (written to OUT_DIR)
#   frames     : frame count (sheet is frames * target_px wide)
#   target_px  : final per-frame pixel size
#   fps        : playback rate registered in the game loader
#   palette    : fixed sRGB colours the render is posterised to (index 0 = hottest)
#   build      : (bpy, scene, colours) -> list of actor dicts
# An actor dict: {"obj": <bpy object>, "pose": fn(t)->(loc, scale, rot)} where t is
# 0..1 across the animation. Returning scale (0,0,0) hides the actor for that frame.
EFFECTS = {}


def effect(name, out, frames, target_px, fps, palette):
    def deco(fn):
        EFFECTS[name] = dict(
            out=out, frames=frames, target_px=target_px, fps=fps,
            palette=palette, build=fn,
        )
        return fn
    return deco


# gaussian bump: smooth appear/vanish, peak at c, width w
def _bump(t, c, w):
    return math.exp(-(((t - c) / w) ** 2))


def _radial_rot(ang):
    """Euler that points a cone's +Z axis along the XZ-plane direction `ang`."""
    return (0.0, math.pi / 2 - ang, 0.0)


# ---------------------------------------------------------------------------
# EXPLOSION / IMPACT BURST  — warm fire ramp, layered core + radial shards + shockwave
# ---------------------------------------------------------------------------
@effect(
    "explosion", "baked_explosion.png", frames=8, target_px=64, fps=18,
    palette=[(255, 255, 255), (255, 240, 150), (255, 180, 60),
             (255, 110, 40), (232, 72, 24), (150, 44, 18)],
)
def build_explosion(bpy, scene, C):
    import random
    rnd = random.Random(7)
    actors = []
    white, yellow, orange, red, deep = C["white"], C["yellow"], C["orange"], C["red"], C["deep"]

    # concentric shells, layered front(-y) -> back(+y) so every ring stays visible
    core = _ico(bpy, "core", 2, white)
    inner = _ico(bpy, "inner", 2, yellow)
    shell = _ico(bpy, "shell", 2, orange)
    halo = _ico(bpy, "halo", 2, deep)
    ring = _torus(bpy, "ring", 1.0, 0.055, red)

    def core_pose(t):
        s = 0.90 * _bump(t, 0.30, 0.16)
        return (0, -0.07, 0), (s, s, s), (0, 0, 0)

    def inner_pose(t):
        s = 1.05 * _bump(t, 0.34, 0.20)
        return (0, -0.03, 0), (s, s, s), (0, 0, 0)

    def shell_pose(t):
        s = 1.22 * _bump(t, 0.38, 0.25)
        return (0, 0.02, 0), (s, s, s), (0, 0, 0)

    def halo_pose(t):
        s = 1.45 * _bump(t, 0.42, 0.30)
        return (0, 0.06, 0), (s, s, s), (0, 0, 0)

    def ring_pose(t):
        s = (0.25 + 1.9 * t) * _bump(t, 0.45, 0.32)
        return (0, 0, 0), (s, s, s), (0, 0, 0)

    actors += [dict(obj=core, pose=core_pose), dict(obj=inner, pose=inner_pose),
               dict(obj=shell, pose=shell_pose), dict(obj=halo, pose=halo_pose),
               dict(obj=ring, pose=ring_pose)]

    # radial fire shards that fly out, point outward, and fall under gravity
    n = 16
    for i in range(n):
        ang = (i / n) * math.tau + rnd.uniform(-0.10, 0.10)
        mat = _emission(bpy, f"shard{i}", rnd.choice([white, yellow, yellow, orange]))
        o = _cone(bpy, f"shard{i}", verts=4, r1=0.20, depth=0.85, mat=mat)
        spd = rnd.uniform(1.05, 1.65)
        up = rnd.uniform(0.05, 0.25)

        def pose(t, ang=ang, spd=spd, up=up):
            r = 0.12 + spd * t
            x = math.cos(ang) * r
            z = math.sin(ang) * r + up * t - 0.85 * t * t
            s = (1.0 - 0.82 * t) * _bump(t, 0.5, 0.85)
            return (x, 0, z), (s, s, s), _radial_rot(ang)

        actors.append(dict(obj=o, pose=pose))

    return actors


# ---------------------------------------------------------------------------
# ICE SHATTER — cool cyan ramp, faceted crystal bursting into spinning shards
# ---------------------------------------------------------------------------
@effect(
    "iceShatter", "baked_ice_shatter.png", frames=8, target_px=64, fps=20,
    palette=[(255, 255, 255), (214, 244, 255), (150, 222, 255),
             (90, 192, 255), (42, 120, 208), (20, 64, 128)],
)
def build_ice(bpy, scene, C):
    import random
    rnd = random.Random(23)
    actors = []
    white, pale, cyan, blue, deep = C["white"], C["pale"], C["cyan"], C["blue"], C["deep"]

    crystal = _ico(bpy, "crystal", 1, white)        # faceted (subdiv 1) shard core
    ring = _torus(bpy, "ring", 1.0, 0.05, cyan)
    flash = _ico(bpy, "flash", 2, white)

    def crystal_pose(t):
        # present and large, then shears away as the shards leave
        s = max(0.0, 1.12 * (1.0 - t / 0.40))
        return (0, -0.05, 0), (s, s, s * 1.30), (0, 0, 0)

    def flash_pose(t):
        s = 0.62 * _bump(t, 0.18, 0.08)
        return (0, -0.09, 0), (s, s, s), (0, 0, 0)

    def ring_pose(t):
        s = (0.22 + 1.85 * t) * _bump(t, 0.48, 0.34)
        return (0, 0, 0), (s, s, s), (0, 0, 0)

    actors += [dict(obj=crystal, pose=crystal_pose), dict(obj=flash, pose=flash_pose),
               dict(obj=ring, pose=ring_pose)]

    n = 12
    for i in range(n):
        ang = (i / n) * math.tau + rnd.uniform(-0.08, 0.08)
        mat = _emission(bpy, f"ice{i}", rnd.choice([white, pale, cyan, blue]))
        o = _cone(bpy, f"ice{i}", verts=3, r1=0.18, depth=0.82, mat=mat)
        spd = rnd.uniform(1.15, 1.7)
        spin = rnd.uniform(-9, 9)

        def pose(t, ang=ang, spd=spd, spin=spin):
            r = 0.10 + spd * t
            x = math.cos(ang) * r
            z = math.sin(ang) * r + 0.15 * t - 0.55 * t * t
            s = (1.0 - 0.78 * t) * _bump(t, 0.5, 0.85)
            return (x, 0, z), (s, s, s), (spin * t, math.pi / 2 - ang, 0)

        actors.append(dict(obj=o, pose=pose))

    # slow drifting frost motes for depth
    for i in range(4):
        mat = _emission(bpy, f"mote{i}", pale)
        o = _ico(bpy, f"mote{i}", 1, None, mat=mat)
        ang = rnd.uniform(0, math.tau)
        spd = rnd.uniform(0.75, 1.05)

        def pose(t, ang=ang, spd=spd):
            r = 0.25 + spd * t
            s = 0.13 * _bump(t, 0.55, 0.6)
            return (math.cos(ang) * r, 0, math.sin(ang) * r), (s, s, s), (0, 0, 0)

        actors.append(dict(obj=o, pose=pose))

    return actors


# ---------------------------------------------------------------------------
# HEAL / BUFF SPARKLE — green holy ramp, rising plus-signs + twinkling motes
# ---------------------------------------------------------------------------
@effect(
    "healSparkle", "baked_heal_sparkle.png", frames=8, target_px=64, fps=16,
    palette=[(255, 255, 255), (230, 255, 200), (160, 240, 140),
             (90, 224, 122), (60, 170, 110), (40, 120, 90)],
)
def build_heal(bpy, scene, C):
    import random
    rnd = random.Random(101)
    actors = []
    white, light, green, mid = C["white"], C["light"], C["green"], C["mid"]

    glow = _ico(bpy, "glow", 2, mid)
    heart = _ico(bpy, "heart", 2, white)

    def glow_pose(t):
        s = 0.40 * _bump(t, 0.5, 0.40)
        return (0, 0.05, 0.05 * t), (s, s, s), (0, 0, 0)

    def heart_pose(t):
        s = 0.16 * _bump(t, 0.5, 0.3)
        return (0, -0.06, 0.05 * t), (s, s, s), (0, 0, 0)

    actors += [dict(obj=glow, pose=glow_pose), dict(obj=heart, pose=heart_pose)]

    # rising plus-signs (the game's heal cross, as real 3D geometry)
    n = 6
    for i in range(n):
        mat = _emission(bpy, f"cross{i}", rnd.choice([white, light, light, green]))
        o = _cross(bpy, f"cross{i}", arm=0.85, thick=0.26, mat=mat)
        x0 = rnd.uniform(-0.55, 0.55)
        z0 = -0.95 - rnd.uniform(0, 0.20)
        spd = rnd.uniform(1.3, 1.7)
        drift = rnd.uniform(-0.16, 0.16)
        phase = rnd.uniform(0, 0.35)

        def pose(t, x0=x0, z0=z0, spd=spd, drift=drift, phase=phase):
            u = max(0.0, min(1.0, (t - phase) / (1.0 - phase)))
            z = z0 + spd * u
            x = x0 + drift * u
            s = (0.85 + 0.15 * math.sin(t * 12)) * _bump(t, 0.55, 0.95)
            return (x, -0.02, z), (s, s, s), (0, 0, 0)

        actors.append(dict(obj=o, pose=pose))

    # twinkling star motes scattered around the bloom
    for i in range(12):
        mat = _emission(bpy, f"star{i}", rnd.choice([white, light]))
        o = _ico(bpy, f"star{i}", 1, None, mat=mat)
        ang = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.3, 0.85)
        zc = rnd.uniform(-0.25, 0.6)
        tw = rnd.uniform(0, 6.28)

        def pose(t, ang=ang, r=r, zc=zc, tw=tw):
            s = 0.18 * max(0.0, math.sin(t * math.pi * 1.3 + tw)) * _bump(t, 0.55, 0.7)
            return (math.cos(ang) * r, 0, math.sin(ang) * r + zc), (s, s, s), (0, 0, 0)

        actors.append(dict(obj=o, pose=pose))

    return actors


# ── Blender-side geometry helpers (import bpy only when called) ──────────────
def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _lin(rgb):
    return tuple(_srgb_to_linear(v / 255.0) for v in rgb)


def _emission(bpy, name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    r, g, b = _lin(rgb)
    em.inputs["Color"].default_value = (r, g, b, 1.0)
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def _finish(bpy, o, mat):
    bpy.ops.object.shade_flat()
    if mat is not None:
        o.data.materials.append(mat)
    return o


def _ico(bpy, name, subdiv, rgb, mat=None):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1.0, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    return _finish(bpy, o, mat or _emission(bpy, name, rgb))


def _cone(bpy, name, verts, r1, depth, mat):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=0.0, depth=depth,
                                    location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    return _finish(bpy, o, mat)


def _torus(bpy, name, major, minor, rgb):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=28, minor_segments=8, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    # stand the torus up so its ring faces the camera (rotate into the XZ plane),
    # then bake the rotation into the mesh so a later pose can use a clean euler.
    o.rotation_euler = (math.radians(90), 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return _finish(bpy, o, _emission(bpy, name, rgb))


def _cross(bpy, name, arm, thick, mat):
    """A plus-sign built from two cubes, joined into one mesh (arm = full bar length)."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    a = bpy.context.active_object
    a.scale = (thick, thick, arm)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    b = bpy.context.active_object
    b.scale = (arm, thick, thick)
    for o in (a, b):
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.select_all(action="DESELECT")
    a.select_set(True)
    b.select_set(True)
    bpy.context.view_layer.objects.active = a
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return _finish(bpy, o, mat)


# ── render stage (runs inside Blender) ───────────────────────────────────────
def render_effect(name, raw_dir):
    import bpy
    eff = EFFECTS[name]
    os.makedirs(raw_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    try:
        scene.cycles.device = "CPU"
        scene.cycles.samples = 8
        scene.cycles.use_denoising = False
    except Exception:
        pass
    scene.render.film_transparent = True
    rpx = eff["target_px"] * SUPER
    scene.render.resolution_x = rpx
    scene.render.resolution_y = rpx
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    try:
        scene.view_settings.look = "None"
    except Exception:
        pass

    # orthographic front camera; screen-right = +X, screen-up = +Z, camera looks +Y
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 3.4
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam

    # colour lookup keyed by palette role, built from the effect's palette
    pal = eff["palette"]

    def at(i):
        return pal[i] if len(pal) > i else pal[0]

    C = dict(white=at(0), yellow=at(1), orange=at(2), red=at(3), deep=at(5),
             pale=at(1), cyan=at(2), blue=at(3), light=at(1), green=at(3), mid=at(4))

    actors = eff["build"](bpy, scene, C)

    n = eff["frames"]
    for i in range(n):
        t = i / (n - 1)
        for a in actors:
            loc, sc, rot = a["pose"](t)
            ob = a["obj"]
            ob.location = loc
            ob.scale = sc
            ob.rotation_euler = rot
        scene.render.filepath = os.path.join(raw_dir, "frame_%03d.png" % i)
        bpy.ops.render.render(write_still=True)

    print("RENDERED=%s frames=%d out=%s" % (name, n, raw_dir))


# ── post-process stage (system python + PIL) ─────────────────────────────────
def _nearest_palette(rgb, palette):
    r, g, b = rgb
    best, bd = palette[0], 1 << 30
    for p in palette:
        d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2
        if d < bd:
            bd, best = d, p
    return best


def _posterise(im, palette, alpha_cut=110):
    from PIL import Image
    w, h = im.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    src = im.load()
    dst = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a < alpha_cut:
                continue
            pr, pg, pb = _nearest_palette((r, g, b), palette)
            dst[x, y] = (pr, pg, pb, 255)
    return out


def _add_outline(im, colour=OUTLINE):
    from PIL import Image
    w, h = im.size
    px = im.load()
    solid = [[px[x, y][3] > 0 for x in range(w)] for y in range(h)]
    out = im.copy()
    op = out.load()
    for y in range(h):
        for x in range(w):
            if solid[y][x]:
                continue
            border = False
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1),
                           (-1, -1), (1, -1), (-1, 1), (1, 1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and solid[ny][nx]:
                    border = True
                    break
            if border:
                op[x, y] = colour
    return out


def postprocess(name, raw_dir, out_path):
    from PIL import Image
    eff = EFFECTS[name]
    n = eff["frames"]
    tgt = eff["target_px"]
    frames = []
    for i in range(n):
        fp = os.path.join(raw_dir, "frame_%03d.png" % i)
        im = Image.open(fp).convert("RGBA")
        im = im.resize((tgt, tgt), Image.NEAREST)          # nearest-neighbour downscale
        im = _posterise(im, eff["palette"])                 # fixed palette + hard alpha
        im = _add_outline(im)                               # 1px dark outline
        frames.append(im)
    sheet = Image.new("RGBA", (tgt * n, tgt), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * tgt, 0))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sheet.save(out_path, format="PNG")
    ncolors = len({p for f in frames for p in f.get_flattened_data() if p[3] > 0})
    return dict(path=out_path, w=sheet.size[0], h=sheet.size[1],
                frames=n, bytes=os.path.getsize(out_path), colours=ncolors)


# ── entry points ─────────────────────────────────────────────────────────────
def _is_blender():
    try:
        import bpy  # noqa: F401
        return True
    except Exception:
        return False


def main():
    argv = sys.argv
    rest = argv[argv.index("--") + 1:] if "--" in argv else []

    if rest and rest[0] == "--render":
        render_effect(rest[1], rest[2])          # invoked by Blender
        return

    # orchestrator mode (system python)
    wanted = [a for a in rest if not a.startswith("-")] or list(EFFECTS.keys())
    import tempfile
    scratch = os.environ.get("VFX_RAW_DIR") or os.path.join(tempfile.gettempdir(), "wf_vfx_raw")
    blender = os.environ.get("BLENDER_BIN", DEFAULT_BLENDER)
    print("blender :", blender)
    print("out_dir :", OUT_DIR)
    results = []
    for name in wanted:
        if name not in EFFECTS:
            print("!! unknown effect:", name)
            continue
        raw = os.path.join(scratch, name)
        cmd = [blender, "--background", "--python", os.path.abspath(__file__),
               "--", "--render", name, raw]
        print("render  :", name)
        subprocess.run(cmd, check=True)
        out_path = os.path.join(OUT_DIR, EFFECTS[name]["out"])
        info = postprocess(name, raw, out_path)
        results.append(info)
        print("baked   : %s -> %s (%dx%d, %d frames, %d bytes, %d colours)" % (
            name, info["path"], info["w"], info["h"], info["frames"],
            info["bytes"], info["colours"]))
    print("DONE", len(results))


if __name__ == "__main__":
    main()
