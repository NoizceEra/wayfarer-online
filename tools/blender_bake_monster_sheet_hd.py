#!/usr/bin/env python3
"""HD bake: articulated low-poly creature -> DENSE pixel-art monster sheet.

Sibling of tools/blender_bake_monster_sheet.py. Same output contract (64x64 RGBA,
4x4 grid of 16x16 frames, cols = down/up/left/right, rows = 4-frame walk) but it
attacks the known weakness of the first pipeline: a smooth blob posterises into a
chunky, limb-poor silhouette. The HD pipeline:

  * builds a MORE ARTICULATED model (segmented arms/legs/claws, faceted torso,
    separate head/brow/horns, crystal cluster, tail) with deliberate 1px negative
    space between limbs instead of one merged blob;
  * ZOOMS the ortho camera so the creature fills the 14x14 interior box (the first
    bake only filled ~40% of the frame -> half the detail never resolved);
  * renders at a higher integer multiple (default 64 = 4x16) and downscales with a
    selectable filter:
        nearest  - point sample (the recipe default)
        coverage - a 16x16 cell is opaque if >= thresh of its NxN source block is
                   opaque, colour = majority source colour. This keeps thin limbs
                   alive instead of letting NEAREST drop them.
  * POSES each of the 4 walk frames distinctly (per-limb swing + body bob) instead
    of squashing one static pose;
  * posterises to a WIDER ramp (up to 9 colours, all Ninja-Adventure master palette)
    so the diffuse gradient resolves into more shading bands -> more internal edges;
  * optional inner-shadow pass: darken bottom/right interior edges (guide: shadow on
    bottom/right interior surfaces) for extra internal structure;
  * adds the game's 1px outline (#141b1b) and grounds each frame at y=14.

Blender's bundled python has numpy but not PIL, so this script runs in two modes:
under Blender it renders + shells out to the system python for the post-pass.

Run:
  "D:/tools/blender-4.5.14-windows-x64/blender.exe" --background \\
      --python tools/blender_bake_monster_sheet_hd.py -- \\
      --creature gemgolem --outdir .scratch-blender/hd --name cavern_gemgolem

  --creature    gemgolem | emberling
  --outdir      scratch dir for raw frames + finished sheet
  --name        output sheet basename (default = creature)
  --size        render size px, integer multiple of 16 (default 64)
  --frames      anim frames per facing (default 4)
  --ortho       ortho camera width in world units (default 1.95)
  --downscale   nearest | coverage (default coverage)
  --cov-thresh  coverage opacity threshold, 0..1 (default 0.30)
  --shadow      1 = inner bottom/right shadow pass (default 1)
  --pypost      system python exe with PIL (default: python3)

Verify:  python3 tools/audit_custom_monsters.py
         python3 tools/measure_monster_detail.py <sheet>.png
"""
import os
import sys
import math
import json
import subprocess

try:
    import bpy  # noqa: F401
    IN_BLENDER = True
except Exception:  # system python -> PIL post-pass only
    IN_BLENDER = False

DIRS = ['down', 'up', 'left', 'right']
DIR_ROT = {'down': 0.0, 'up': 180.0, 'left': 90.0, 'right': 270.0}

