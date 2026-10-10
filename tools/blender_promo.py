#!/usr/bin/env python3
"""Wayfarer Online - promo render suite (headless Blender).

Renders the game's "wayfarer" compass-rose emblem as polished 2D marketing
images: a wide banner, a square avatar/OG tile, a transparent hero shot of the
emblem on a plinth, and a transparent set of the game's crystals.

Blender lives at: D:/tools/blender-4.5.14-windows-x64/blender.exe (4.5.14 LTS).

Run:
  "D:/tools/blender-4.5.14-windows-x64/blender.exe" --background \
      --python tools/blender_promo.py -- <outdir>

Fast draft (1/4 res, 16 samples) for composition checks:
  PROMO_QUICK=1 "D:/tools/.../blender.exe" --background \
      --python tools/blender_promo.py -- <outdir>

Design notes
------------
* Emblem = 4 long cardinal arms (Solana green #14F195) + 4 short diagonal arms
  (purple #9945FF) + cyan hub #03E1FF with a white #E1E8F0 core, matching the
  in-game 8-point compass rose used by the PWA icons (tools/make_pwa_icons.py).
* Arms are 4-sided pyramids (crystalline needles, flat-shaded) so the mark reads
  as faceted 3D rather than a flat logo.
* Emissive materials + a Cycles FOG_GLOW glare pass give the neon look; the
  backdrop is an emission plane carrying a spherical gradient so the emblem sits
  in a soft pool of light instead of on flat navy.
* Chosen look: clean high-resolution 3D render (NOT 1px-outline pixel art). The
  in-game art is pixel art, but a promo banner/OG image is viewed at large sizes
  on the web where a crisp render with real speculars and glow sells better; the
  palette and the mark itself stay 1:1 with the game.
"""
import bpy
import math
import os
import sys

from mathutils import Vector

argv = sys.argv
outdir = argv[argv.index('--') + 1] if '--' in argv else 'D:/tools/blender_promo_out'
QUICK = os.environ.get('PROMO_QUICK', '') == '1'
os.makedirs(outdir, exist_ok=True)

ELEV = 20.0  # camera elevation above the subject, degrees

# --------------------------------------------------------------------------- #
# palette (sRGB hex -> linear, which is what Blender's shader inputs expect)
# --------------------------------------------------------------------------- #
def _s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    h = h.lstrip('#')
    return tuple(_s2l(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


GREEN = hexlin('14F195')   # Solana green  - cardinal arms
PURPLE = hexlin('9945FF')  # purple        - diagonal arms
CYAN = hexlin('03E1FF')    # cyan          - hub
WHITE = hexlin('E1E8F0')   # off-white     - core spark / wordmark
NAVY = hexlin('0A0E1A')    # deep navy     - background
NAVY_HI = hexlin('16203C') # lifted navy   - gradient centre
NAVY_LO = hexlin('04060C') # near-black    - gradient edge
STEEL = hexlin('6B7A99')   # muted steel   - plinth


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def emissive_mat(name, color, strength=1.1, rough=0.20, metal=0.30):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    set_input(b, ['Base Color'], (*color, 1.0))
    set_input(b, ['Metallic'], metal)
    set_input(b, ['Roughness'], rough)
    set_input(b, ['Emission Color', 'Emission'], (*color, 1.0))
    set_input(b, ['Emission Strength'], strength)
    return m


def plinth_mat():
    m = bpy.data.materials.new('plinth')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    set_input(b, ['Base Color'], (*STEEL, 1.0))
    set_input(b, ['Metallic'], 0.55)
    set_input(b, ['Roughness'], 0.40)
    return m


def make_mats():
    return {
        'green': emissive_mat('m_green', GREEN, 0.45),
        'purple': emissive_mat('m_purple', PURPLE, 0.45),
        'cyan': emissive_mat('m_cyan', CYAN, 0.60),
        'white': emissive_mat('m_white', WHITE, 1.00),
        'plinth': plinth_mat(),
    }


def parent_to(objs, loc):
    """Group objects under an empty so the whole cluster can be positioned."""
    empty = bpy.data.objects.new('cluster', None)
    bpy.context.scene.collection.objects.link(empty)
    for o in objs:
        o.parent = empty
    empty.location = loc
    return empty


# --------------------------------------------------------------------------- #
# geometry: the emblem
# --------------------------------------------------------------------------- #
def add_needle(angle_deg, length, half_w, thick, mat):
    """One 4-sided pyramid arm, pointing radially outward in the XZ plane."""
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=1.0, radius2=0.0, depth=1.0)
    o = bpy.context.active_object
    a = math.radians(angle_deg)
    o.scale = (half_w, thick, length)
    o.rotation_euler = (0.0, math.radians(90.0 - angle_deg), 0.0)
    off = length * 0.5 - 0.10          # base just past the centre, hub hides the seam
    o.location = (math.cos(a) * off, 0.0, math.sin(a) * off)
    o.data.materials.append(mat)
    bpy.ops.object.shade_flat()
    return o


def build_emblem(scale=1.0):
    """8-point wayfarer compass rose, centred on the origin, facing -Y."""
    mats = make_mats()
    objs = []
    for ang in (0, 90, 180, 270):                                   # long cardinal -> green
        objs.append(add_needle(ang, 2.60 * scale, 0.38 * scale, 0.44 * scale, mats['green']))
    for ang in (45, 135, 225, 315):                                 # short diagonal -> purple
        objs.append(add_needle(ang, 1.72 * scale, 0.27 * scale, 0.32 * scale, mats['purple']))

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.62 * scale, segments=40,
                                         ring_count=20, location=(0, 0, 0))
    hub = bpy.context.active_object
    hub.data.materials.append(mats['cyan'])
    bpy.ops.object.shade_smooth()
    objs.append(hub)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.30 * scale, segments=28,
                                         ring_count=14, location=(0, -0.36 * scale, 0))
    core = bpy.context.active_object
    core.data.materials.append(mats['white'])
    bpy.ops.object.shade_smooth()
    objs.append(core)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.98 * scale, minor_radius=0.055 * scale,
                                     major_segments=72, minor_segments=14,
                                     location=(0, 0, 0), rotation=(math.radians(90), 0, 0))
    ring = bpy.context.active_object
    ring.data.materials.append(mats['cyan'])
    bpy.ops.object.shade_smooth()
    objs.append(ring)
    return objs, mats


