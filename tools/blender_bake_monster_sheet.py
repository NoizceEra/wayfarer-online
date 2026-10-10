#!/usr/bin/env python3
"""Bake a low-poly Blender creature into a Wayfarer-Online pixel-art monster sheet.

Output format is the game's custom-monster contract (see src/assets/catalog.js
`CUSTOM_MONSTER_FILES` and src/assets/loader.js `preloadWorld`):
  64x64 RGBA PNG, 4 columns x 4 rows of 16x16 frames.
  columns = down / up / left / right   (Phaser frame indices 0,4,8,12 | 1,5,9,13 | 2,6,10,14 | 3,7,11,15)
  rows    = 4-frame walk/step cycle

The whole "3D render -> flat pixel art" pipeline lives here:
  1. orthographic camera + flat diffuse materials (no specular) -> flat colour
  2. render each of the 4 facings x N anim frames at an integer multiple of 16px
  3. PIL post-pass (run under the SYSTEM python, which has PIL):
       * threshold alpha to 1-bit
       * NEAREST-neighbour integer downscale to 16x16 (never fractional)
       * posterise to a small fixed palette drawn from the Ninja-Adventure master palette
       * add the game's 1px dark outline (0x14,0x1b,0x1b - see systems/heroArt.js OUTLINE)
       * ground each frame so its footprint sits on y=14 (audit_custom_monsters.py)
       * paste the 16 frames into the 64x64 sheet

Blender's bundled python has numpy but NOT PIL, so this single script runs in two
modes: under Blender it renders + shells out to the system python for the post-pass.

Blender lives at: D:/tools/blender-4.5.14-windows-x64/blender.exe (4.5.14 LTS).
Run (one command produces the final sheet):
  "D:/tools/blender-4.5.14-windows-x64/blender.exe" --background \\
      --python tools/blender_bake_monster_sheet.py -- \\
      --creature gemgolem --outdir .scratch-blender/mon --name cavern_gemgolem

  --creature   gemgolem | emberling        (which low-poly creature to build)
  --outdir     scratch dir for raw frames + the finished sheet
  --name       output sheet basename (default = creature)
  --size       render size in px, integer multiple of 16 (default 32)
  --frames     anim frames per facing (default 4)
  --ortho      orthographic camera width in world units (default 2.15)
  --pypost     system python exe that has PIL (default: python3)

Verify the result with:  python3 tools/audit_custom_monsters.py
"""
import os
import sys
import math
import json
import shutil
import subprocess

try:
    import bpy  # noqa: F401
    IN_BLENDER = True
except Exception:  # running under the system python -> PIL post-pass only
    IN_BLENDER = False

# Column order the game's Phaser frame indices expect (see monster_style_guide.json).
DIRS = ['down', 'up', 'left', 'right']
DIR_ROT = {'down': 0.0, 'up': 180.0, 'left': 90.0, 'right': 270.0}

# Ninja-Adventure master palette (tools/monster_style_guide.json). Posterise targets are
# drawn from this set so every output colour passes the master-palette audit.
OUTLINE = (0x14, 0x1b, 0x1b)
PALETTES = {
    # crystal gem golem: slate stone body, purple/cyan crystal, bright eyes
    'gemgolem': [
        OUTLINE, (0x3b, 0x36, 0x43), (0x4e, 0x48, 0x4a), (0x5f, 0x71, 0x60),
        (0x9b, 0xa7, 0xaa), (0x54, 0x3c, 0x52), (0x8f, 0x3e, 0x56),
        (0x79, 0xb8, 0xce), (0xe3, 0xf1, 0xf5),
    ],
    # magma ember creature: charred rock, molten bands, white-hot core
    'emberling': [
        OUTLINE, (0x3b, 0x36, 0x43), (0x4e, 0x48, 0x4a), (0x8f, 0x3e, 0x56),
        (0xe0, 0x39, 0x4c), (0xe4, 0x6d, 0x3a), (0xef, 0x91, 0x4f),
        (0xff, 0xad, 0x5d), (0xfc, 0xe2, 0xca),
    ],
}
# Per-frame squash/stretch about the feet (feet sit at z=0, so the base stays planted)
# plus an optional Z rotation wobble (degrees) for extra life.
ANIM = {
    'gemgolem':  [(1.00, 1.00, 0.0), (0.90, 1.07, 0.0), (1.00, 1.00, 0.0), (1.09, 0.95, 0.0)],
    'emberling': [(1.00, 1.00, 0.0), (1.12, 0.93, 5.0), (1.00, 1.00, 0.0), (0.88, 1.08, -5.0)],
}


