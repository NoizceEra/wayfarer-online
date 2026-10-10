#!/usr/bin/env python3
"""Bake a Blender creature into a Wayfarer-Online monster sheet AND a matching
normal-map sheet (for Phaser's Light2D pipeline).

This is the normal-map companion to tools/blender_bake_monster_sheet.py. It reuses
the SAME creature builders, camera, ortho scale, animation and style post-pass, so
the colour sheet it emits is stylistically identical to the existing custom-monster
sheets. The only addition is a second render pass per frame that writes the
camera-space surface normal as an RGB image (the normal map).

Why camera-space normals: Phaser's Light2D fragment shader (Light.frag) does
    normal = normalize(uInverseRotationMatrix * (normalMap.rgb * 2.0 - 1.0))
i.e. it expects a tangent/view-space normal where R = screen-right, G = screen-up,
B = toward the viewer. Rendering the Blender Geometry normal transformed WORLD->CAMERA
and encoded as (n * 0.5 + 0.5) gives exactly that. The normal pass uses a Raw view
transform so the encoding is not sRGB-shifted.

Outputs (both 64x64, 4x4 grid of 16x16 frames, frame-aligned):
  <name>.png     colour sprite sheet  (posterised + 1px outline, like the game)
  <name>_n.png   normal map sheet     (same silhouette + outline footprint)

Blender lives at: D:/tools/blender-4.5.14-windows-x64/blender.exe (4.5.14 LTS).
Run (one command produces both sheets):
  "D:/tools/blender-4.5.14-windows-x64/blender.exe" --background \\
      --python tools/blender_bake_normalmap.py -- \\
      --creature gemgolem --outdir .scratch-blender/nlspike --name gemgolem \\
      --dest public/assets/custom/nlspike

Blender's bundled python has numpy but NOT PIL, so the script runs in two modes:
under Blender it renders + shells out to the system python for the post-pass.
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

OUTLINE = (0x14, 0x1b, 0x1b)
NEUTRAL_NORMAL = (128, 128, 255)  # flat surface facing the viewer

# Same palettes as blender_bake_monster_sheet.py (Ninja-Adventure master palette).
PALETTES = {
    'gemgolem': [
        OUTLINE, (0x3b, 0x36, 0x43), (0x4e, 0x48, 0x4a), (0x5f, 0x71, 0x60),
        (0x9b, 0xa7, 0xaa), (0x54, 0x3c, 0x52), (0x8f, 0x3e, 0x56),
        (0x79, 0xb8, 0xce), (0xe3, 0xf1, 0xf5),
    ],
    'emberling': [
        OUTLINE, (0x3b, 0x36, 0x43), (0x4e, 0x48, 0x4a), (0x8f, 0x3e, 0x56),
        (0xe0, 0x39, 0x4c), (0xe4, 0x6d, 0x3a), (0xef, 0x91, 0x4f),
        (0xff, 0xad, 0x5d), (0xfc, 0xe2, 0xca),
    ],
}
ANIM = {
    'gemgolem':  [(1.00, 1.00, 0.0), (0.90, 1.07, 0.0), (1.00, 1.00, 0.0), (1.09, 0.95, 0.0)],
    'emberling': [(1.00, 1.00, 0.0), (1.12, 0.93, 5.0), (1.00, 1.00, 0.0), (0.88, 1.08, -5.0)],
}


def parse_args(argv):
    a = argv[argv.index('--') + 1:] if '--' in argv else []
    out = {'creature': 'gemgolem', 'outdir': '.scratch-blender/nlspike', 'name': None,
           'dest': 'public/assets/custom/nlspike',
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
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    _set_in(bsdf, ['Base Color'], (rgb[0], rgb[1], rgb[2], 1.0))
    _set_in(bsdf, ['Roughness'], 0.95)
    _set_in(bsdf, ['Metallic'], 0.0)
    _set_in(bsdf, ['Specular IOR Level', 'Specular'], 0.0)
    return mat


def normal_material(name, tilt_deg):
    """Emits the camera-space normal encoded as RGB (n*0.5+0.5), unlit.

    The camera is a pure X-rotation of `tilt_deg`, so world->camera is Rx(-tilt).
    (Blender's VectorTransform 'CAMERA' target uses a Z-flipped convention that
    makes a camera-facing surface encode as B=0; a VectorRotate about X is correct
    and was verified against a known-normal plane - see the calibration note above.)
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emis = nt.nodes.new('ShaderNodeEmission')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    vr = nt.nodes.new('ShaderNodeVectorRotate')
    vr.rotation_type = 'X_AXIS'
    vr.inputs['Angle'].default_value = math.radians(-tilt_deg)
    mad = nt.nodes.new('ShaderNodeVectorMath')
    mad.operation = 'MULTIPLY_ADD'
    mad.inputs[1].default_value = (0.5, 0.5, 0.5)
    mad.inputs[2].default_value = (0.5, 0.5, 0.5)
    nt.links.new(geo.outputs['Normal'], vr.inputs[0])
    nt.links.new(vr.outputs['Vector'], mad.inputs[0])
    nt.links.new(mad.outputs['Vector'], emis.inputs['Color'])
    emis.inputs['Strength'].default_value = 1.0
    nt.links.new(emis.outputs['Emission'], out.inputs['Surface'])
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
    stone = flat_material('stone', (0.34, 0.40, 0.40))
    crystal = flat_material('crystal', (0.42, 0.24, 0.46))
    glow = flat_material('glow', (0.85, 0.96, 1.0))
    objs = []
    for sx in (-1, 1):
        objs.append(_add(_cube(1.0, (sx * 0.21, 0.0, 0.15), (0.20, 0.24, 0.30)), stone))
        objs.append(_add(_cube(1.0, (sx * 0.52, 0.0, 1.02), (0.26, 0.24, 0.22)), stone))
        objs.append(_add(_cube(1.0, (sx * 0.68, 0.0, 0.72), (0.16, 0.16, 0.46)), stone))
        objs.append(_add(_cube(0.11, (sx * 0.10, -0.19, 1.36), (1, 1, 1)), glow))
    objs.append(_add(_ico(1, 0.46, (0, 0, 0.80), (1.06, 0.80, 1.02)), stone))
    objs.append(_add(_ico(0, 0.25, (0, 0, 1.34), (1.0, 0.92, 1.0)), stone))
    objs.append(_add(_cone(5, 0.15, 0.44, (0.0, 0.06, 1.50), (math.radians(-10), 0, 0)), crystal))
    for sx in (-1, 1):
        objs.append(_add(_cone(5, 0.11, 0.36, (sx * 0.40, 0.14, 1.16),
                               (math.radians(-20), math.radians(sx * 22), 0)), crystal))
    objs.append(_add(_ico(0, 0.15, (0.0, -0.40, 0.86), (1.0, 0.7, 1.1)), crystal))
    return objs