def add_plinth(radius=1.5, depth=0.8, z=-1.5, mats=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=depth,
                                        location=(0, 0, z))
    p = bpy.context.active_object
    p.data.materials.append(mats['plinth'])
    bpy.ops.object.shade_flat()
    objs = [p]
    top = z + depth * 0.5
    # flat (XY-plane) inlay ring on the plinth top -- a vertical hoop here would
    # pass straight through the solid and poke out below the base
    bpy.ops.mesh.primitive_torus_add(major_radius=radius * 0.70, minor_radius=0.045,
                                     major_segments=64, minor_segments=12,
                                     location=(0, 0, top + 0.035),
                                     rotation=(0, 0, 0))
    r = bpy.context.active_object
    r.data.materials.append(mats['cyan'])
    bpy.ops.object.shade_smooth()
    objs.append(r)
    return objs, top


def add_crystals(mats):
    """A loose cluster of faceted crystals resting on a hex plinth."""
    plinth_objs, top = add_plinth(radius=1.75, depth=0.55, z=-1.45, mats=mats)
    spec = [
        (-0.98, -0.15, 0.30, 'purple', 14),
        (-0.42,  0.30, 0.44, 'green', -9),
        ( 0.18, -0.35, 0.72, 'purple', 7),
        ( 0.86,  0.05, 0.34, 'green', -13),
        ( 0.40,  0.45, 0.26, 'cyan', 20),
        (-0.66,  0.55, 0.22, 'cyan', -6),
        (-0.05,  0.05, 0.50, 'cyan', 11),
    ]
    objs = list(plinth_objs)
    for x, y, r, col, rot in spec:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=(0, 0, 0))
        c = bpy.context.active_object
        c.scale = (0.70, 0.70, 1.55)
        c.rotation_euler = (math.radians(rot * 0.5), math.radians(rot), math.radians(rot * 0.3))
        c.location = (x, y, top + r * 1.55 * 0.90)
        c.data.materials.append(mats[col])
        bpy.ops.object.shade_flat()
        objs.append(c)
    return objs, top


def add_text(body, size, loc, mat, spacing=1.0, extrude=0.05, bevel=0.006):
    bpy.ops.object.text_add(location=loc)
    t = bpy.context.active_object
    t.data.body = body
    t.data.size = size
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    t.data.space_character = spacing
    t.data.extrude = extrude
    t.data.bevel_depth = bevel
    t.rotation_euler = (math.radians(90), 0, 0)   # text faces -Y (the camera)
    t.data.materials.append(mat)
    bpy.context.view_layer.update()
    print('TEXT %s dims=(%.3f, %.3f, %.3f)' % (body, *t.dimensions))
    return t