# --------------------------------------------------------------------------- args
def parse_args(argv):
    a = argv[argv.index('--') + 1:] if '--' in argv else []
    out = {'creature': 'gemgolem', 'outdir': '.scratch-blender/mon', 'name': None,
           'size': 32, 'frames': 4, 'ortho': 2.15, 'pypost': 'python3', 'post': False}
    i = 0
    while i < len(a):
        k = a[i].lstrip('-')
        if k == 'post':
            out['post'] = True; i += 1; continue
        if i + 1 < len(a):
            v = a[i + 1]
            out[k] = int(v) if k in ('size', 'frames') else (float(v) if k == 'ortho' else v)
            i += 2
        else:
            i += 1
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
    """Diffuse-only material: flat cell-shaded colour bands, no glossy specular."""
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


def _cone(verts, r1, depth, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=0.0, depth=depth, location=loc)
    o = bpy.context.active_object
    o.rotation_euler = rot
    return o


def build_gemgolem():
    """Chunky crystal golem: blocky slate limbs, faceted torso, purple crystal cluster, cyan eyes."""
    stone = flat_material('stone', (0.34, 0.40, 0.40))
    crystal = flat_material('crystal', (0.42, 0.24, 0.46))
    glow = flat_material('glow', (0.85, 0.96, 1.0))
    objs = []
    for sx in (-1, 1):
        objs.append(_add(_cube(1.0, (sx * 0.21, 0.0, 0.15), (0.20, 0.24, 0.30)), stone))   # legs
        objs.append(_add(_cube(1.0, (sx * 0.52, 0.0, 1.02), (0.26, 0.24, 0.22)), stone))   # shoulders
        objs.append(_add(_cube(1.0, (sx * 0.68, 0.0, 0.72), (0.16, 0.16, 0.46)), stone))   # arms
        objs.append(_add(_cube(0.11, (sx * 0.10, -0.19, 1.36), (1, 1, 1)), glow))           # eyes
    objs.append(_add(_ico(1, 0.46, (0, 0, 0.80), (1.06, 0.80, 1.02)), stone))              # torso
    objs.append(_add(_ico(0, 0.25, (0, 0, 1.34), (1.0, 0.92, 1.0)), stone))                # head
    objs.append(_add(_cone(5, 0.15, 0.44, (0.0, 0.06, 1.50), (math.radians(-10), 0, 0)), crystal))  # crown
    for sx in (-1, 1):
        objs.append(_add(_cone(5, 0.11, 0.36, (sx * 0.40, 0.14, 1.16),
                               (math.radians(-20), math.radians(sx * 22), 0)), crystal))   # back crystals
    objs.append(_add(_ico(0, 0.15, (0.0, -0.40, 0.86), (1.0, 0.7, 1.1)), crystal))         # chest gem
    return objs


def build_emberling():
    """Molten imp: charred rock shell, glowing magma core, white-hot eyes, flame spikes."""
    char = flat_material('char', (0.14, 0.13, 0.16))
    magma = flat_material('magma', (0.92, 0.34, 0.12))
    glow = flat_material('glow', (1.0, 0.84, 0.42))
    objs = []
    objs.append(_add(_ico(1, 0.48, (0, 0, 0.60), (1.02, 0.9, 1.06)), char))           # body shell
    objs.append(_add(_ico(1, 0.34, (0, -0.18, 0.54), (1.0, 0.72, 1.0)), magma))        # molten belly
    objs.append(_add(_ico(0, 0.26, (0, 0, 1.12), (1.0, 0.92, 1.0)), char))             # head
    for sx in (-1, 1):
        objs.append(_add(_cube(0.11, (sx * 0.10, -0.21, 1.16), (1, 1, 1)), glow))      # eyes
        objs.append(_add(_cube(1.0, (sx * 0.22, 0.0, 0.09), (0.17, 0.21, 0.20)), char))  # feet
        objs.append(_add(_cone(5, 0.11, 0.40, (sx * 0.42, 0.06, 0.92),
                               (0, math.radians(sx * 62), 0)), magma))                 # shoulder spikes
    objs.append(_add(_cone(5, 0.12, 0.36, (0.0, 0.02, 1.40), (math.radians(-14), 0, 0)), magma))  # crown spike
    objs.append(_add(_cone(5, 0.12, 0.40, (0.0, 0.26, 0.80), (math.radians(-70), 0, 0)), magma))  # tail flame
    return objs


BUILDERS = {'gemgolem': build_gemgolem, 'emberling': build_emberling}


