# Headless Blender demo: render a 3D model from 8 compass directions into a
# pixel-art sprite strip. This is the classic way 3D helps a 2D game - you model
# and light once, then bake consistent frames, instead of hand-drawing 8 facings.
#
#
# Blender lives at: D:/tools/blender-4.5.14-windows-x64/blender.exe (4.5.14 LTS,
# portable ZIP install - no admin, deliberately on D: so C: stays clear).
# Invoke headless:  "D:/tools/blender-4.5.14-windows-x64/blender.exe" --background \n#                     --python tools/blender_bake_directions.py -- <outdir>
#
# Run:  blender.exe --background --python this.py -- <outdir>
import bpy, sys, os, math

argv = sys.argv
outdir = argv[argv.index('--') + 1] if '--' in argv else 'D:/tools/blender_demo'
os.makedirs(outdir, exist_ok=True)

# --- clean slate -------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- a small "gem" made of real geometry ------------------------------------
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, 0))
gem = bpy.context.active_object
# squash + faceted so it reads as a low-poly crystal at 64px
gem.scale = (0.75, 0.75, 1.15)
gem.rotation_euler = (math.radians(12), 0, 0)

mat = bpy.data.materials.new('gem')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.08, 0.95, 0.58, 1)   # Solana green #14F195
bsdf.inputs['Metallic'].default_value = 0.3
bsdf.inputs['Roughness'].default_value = 0.25
gem.data.materials.append(mat)

# --- a base plinth so the silhouette has weight ------------------------------
bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, -1.25))
base = bpy.context.active_object
base.scale = (0.55, 0.55, 0.18)
bm = bpy.data.materials.new('base')
bm.use_nodes = True
bm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.06, 0.05, 0.10, 1)
base.data.materials.append(bm)

# --- light + orthographic camera (ortho keeps all 8 facings the same scale) ---
bpy.ops.object.light_add(type='SUN', location=(2, -3, 4))
bpy.context.active_object.data.energy = 4.0
bpy.ops.object.light_add(type='SUN', location=(-3, 2, 2))
bpy.context.active_object.data.energy = 1.6

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 3.4
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
cam.location = (0, -8, 1.0)
cam.rotation_euler = (math.radians(83), 0, 0)
scene.camera = cam

# --- pixel-art render settings: low res, transparent, NO filtering -----------
scene.render.resolution_x = 64
scene.render.resolution_y = 64
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'   # no filmic curve on flat pixel art

# --- bake 8 compass facings --------------------------------------------------
pivot = bpy.data.objects.new('pivot', None)
scene.collection.objects.link(pivot)
for o in (gem, base):
    o.parent = pivot

DIRS = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
paths = []
for i, name in enumerate(DIRS):
    pivot.rotation_euler = (0, 0, math.radians(i * 45))
    scene.render.filepath = os.path.join(outdir, f'gem_{i}_{name}.png')
    bpy.ops.render.render(write_still=True)
    paths.append(scene.render.filepath)

print('RENDERED_DIRS=' + ','.join(DIRS))
print('RENDERED_FILES=' + ';'.join(paths))
print('OUTDIR=' + outdir)