# Ninja-Adventure master palette subset used by the HD bake (all members of the 33).
OUTLINE = (0x14, 0x1b, 0x1b)
PALETTES = {
    'gemgolem': [
        OUTLINE, (0x3b, 0x36, 0x43), (0x4e, 0x48, 0x4a), (0x8d, 0x97, 0x7f), (0x9b, 0xa7, 0xaa),
        (0x54, 0x3c, 0x52), (0x8f, 0x3e, 0x56), (0x79, 0xb8, 0xce), (0xe3, 0xf1, 0xf5),
    ],
    'emberling': [
        OUTLINE, (0x3b, 0x36, 0x43), (0x4e, 0x48, 0x4a), (0x8f, 0x3e, 0x56), (0xe0, 0x39, 0x4c),
        (0xe4, 0x6d, 0x3a), (0xef, 0x91, 0x4f), (0xff, 0xad, 0x5d), (0xfc, 0xe2, 0xca),
    ],
}
# 3-tone banding roles (guide: highlight on top/left edges, shadow on bottom/right edges).
# Both tones are members of the palette above so the audit still passes.
HILITE = {'gemgolem': (0x9b, 0xa7, 0xaa), 'emberling': (0xff, 0xad, 0x5d)}
SHADOW = {'gemgolem': (0x3b, 0x36, 0x43), 'emberling': (0x3b, 0x36, 0x43)}
# Per-creature framing tuned by the measured sweep (ortho / width / height fit).
RENDER_DEFAULTS = {
    'gemgolem': {'ortho': 2.10, 'fitx': 1.20, 'fity': 1.95, 'fitz': 1.00},
    'emberling': {'ortho': 1.93, 'fitx': 1.35, 'fity': 1.50, 'fitz': 1.00},
}


# --------------------------------------------------------------------------- args
def parse_args(argv):
    a = argv[argv.index('--') + 1:] if '--' in argv else []
    out = {'creature': 'gemgolem', 'outdir': '.scratch-blender/hd', 'name': None,
           'size': 48, 'frames': 4, 'ortho': None, 'downscale': 'coverage',
           'cov_thresh': 0.45, 'shadow': 1, 'fitx': None, 'fity': None, 'fitz': None, 'rim': 1,
           'key': 3.5, 'fill': 0.4, 'amb': 0.12,
           'pypost': 'python3', 'post': False}
    i = 0
    while i < len(a):
        k = a[i].lstrip('-')
        if k == 'post':
            out['post'] = True; i += 1; continue
        if i + 1 < len(a):
            v = a[i + 1]
            if k in ('size', 'frames', 'shadow', 'rim'):
                out[k] = int(v)
            elif k in ('ortho', 'cov_thresh', 'fitx', 'fity', 'fitz', 'key', 'fill', 'amb'):
                out[k] = float(v)
            else:
                out[k] = v
            i += 2
        else:
            i += 1
    # per-creature tuned framing (from the measured sweep) fills the arg defaults
    d = RENDER_DEFAULTS.get(out['creature'], {})
    for k, v in d.items():
        if out.get(k) is None:
            out[k] = v
    for k in ('ortho', 'fitx', 'fity', 'fitz'):
        if out.get(k) is None:
            out[k] = 2.05 if k == 'ortho' else 1.0
    out['name'] = out['name'] or out['creature']
    return out