def render_creature(args):
    creature = args['creature']
    size = int(args['size'])
    frames = int(args['frames'])
    outdir = os.path.abspath(args['outdir'])
    rawdir = os.path.join(outdir, 'raw', args['name'])
    os.makedirs(rawdir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    objs = BUILDERS[creature]()

    # --- lighting: top-left key + soft fill (matches the guide's [-1,-1] light) ---
    bpy.ops.object.light_add(type='SUN', location=(-2.5, -3.0, 4.5))
    bpy.context.active_object.data.energy = 3.2
    bpy.context.active_object.data.angle = 0.0
    bpy.ops.object.light_add(type='SUN', location=(3.0, 2.0, 2.0))
    bpy.context.active_object.data.energy = 1.1
    # ambient so shadow sides land on a mid palette tone instead of black
    world = bpy.data.worlds.new('W')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.30, 0.33, 0.40, 1.0)
    bg.inputs[1].default_value = 0.35

    # --- orthographic camera, slight downward tilt (front view sees the -Y face) ---
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = float(args['ortho'])
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    # aim the view centre at the creature's mid-height (a tilt of `tilt_deg` over a
    # 10-unit standoff drops the aim by 10*tan(tilt_deg); compensate on the camera Z)
    tilt_deg = 85.0
    standoff = 10.0
    cam.location = (0, -standoff, 0.85 + standoff * math.tan(math.radians(90 - tilt_deg)))
    cam.rotation_euler = (math.radians(tilt_deg), 0, 0)
    scene.camera = cam

    # --- pixel-art render settings: low res, transparent, no filtering / AA ---
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

    # --- creature on a pivot at the feet (so squash scales about the ground line) ---
    pivot = bpy.data.objects.new('pivot', None)
    scene.collection.objects.link(pivot)
    for o in objs:
        o.parent = pivot

    anim = ANIM[creature]
    manifest = []
    for col, dname in enumerate(DIRS):
        for row in range(frames):
            sz, sxy, wob = anim[row % len(anim)]
            pivot.scale = (sxy, sxy, sz)
            pivot.rotation_euler = (0, 0, math.radians(DIR_ROT[dname] + wob))
            path = os.path.join(rawdir, f'{dname}_{row}.png')
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            manifest.append(path)
            print(f'RENDERED {dname} frame {row} -> {path}')

    manifest_path = os.path.join(outdir, 'raw', args['name'] + '.json')
    with open(manifest_path, 'w') as f:
        json.dump({'creature': creature, 'size': size, 'frames': frames,
                   'dirs': DIRS, 'files': manifest}, f)

    # --- hand off to the system python (has PIL) for posterise + outline + assembly ---
    script = os.path.abspath(__file__)
    cmd = [args['pypost'], script, '--', '--post', '--creature', creature, '--name', args['name'],
           '--outdir', outdir, '--size', str(size), '--frames', str(frames)]
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


def post_process(args):
    from PIL import Image
    creature = args['creature']
    size = int(args['size'])
    frames = int(args['frames'])
    outdir = os.path.abspath(args['outdir'])
    rawdir = os.path.join(outdir, 'raw', args['name'])
    palette = PALETTES[creature]
    step = size // 16
    assert step >= 1 and step * 16 == size, 'render size must be an integer multiple of 16'

    def one_frame(path):
        im = Image.open(path).convert('RGBA')
        # 1-bit alpha, then integer NEAREST downscale to 16x16
        px = im.load()
        for y in range(size):
            for x in range(size):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 255 if a >= 128 else 0)
        im = im.resize((16, 16), Image.NEAREST)
        # posterise to the small fixed palette (transparent pixels untouched)
        p = im.load()
        for y in range(16):
            for x in range(16):
                r, g, b, a = p[x, y]
                if a:
                    p[x, y] = _nearest((r, g, b), palette) + (255,)
        return im

    # --- build all 16 frames, then align each direction on a common ground line ---
    cells = {}
    for col, dname in enumerate(DIRS):
        for row in range(frames):
            cells[(col, row)] = one_frame(os.path.join(rawdir, f'{dname}_{row}.png'))

    # a direction's baseline = lowest content bottom across its frames; the rest keep
    # their relative offset so the squash/stretch animation survives grounding.
    baseline = {}
    for col in range(4):
        bottoms = []
        for row in range(frames):
            bb = cells[(col, row)].getbbox()
            if bb:
                bottoms.append(bb[3])
        baseline[col] = max(bottoms) if bottoms else 16

    sheet = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    for col in range(4):
        for row in range(frames):
            cell = cells[(col, row)]
            bb = cell.getbbox()
            aligned = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
            if bb:
                crop = cell.crop(bb)
                x = (16 - crop.width) // 2
                y = 14 - baseline[col] + bb[1]          # content bottom -> y=14 for the baseline frame
                aligned.paste(crop, (x, y))
            # 1px dark outline on the silhouette (systems/heroArt.js OUTLINE)
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


# --------------------------------------------------------------------------- main
def main():
    args = parse_args(sys.argv)
    if IN_BLENDER and not args['post']:
        rc = render_creature(args)
        sys.exit(rc)
    if not IN_BLENDER and args['post']:
        post_process(args)
        return
    # plain system-python invocation without --post: assume post step (convenience)
    post_process(args)


if __name__ == '__main__':
    main()