# --------------------------------------------------------------------------- #
# scene furniture
# --------------------------------------------------------------------------- #
def add_backdrop(center=(0.0, 0.0), y=7.0, size=60.0):
    """Big emission plane standing BEHIND the subject, with a spherical gradient
    -> a soft pool of light. The 90 deg X rotation is essential: primitive_plane_add
    builds an XY (horizontal) plane, which would act as a floor at z=0 and occlude
    everything below it."""
    bpy.ops.mesh.primitive_plane_add(size=size, location=(center[0], y, center[1]),
                                     rotation=(math.radians(90), 0, 0))
    plane = bpy.context.active_object
    m = bpy.data.materials.new('backdrop')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emis = nt.nodes.new('ShaderNodeEmission')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'SPHERICAL'
    mapn = nt.nodes.new('ShaderNodeMapping')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mapn.inputs['Location'].default_value = (-0.5, -0.5, 0.0)
    mapn.inputs['Scale'].default_value = (1.45, 1.45, 1.0)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*NAVY_LO, 1.0)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (*NAVY_HI, 1.0)
    emis.inputs['Strength'].default_value = 1.0
    nt.links.new(tc.outputs['Generated'], mapn.inputs['Vector'])
    nt.links.new(mapn.outputs['Vector'], grad.inputs['Vector'])
    nt.links.new(grad.outputs['Color'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], emis.inputs['Color'])
    nt.links.new(emis.outputs['Emission'], out.inputs['Surface'])
    plane.data.materials.append(m)
    return plane


def add_lights():
    key = bpy.data.lights.new('key', 'SUN')
    key.energy = 3.5
    ko = bpy.data.objects.new('key', key)
    ko.rotation_euler = (math.radians(52), 0, math.radians(-38))
    bpy.context.scene.collection.objects.link(ko)

    rim = bpy.data.lights.new('rim', 'SUN')
    rim.energy = 2.6
    rim.color = (0.35, 0.75, 1.0)
    ro = bpy.data.objects.new('rim', rim)
    ro.rotation_euler = (math.radians(74), 0, math.radians(160))
    bpy.context.scene.collection.objects.link(ro)

    fill = bpy.data.lights.new('fill', 'SUN')
    fill.energy = 1.2
    fill.color = (0.85, 0.6, 1.0)
    fo = bpy.data.objects.new('fill', fill)
    fo.rotation_euler = (math.radians(105), 0, math.radians(40))
    bpy.context.scene.collection.objects.link(fo)

    # soft overhead area light -> real contact shadows that ground the emblem on
    # the plinth and the crystals on their base (a 3-point sun rig alone throws
    # those shadows off to the side, out of frame)
    top = bpy.data.lights.new('top', 'AREA')
    top.energy = 1800.0
    top.size = 5.0
    to = bpy.data.objects.new('top', top)
    to.location = (0.0, 0.0, 8.0)
    bpy.context.scene.collection.objects.link(to)


def setup_world(strength=0.30):
    world = bpy.data.worlds.new('w')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*NAVY, 1.0)
    bg.inputs['Strength'].default_value = strength


def setup_camera(ortho_scale, target=(0.0, 0.0), elev_deg=ELEV, dist=18.0):
    th = math.radians(90.0 - elev_deg)
    vy, vz = math.sin(th), -math.cos(th)
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = ortho_scale
    cam_data.clip_start = 0.01
    cam_data.clip_end = 200.0
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (target[0], -vy * dist, target[1] - vz * dist)
    cam.rotation_euler = (th, 0, 0)
    bpy.context.scene.camera = cam
    return cam


def setup_render(res_x, res_y, samples, transparent):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.01
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 4
    sc.render.resolution_x = res_x
    sc.render.resolution_y = res_y
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.compression = 15
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'