def build_emberling():
    char = flat_material('char', (0.14, 0.13, 0.16))
    magma = flat_material('magma', (0.92, 0.34, 0.12))
    glow = flat_material('glow', (1.0, 0.84, 0.42))
    objs = []
    objs.append(_add(_ico(1, 0.48, (0, 0, 0.60), (1.02, 0.9, 1.06)), char))
    objs.append(_add(_ico(1, 0.34, (0, -0.18, 0.54), (1.0, 0.72, 1.0)), magma))
    objs.append(_add(_ico(0, 0.26, (0, 0, 1.12), (1.0, 0.92, 1.0)), char))
    for sx in (-1, 1):
        objs.append(_add(_cube(0.11, (sx * 0.10, -0.21, 1.16), (1, 1, 1)), glow))
        objs.append(_add(_cube(1.0, (sx * 0.22, 0.0, 0.09), (0.17, 0.21, 0.20)), char))
        objs.append(_add(_cone(5, 0.11, 0.40, (sx * 0.42, 0.06, 0.92),
                               (0, math.radians(sx * 62), 0)), magma))
    objs.append(_add(_cone(5, 0.12, 0.36, (0.0, 0.02, 1.40), (math.radians(-14), 0, 0)), magma))
    objs.append(_add(_cone(5, 0.12, 0.40, (0.0, 0.26, 0.80), (math.radians(-70), 0, 0)), magma))
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

    bpy.ops.object.light_add(type='SUN', location=(-2.5, -3.0, 4.5))
    bpy.context.active_object.data.energy = 3.2
    bpy.context.active_object.data.angle = 0.0
    bpy.ops.object.light_add(type='SUN', location=(3.0, 2.0, 2.0))
    bpy.context.active_object.data.energy = 1.1
    world = bpy.data.worlds.new('W')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.30, 0.33, 0.40, 1.0)
    bg.inputs[1].default_value = 0.35

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
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    try:
        scene.eevee.taa_render_samples = 1
    except Exception:
        pass

    # colour pass: Standard (no filmic wash); normal pass: Raw (identity encode)
    COLOR_XFORM = 'Standard'
    try:
        scene.view_settings.view_transform = 'Raw'
        NORMAL_XFORM = 'Raw'
    except Exception:
        NORMAL_XFORM = 'Standard'

    pivot = bpy.data.objects.new('pivot', None)
    scene.collection.objects.link(pivot)
    for o in objs:
        o.parent = pivot

    nmat = normal_material('NL_normal', tilt_deg)
    anim = ANIM[creature]
    manifest = []
    for col, dname in enumerate(DIRS):
        for row in range(frames):
            sz, sxy, wob = anim[row % len(anim)]
            pivot.scale = (sxy, sxy, sz)
            pivot.rotation_euler = (0, 0, math.radians(DIR_ROT[dname] + wob))

            # ---- colour pass ----
            scene.view_settings.view_transform = COLOR_XFORM
            cpath = os.path.join(rawdir, f'color_{dname}_{row}.png')
            scene.render.filepath = cpath
            bpy.ops.render.render(write_still=True)

            # ---- normal pass: swap in the normal material, restore after ----
            scene.view_settings.view_transform = NORMAL_XFORM
            saved = []
            for o in objs:
                saved.append([m for m in o.data.materials])
                o.data.materials.clear()
                o.data.materials.append(nmat)
            npath = os.path.join(rawdir, f'normal_{dname}_{row}.png')
            scene.render.filepath = npath
            bpy.ops.render.render(write_still=True)
            for o, mats in zip(objs, saved):
                o.data.materials.clear()
                for m in mats:
                    o.data.materials.append(m)

            manifest.append({'dir': dname, 'row': row, 'color': cpath, 'normal': npath})
            print(f'RENDERED {dname} {row} -> {cpath} + {npath}')

    with open(os.path.join(outdir, 'raw', args['name'] + '.json'), 'w') as f:
        json.dump({'creature': creature, 'size': size, 'frames': frames,
                   'dirs': DIRS, 'frames_manifest': manifest}, f)

    script = os.path.abspath(__file__)
    cmd = [args['pypost'], script, '--', '--post', '--creature', creature, '--name', args['name'],
           '--outdir', outdir, '--size', str(size), '--frames', str(frames), '--dest', args['dest']]
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
    dest = os.path.abspath(args['dest'])
    os.makedirs(dest, exist_ok=True)
    palette = PALETTES[creature]
    step = size // 16
    assert step >= 1 and step * 16 == size, 'render size must be an integer multiple of 16'

    def load16(path, posterise):
        im = Image.open(path).convert('RGBA')
        px = im.load()
        for y in range(size):
            for x in range(size):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 255 if a >= 128 else 0)
        im = im.resize((16, 16), Image.NEAREST)
        p = im.load()
        if posterise:
            for y in range(16):
                for x in range(16):
                    r, g, b, a = p[x, y]
                    if a:
                        p[x, y] = _nearest((r, g, b), palette) + (255,)
        return im

    # --- pass 1: build 16x16 colour + normal cells ---
    col_cells, nrm_cells = {}, {}
    for col, dname in enumerate(DIRS):
        for row in range(frames):
            col_cells[(col, row)] = load16(os.path.join(rawdir, f'color_{dname}_{row}.png'), True)
            nrm_cells[(col, row)] = load16(os.path.join(rawdir, f'normal_{dname}_{row}.png'), False)

    # --- per-direction ground baseline (identical to the colour-sheet bake) ---
    baseline = {}
    for col in range(4):
        bottoms = []
        for row in range(frames):
            bb = col_cells[(col, row)].getbbox()
            if bb:
                bottoms.append(bb[3])
        baseline[col] = max(bottoms) if bottoms else 16

    sheet = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    nsheet = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    for col in range(4):
        for row in range(frames):
            cell = col_cells[(col, row)]
            bb = cell.getbbox()
            aligned = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
            naligned = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
            if bb:
                crop = cell.crop(bb)
                x_off = (16 - crop.width) // 2
                y_off = 14 - baseline[col] + bb[1]
                aligned.paste(crop, (x_off, y_off))

                # shift the normal cell by the SAME delta the colour content moved
                dx = x_off - bb[0]
                dy = y_off - bb[1]
                np_ = nrm_cells[(col, row)].load()
                na = naligned.load()
                for y in range(16):
                    for x in range(16):
                        sx, sy = x - dx, y - dy
                        if 0 <= sx < 16 and 0 <= sy < 16:
                            na[x, y] = np_[sx, sy]

            # 1px dark outline on the silhouette; matching neutral normal on those px
            src = aligned.copy()
            sp = src.load()
            ap = aligned.load()
            nap = naligned.load()
            for y in range(16):
                for x in range(16):
                    if sp[x, y][3]:
                        continue
                    edge = False
                    for ddx, ddy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + ddx, y + ddy
                        if 0 <= nx < 16 and 0 <= ny < 16 and sp[nx, ny][3]:
                            edge = True
                            break
                    if edge:
                        ap[x, y] = OUTLINE + (255,)
                        nap[x, y] = NEUTRAL_NORMAL + (255,)

            # normal alpha follows the final colour silhouette exactly (incl. outline)
            for y in range(16):
                for x in range(16):
                    if ap[x, y][3]:
                        r, g, b, _ = nap[x, y]
                        nap[x, y] = (r, g, b, 255)
                    else:
                        nap[x, y] = (0, 0, 0, 0)

            sheet.paste(aligned, (col * 16, row * 16))
            nsheet.paste(naligned, (col * 16, row * 16))

    sprite_path = os.path.join(dest, args['name'] + '.png')
    normal_path = os.path.join(dest, args['name'] + '_n.png')
    sheet.save(sprite_path, format='PNG')
    # Phaser quirk (3.90): the sprite image is uploaded with UNPACK_FLIP_Y_WEBGL=true,
    # but a normal-map dataSource is not — Texture.setDataSource() builds its
    # TextureSource without a flipY argument and TextureSource defaults flipY=false.
    # The result is a vertically mirrored normal map, so the sheet is stored Y-flipped
    # here to line up with the sprite texture. Verified in-engine against controlled
    # uniform-UP and top/bottom-split normal maps.
    nsheet.transpose(Image.FLIP_TOP_BOTTOM).save(normal_path, format='PNG')
    print('SHEET=' + sprite_path + ' size=' + str(sheet.size))
    print('NORMAL=' + normal_path + ' size=' + str(nsheet.size) + ' (stored Y-flipped for Phaser Light2D)')


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
