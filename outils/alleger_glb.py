# Allège un modèle Tripo pour le site : réduit le maillage, rétrécit les
# textures, exporte en glb Draco + JPEG (lisible par tous les téléphones).
#
#   "/Volumes/MUSIQUE/Logiciel🚀/Blender.app/Contents/MacOS/Blender" -b --factory-startup \
#     -P outils/alleger_glb.py -- <entree.glb> <sortie.glb> [triangles=20000] [texture=1024]
import bpy, sys

args = sys.argv[sys.argv.index('--') + 1:]
entree, sortie = args[0], args[1]
cible = int(args[2]) if len(args) > 2 else 20000
cote = int(args[3]) if len(args) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=entree)

maillages = [o for o in bpy.context.scene.objects if o.type == 'MESH']
total = sum(len(o.data.polygons) for o in maillages)
print(f'[alleger] {len(maillages)} maillage(s), {total} faces')
for o in maillages:
    faces = len(o.data.polygons)
    if faces > cible:
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new('reduire', 'DECIMATE')
        m.ratio = cible / total
        bpy.ops.object.modifier_apply(modifier=m.name)
    print(f'[alleger] {o.name}: {faces} -> {len(o.data.polygons)} faces')

for img in bpy.data.images:
    if img.size[0] > cote or img.size[1] > cote:
        k = cote / max(img.size)
        img.scale(max(1, round(img.size[0] * k)), max(1, round(img.size[1] * k)))
        print(f'[alleger] texture {img.name} -> {img.size[0]}x{img.size[1]}')

bpy.ops.export_scene.gltf(filepath=sortie, export_format='GLB',
    export_image_format='JPEG', export_jpeg_quality=82,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_animations=False)
print('[alleger] ecrit', sortie)