# --------------------------------------------------------------------------- blender
def _set_in(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def flat_material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    _set_in(bsdf, ['Base Color'], (rgb[0], rgb[1], rgb[2], 1.0))
    _set_in(bsdf, ['Roughness'], 0.95)
    _set_in(bsdf, ['Metallic'], 0.0)
    _set_in(bsdf, ['Specular IOR Level', 'Specular'], 0.0)
    return mat


def _add(obj, mat):
    obj.data.materials.append(mat)
    return obj


def _ico(subdiv, radius, loc, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    return o


def _cube(size, loc, scale=(1, 1, 1), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=size, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    o.rotation_euler = rot
    return o


def _box(hx, hy, hz, loc, rot=(0, 0, 0)):
    """Cube with explicit HALF-extents (hx,hy,hz) in world units -> edge 2*h."""
    return _cube(2.0, loc, (hx, hy, hz), rot)


def _cone(verts, r1, depth, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=0.0, depth=depth, location=loc)
    o = bpy.context.active_object
    o.rotation_euler = rot
    return o


def _part(name, obj):
    return {'name': name, 'obj': obj,
            'home_loc': tuple(obj.location), 'home_rot': tuple(obj.rotation_euler)}


def build_gemgolem():
    """Chunky articulated crystal golem. Parts OVERLAP so the silhouette is a solid
    mass; limbs are thick enough to survive the 16px downscale (>=2px at 16)."""
    stone_d = flat_material('stone_d', (0.23, 0.21, 0.26))
    stone_m = flat_material('stone_m', (0.31, 0.28, 0.29))
    stone_l = flat_material('stone_l', (0.61, 0.65, 0.67))
    crystal = flat_material('crystal', (0.42, 0.24, 0.46))
    gemcy = flat_material('gemcy', (0.47, 0.72, 0.81))
    glow = flat_material('glow', (0.89, 0.94, 0.96))
    parts = []

    def P(name, o, m):
        parts.append(_part(name, _add(o, m)))

    # --- solid torso stack (waist -> chest -> head, all overlapping, deepened in Y so
    #     the side facings read as a body instead of a 1px sliver) ---
    P('waist', _box(0.36, 0.30, 0.20, (0, 0, 0.44)), stone_d)
    P('torso', _ico(1, 0.42, (0, 0, 0.74), (1.10, 1.00, 0.82)), stone_m)
    P('chest', _ico(1, 0.30, (0, -0.06, 0.98), (0.96, 0.82, 0.62)), stone_l)
    P('neck', _box(0.16, 0.18, 0.10, (0, 0, 1.08)), stone_d)
    P('head', _ico(1, 0.25, (0, 0, 1.26), (1.06, 1.04, 1.00)), stone_m)
    P('brow', _box(0.24, 0.10, 0.06, (0, -0.22, 1.32)), stone_d)
    for sx in (-1, 1):
        P(f'eye_{sx}', _box(0.06, 0.05, 0.06, (sx * 0.09, -0.25, 1.25)), glow)
    # --- crystal crown + back cluster + shoulder shards + chest gem ---
    P('crown', _cone(5, 0.16, 0.50, (0.0, 0.03, 1.54), (math.radians(-10), 0, 0)), crystal)
    for sx in (-1, 1):
        P(f'crown_side_{sx}', _cone(5, 0.10, 0.36, (sx * 0.17, 0.06, 1.48),
                                    (math.radians(-14), math.radians(sx * 22), 0)), gemcy)
        P(f'backcry_{sx}', _cone(5, 0.13, 0.42, (sx * 0.32, 0.24, 1.08),
                                 (math.radians(-26), math.radians(sx * 28), 0)), crystal)
        # thin shoulder shards: extra articulation that survives the downscale
        P(f'shard_{sx}', _cone(4, 0.06, 0.30, (sx * 0.48, 0.16, 1.14),
                               (math.radians(-18), math.radians(sx * 34), 0)), gemcy)
        P(f'shard2_{sx}', _cone(4, 0.05, 0.24, (sx * 0.30, 0.28, 1.34),
                                (math.radians(-34), math.radians(sx * 16), 0)), crystal)
    P('gem', _ico(0, 0.16, (0.0, -0.34, 0.84), (1.0, 0.7, 1.15)), gemcy)
    # --- thick arms (shoulder -> upper -> fore -> fist), touching the torso ---
    for sx in (-1, 1):
        P(f'shoulder_{sx}', _box(0.17, 0.17, 0.15, (sx * 0.46, 0.0, 0.98)), stone_d)
        P(f'upperarm_{sx}', _box(0.13, 0.13, 0.19, (sx * 0.52, 0.0, 0.70)), stone_m)
        P(f'forearm_{sx}', _box(0.13, 0.13, 0.17, (sx * 0.54, -0.01, 0.46)), stone_m)
        P(f'fist_{sx}', _box(0.15, 0.15, 0.14, (sx * 0.55, -0.03, 0.24)), stone_d)
    # --- thick legs with a 1px gap between them ---
    for sx in (-1, 1):
        P(f'thigh_{sx}', _box(0.15, 0.17, 0.19, (sx * 0.20, 0.0, 0.34)), stone_m)
        P(f'shin_{sx}', _box(0.14, 0.16, 0.15, (sx * 0.20, 0.0, 0.13)), stone_d)
        P(f'foot_{sx}', _box(0.15, 0.22, 0.08, (sx * 0.20, -0.05, 0.05)), stone_d)
    return parts


def build_emberling():
    """Chunky articulated molten imp: solid charred shell, molten belly, back ridge,
    horned head, white-hot eyes, segmented tail flame, thick arms w/ claws."""
    char_d = flat_material('char_d', (0.20, 0.18, 0.22))
    char_m = flat_material('char_m', (0.28, 0.26, 0.28))
    magma = flat_material('magma', (0.88, 0.30, 0.12))
    ember = flat_material('ember', (0.95, 0.57, 0.30))
    glow = flat_material('glow', (1.0, 0.88, 0.55))
    parts = []

    def P(name, o, m):
        parts.append(_part(name, _add(o, m)))

    # --- solid charred shell + molten belly + back ridge (deepened in Y for the profiles) ---
    P('hips', _box(0.32, 0.28, 0.16, (0, 0, 0.30)), char_d)
    P('shell', _ico(1, 0.46, (0, 0, 0.58), (1.06, 1.00, 0.98)), char_m)
    P('belly', _ico(1, 0.32, (0, -0.16, 0.52), (1.00, 0.78, 0.90)), magma)
    for i, z in enumerate((0.34, 0.56, 0.76)):
        P(f'ridge_{i}', _cone(4, 0.12, 0.32, (0.0, 0.38 + i * 0.02, z), (math.radians(-72), 0, 0)), char_d)
    # --- head + horns + eyes ---
    P('neck', _box(0.16, 0.18, 0.09, (0, 0, 0.94)), char_d)
    P('head', _ico(1, 0.26, (0, 0, 1.08), (1.04, 1.02, 1.00)), char_m)
    for sx in (-1, 1):
        P(f'horn_{sx}', _cone(5, 0.09, 0.34, (sx * 0.17, 0.02, 1.28), (math.radians(-8), math.radians(sx * 26), 0)), char_d)
        P(f'eye_{sx}', _box(0.06, 0.05, 0.06, (sx * 0.10, -0.26, 1.10)), glow)
    P('crownspike', _cone(5, 0.12, 0.38, (0.0, 0.03, 1.36), (math.radians(-12), 0, 0)), magma)
    # --- thick arms (shoulder spike -> upper -> fore -> claw) ---
    for sx in (-1, 1):
        P(f'shoulder_{sx}', _cone(5, 0.12, 0.38, (sx * 0.40, 0.08, 0.84), (0, math.radians(sx * 60), 0)), magma)
        P(f'upperarm_{sx}', _box(0.12, 0.12, 0.17, (sx * 0.44, 0.0, 0.58)), char_m)
        P(f'forearm_{sx}', _box(0.11, 0.11, 0.15, (sx * 0.46, -0.02, 0.36)), char_m)
        P(f'claw_{sx}', _cone(4, 0.11, 0.26, (sx * 0.47, -0.07, 0.20), (math.radians(150), 0, 0)), ember)
    # --- legs (thigh -> foot) ---
    for sx in (-1, 1):
        P(f'thigh_{sx}', _box(0.14, 0.16, 0.15, (sx * 0.22, 0.0, 0.20)), char_m)
        P(f'foot_{sx}', _box(0.13, 0.20, 0.08, (sx * 0.22, -0.05, 0.05)), char_d)
    # --- segmented tail flame ---
    P('tail1', _cone(5, 0.14, 0.32, (0.0, 0.36, 0.58), (math.radians(-100), 0, 0)), magma)
    P('tail2', _cone(5, 0.12, 0.30, (0.0, 0.54, 0.72), (math.radians(-120), 0, 0)), ember)
    P('tail3', _cone(5, 0.09, 0.26, (0.0, 0.68, 0.88), (math.radians(-140), 0, 0)), glow)
    return parts


BUILDERS = {'gemgolem': build_gemgolem, 'emberling': build_emberling}


# per-frame limb swing (world units). rows are the 4 walk frames.
#   dY = forward/back swing, dZ = lift; applied to arm/leg parts on the named side.
WALK = {
    'gemgolem': [
        {'leg_l': (0.00, 0.00), 'leg_r': (0.00, 0.00), 'arm_l': (0.00, 0.00), 'arm_r': (0.00, 0.00), 'bob': 0.00},
        {'leg_l': (-0.10, 0.06), 'leg_r': (0.09, 0.00), 'arm_l': (0.08, 0.00), 'arm_r': (-0.08, 0.03), 'bob': 0.02},
        {'leg_l': (0.00, 0.00), 'leg_r': (0.00, 0.00), 'arm_l': (0.00, 0.00), 'arm_r': (0.00, 0.00), 'bob': 0.05},
        {'leg_l': (0.09, 0.00), 'leg_r': (-0.10, 0.06), 'arm_l': (-0.08, 0.03), 'arm_r': (0.08, 0.00), 'bob': 0.02},
    ],
    'emberling': [
        {'leg_l': (0.00, 0.00), 'leg_r': (0.00, 0.00), 'arm_l': (0.00, 0.00), 'arm_r': (0.00, 0.00), 'bob': 0.00},
        {'leg_l': (-0.12, 0.08), 'leg_r': (0.10, 0.00), 'arm_l': (0.10, 0.04), 'arm_r': (-0.09, 0.00), 'bob': 0.03},
        {'leg_l': (0.00, 0.00), 'leg_r': (0.00, 0.00), 'arm_l': (0.00, 0.00), 'arm_r': (0.00, 0.00), 'bob': 0.06},
        {'leg_l': (0.10, 0.00), 'leg_r': (-0.12, 0.08), 'arm_l': (-0.09, 0.00), 'arm_r': (0.10, 0.04), 'bob': 0.03},
    ],
}
# which part names move with each limb group
LEG_PARTS = ('thigh', 'shin', 'foot', 'claw')
ARM_PARTS = ('upperarm', 'forearm', 'fist', 'claw', 'shoulder')


def _side_base(name):
    """Return (side, base) for a limb part name like 'thigh_-1' / 'claw_1'."""
    if name.endswith('_-1'):
        return 'l', name[:-3]
    if name.endswith('_1'):
        return 'r', name[:-2]
    return None, name


def apply_pose(parts, creature, row):
    pose = WALK[creature][row % len(WALK[creature])]
    bob = pose.get('bob', 0.0)
    for p in parts:
        obj = p['obj']
        hl = list(p['home_loc'])
        side, base = _side_base(p['name'])
        is_leg = base in LEG_PARTS
        # body bob lifts the upper body only; legs keep their feet planted
        z = hl[2] + (0.0 if is_leg else bob)
        dy = hl[1]
        if side in ('l', 'r'):
            if base in LEG_PARTS:
                grp = pose.get('leg_l' if side == 'l' else 'leg_r')
            elif base in ARM_PARTS:
                grp = pose.get('arm_l' if side == 'l' else 'arm_r')
            else:
                grp = None
            if grp:
                dy = hl[1] + grp[0]
                z = hl[2] + (0.0 if is_leg else bob) + grp[1]
        obj.location = (hl[0], dy, z)


def render_creature(args):
    creature = args['creature']
    size = int(args['size'])
    frames = int(args['frames'])
    outdir = os.path.abspath(args['outdir'])
    rawdir = os.path.join(outdir, 'raw', args['name'])
    os.makedirs(rawdir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    parts = BUILDERS[creature]()

    # --- lighting: top-left key + fill (guide light vector [-1,-1]). A SUN light emits
    #     along its local -Z, so it MUST be rotated to aim at the subject; placing it and
    #     leaving the default rotation makes it shine straight down and the front faces
    #     stay black (the old pipeline's flat-dark-body bug). ---
    def _aim_sun(obj, target=(0.0, 0.0, 0.85)):
        from mathutils import Vector
        d = Vector(target) - obj.location
        obj.rotation_euler = (-d).to_track_quat('Z', 'Y').to_euler()

    bpy.ops.object.light_add(type='SUN', location=(-2.5, -3.0, 4.5))
    key = bpy.context.active_object
    key.data.energy = float(args['key'])
    key.data.angle = 0.0
    _aim_sun(key)
    bpy.ops.object.light_add(type='SUN', location=(3.0, 2.0, 2.0))
    fill = bpy.context.active_object
    fill.data.energy = float(args['fill'])
    _aim_sun(fill)
    world = bpy.data.worlds.new('W')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.30, 0.33, 0.40, 1.0)
    bg.inputs[1].default_value = float(args['amb'])

    # --- orthographic camera, slight downward tilt ---
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = float(args['ortho'])
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    tilt_deg = 85.0
    standoff = 10.0
    cam.location = (0, -standoff, 0.85 + standoff * math.tan(math.radians(90 - tilt_deg)))
    cam.rotation_euler = (math.radians(tilt_deg), 0, 0)
    scene.camera = cam

    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.filter_size = 0.01
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    try:
        scene.eevee.taa_render_samples = 1
    except Exception:
        pass
    # pin threading so the render is bit-reproducible (the coverage downscale is
    # threshold-sensitive; free-threaded float noise otherwise swings the metrics)
    try:
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 1
    except Exception:
        pass

    pivot = bpy.data.objects.new('pivot', None)
    scene.collection.objects.link(pivot)
    pivot.scale = (float(args['fitx']), float(args['fity']), float(args['fitz']))
    for p in parts:
        p['obj'].parent = pivot

    manifest = []
    for col, dname in enumerate(DIRS):
        for row in range(frames):
            apply_pose(parts, creature, row)
            pivot.rotation_euler = (0, 0, math.radians(DIR_ROT[dname]))
            path = os.path.join(rawdir, f'{dname}_{row}.png')
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            manifest.append(path)
            print(f'RENDERED {dname} frame {row} -> {path}')

    with open(os.path.join(outdir, 'raw', args['name'] + '.json'), 'w') as f:
        json.dump({'creature': creature, 'size': size, 'frames': frames,
                   'dirs': DIRS, 'files': manifest}, f)

    script = os.path.abspath(__file__)
    cmd = [args['pypost'], script, '--', '--post', '--creature', creature, '--name', args['name'],
           '--outdir', outdir, '--size', str(size), '--frames', str(frames),
           '--downscale', str(args['downscale']), '--cov-thresh', str(args['cov_thresh']),
           '--shadow', str(args['shadow']), '--rim', str(args['rim'])]
    print('POST_CMD=' + ' '.join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    sys.stderr.write(r.stderr)
    print('POST_RC=' + str(r.returncode))
    return r.returncode


# --------------------------------------------------------------------------- PIL post
def _nearest(px, palette):
    best, bd = palette[0], 1 << 30
    for c in palette:
        d = (px[0] - c[0]) ** 2 + (px[1] - c[1]) ** 2 + (px[2] - c[2]) ** 2
        if d < bd:
            bd, best = d, c
    return best


def _downscale_nearest(im, size):
    from PIL import Image
    return im.resize((16, 16), Image.NEAREST)


def _downscale_coverage(im, size, thresh):
    from PIL import Image
    step = size // 16
    src = im.load()
    out = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    op = out.load()
    total = step * step
    for oy in range(16):
        for ox in range(16):
            opaque = 0
            counts = {}
            for y in range(oy * step, oy * step + step):
                for x in range(ox * step, ox * step + step):
                    r, g, b, a = src[x, y]
                    if a >= 128:
                        opaque += 1
                        k = (r, g, b)
                        counts[k] = counts.get(k, 0) + 1
            if opaque and opaque / total >= thresh:
                best = max(counts.items(), key=lambda kv: kv[1])[0]
                op[ox, oy] = best + (255,)
    return out


def post_process(args):
    from PIL import Image
    creature = args['creature']
    size = int(args['size'])
    frames = int(args['frames'])
    outdir = os.path.abspath(args['outdir'])
    rawdir = os.path.join(outdir, 'raw', args['name'])
    palette = PALETTES[creature]
    # Posterise target EXCLUDES the outline colour: otherwise the shadow side of the
    # body maps to pure outline black and the whole form reads as a flat silhouette.
    body_palette = [c for c in palette if c != OUTLINE]
    step = size // 16
    assert step >= 1 and step * 16 == size, 'render size must be an integer multiple of 16'
    mode = args['downscale']
    thresh = float(args['cov_thresh'])
    do_shadow = int(args['shadow']) != 0
    rim = int(args.get('rim', 1))

    def one_frame(path):
        im = Image.open(path).convert('RGBA')
        px = im.load()
        for y in range(size):
            for x in range(size):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 255 if a >= 128 else 0)
        if mode == 'coverage':
            im = _downscale_coverage(im, size, thresh)
        else:
            im = _downscale_nearest(im, size)
        p = im.load()
        for y in range(16):
            for x in range(16):
                r, g, b, a = p[x, y]
                if a:
                    p[x, y] = _nearest((r, g, b), body_palette) + (255,)
        return im

    cells = {}
    for col, dname in enumerate(DIRS):
        for row in range(frames):
            cells[(col, row)] = one_frame(os.path.join(rawdir, f'{dname}_{row}.png'))

    hilite_tone = HILITE[creature]
    shadow_tone = SHADOW[creature]
    sheet = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    for col in range(4):
        for row in range(frames):
            cell = cells[(col, row)]
            bb = cell.getbbox()
            aligned = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
            if bb:
                crop = cell.crop(bb)
                x = (16 - crop.width) // 2
                h = bb[3] - bb[1]
                y = 15 - h                  # ground each frame: content bottom row -> 14
                if y < 0:
                    y = 0                   # (only if content > 15px tall: clip the top)
                aligned.paste(crop, (x, y))
            # --- 3-tone banding: highlight on top/left silhouette edges, shadow on
            #     bottom/right edges (guide: light from top-left). Computed against the
            #     ORIGINAL silhouette so the two passes do not overwrite each other.
            #     `rim` sets the band width in px (1 = selout, 2-3 = classic 3-tone). ---
            if do_shadow and aligned.getbbox():
                base = aligned.copy()
                sp = base.load()
                ap = aligned.load()
                tr = [[not sp[x, y][3] for x in range(16)] for y in range(16)]

                def near(x, y, dirs):
                    for d in range(1, rim + 1):
                        for dx, dy in dirs:
                            nx, ny = x + dx * d, y + dy * d
                            if 0 <= nx < 16 and 0 <= ny < 16 and tr[ny][nx]:
                                return True
                    return False

                shadow_pts, hilite_pts = [], []
                for yy in range(16):
                    for xx in range(16):
                        if not sp[xx, yy][3]:
                            continue
                        if near(xx, yy, ((1, 0), (0, 1), (1, 1))):
                            shadow_pts.append((xx, yy))
                        elif near(xx, yy, ((-1, 0), (0, -1), (-1, -1))):
                            hilite_pts.append((xx, yy))
                for xx, yy in shadow_pts:
                    ap[xx, yy] = shadow_tone + (255,)
                for xx, yy in hilite_pts:
                    ap[xx, yy] = hilite_tone + (255,)
            # --- 1px dark outline outside the silhouette ---
            src = aligned.copy()
            sp = src.load()
            ap = aligned.load()
            for y in range(16):
                for x in range(16):
                    if sp[x, y][3]:
                        continue
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < 16 and 0 <= ny < 16 and sp[nx, ny][3]:
                            ap[x, y] = OUTLINE + (255,)
                            break
            sheet.paste(aligned, (col * 16, row * 16))

    out_path = os.path.join(outdir, args['name'] + '.png')
    sheet.save(out_path, format='PNG')
    print('SHEET=' + out_path + ' size=' + str(sheet.size))


def main():
    args = parse_args(sys.argv)
    if IN_BLENDER and not args['post']:
        sys.exit(render_creature(args))
    if not IN_BLENDER and args['post']:
        post_process(args)
        return
    post_process(args)


if __name__ == '__main__':
    main()