def add_glare(threshold=1.0, size=7, mix=-0.55):
    sc = bpy.context.scene
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new('CompositorNodeRLayers')
    gl = nt.nodes.new('CompositorNodeGlare')
    cp = nt.nodes.new('CompositorNodeComposite')
    gl.glare_type = 'FOG_GLOW'
    gl.quality = 'HIGH'
    gl.threshold = threshold
    gl.size = size
    gl.mix = mix
    nt.links.new(rl.outputs['Image'], gl.inputs['Image'])
    nt.links.new(gl.outputs['Image'], cp.inputs['Image'])


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def render_to(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('WROTE ' + path)


def dims(w, h):
    return (max(1, w // 4), max(1, h // 4)) if QUICK else (w, h)


def samples(n):
    return 16 if QUICK else n


def frame_scene(aspect, margin=0.88, elev_deg=ELEV, exclude=('backdrop',)):
    """Measure the real world bounding box of every subject object in the scene
    and turn it into (ortho_scale, (target_x, target_z)).

    The camera is tilted up by `elev_deg`, so a point's vertical position in the
    frame is sin(elev)*y + cos(elev)*z -- depth toward the camera pushes content
    DOWN. Hand-writing a bbox is a trap (max-y of one object combined with
    max-z of another is not a real point), so measure the actual geometry.
    """
    bpy.context.view_layer.update()
    s = math.sin(math.radians(elev_deg))
    c = math.cos(math.radians(elev_deg))
    xs, vs = [], []
    for o in bpy.context.scene.objects:
        if o.type not in ('MESH', 'FONT') or o.name in exclude or o.data is None:
            continue
        for corner in o.bound_box:
            p = o.matrix_world @ Vector(corner)
            xs.append(p.x)
            vs.append(s * p.y + c * p.z)
    if not xs:
        return 4.0, (0.0, 0.0)
    cw = max(1e-6, max(xs) - min(xs))
    ch = max(1e-6, max(vs) - min(vs))
    ortho = max(cw / margin, (ch / margin) * aspect)
    tx = (min(xs) + max(xs)) * 0.5
    tz = (min(vs) + max(vs)) * 0.5 / c
    return ortho, (tx, tz)


# --------------------------------------------------------------------------- #
# the four deliverables
# --------------------------------------------------------------------------- #
def render_banner(W=1920, H=640):
    fresh()
    setup_world(0.45)
    add_lights()
    objs, mats = build_emblem(scale=0.34)
    R = 0.34 * 2.60                                   # emblem outer radius
    txt = add_text('WAYFARER', 0.66, (1.35, 0.0, 0.26), mats['white'], spacing=1.02)
    onl = add_text('ONLINE', 0.32, (1.35, 0.0, -0.44), mats['green'], spacing=1.70)
    bar_z = -0.78
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(1.35, 0.0, bar_z))
    bar = bpy.context.active_object
    bar.scale = (max(0.50, onl.dimensions.x * 0.62), 0.012, 0.010)
    bar.data.materials.append(mats['green'])
    bpy.ops.object.shade_flat()

    text_half = max(0.60, txt.dimensions.x * 0.5)
    text_left = 1.35 - text_half
    em_cx = text_left - 0.40 - R
    parent_to(objs, (em_cx, 0.0, 0.0))
    ortho, target = frame_scene(W / H, margin=0.92)
    add_backdrop(center=(target[0], 0.0))
    setup_camera(ortho, target)
    setup_render(*dims(W, H), samples(160), transparent=False)
    add_glare()
    render_to(os.path.join(outdir, 'wayfarer_banner_%dx%d.png' % (W, H)))


def render_square(W=1024, H=1024):
    fresh()
    setup_world(0.45)
    add_lights()
    objs, mats = build_emblem(scale=0.50)
    R = 0.50 * 2.60
    em_cz = 0.55
    add_text('WAYFARER', 0.44, (0.0, 0.0, -1.05), mats['white'], spacing=1.02)
    add_text('ONLINE', 0.24, (0.0, 0.0, -1.50), mats['green'], spacing=1.70)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, -1.78))
    bar = bpy.context.active_object
    bar.scale = (0.52, 0.012, 0.010)
    bar.data.materials.append(mats['green'])
    bpy.ops.object.shade_flat()

    parent_to(objs, (0.0, 0.0, em_cz))
    ortho, target = frame_scene(W / H, margin=0.92)
    add_backdrop(center=(0.0, target[1]))
    setup_camera(ortho, target)
    setup_render(*dims(W, H), samples(160), transparent=False)
    add_glare()
    render_to(os.path.join(outdir, 'wayfarer_square_%d.png' % W))


def render_hero(W=1600, H=1600):
    fresh()
    setup_world(0.42)
    add_lights()
    mats = make_mats()
    objs, _ = build_emblem(scale=0.62)
    R = 0.62 * 2.60
    em_cz = 0.85
    parent_to(objs, (0.0, 0.0, em_cz))
    add_plinth(radius=1.90, depth=0.70, z=-1.50, mats=mats)
    ortho, target = frame_scene(W / H, margin=0.92)
    setup_camera(ortho, target)
    setup_render(*dims(W, H), samples(192), transparent=True)
    add_glare()
    render_to(os.path.join(outdir, 'wayfarer_hero_plinth_%d.png' % W))


def render_crystals(W=1600, H=1200):
    fresh()
    setup_world(0.45)
    add_lights()
    mats = make_mats()
    _, top = add_crystals(mats)
    ortho, target = frame_scene(W / H, margin=0.90)
    setup_camera(ortho, target)
    setup_render(*dims(W, H), samples(192), transparent=True)
    add_glare()
    render_to(os.path.join(outdir, 'wayfarer_crystals_%dx%d.png' % (W, H)))


def main():
    only = [s.strip() for s in os.environ.get('PROMO_ONLY', '').split(',') if s.strip()]
    jobs = {'banner': render_banner, 'square': render_square,
            'hero': render_hero, 'crystals': render_crystals}
    names = only if only else list(jobs)
    for n in names:
        jobs[n]()
    made = []
    for f in sorted(os.listdir(outdir)):
        if f.endswith('.png'):
            p = os.path.join(outdir, f)
            made.append('%s %d bytes' % (f, os.path.getsize(p)))
    print('QUICK=' + str(QUICK))
    print('OUTDIR=' + outdir)
    print('FILES=' + '; '.join(made))


if __name__ == '__main__':
    main()
