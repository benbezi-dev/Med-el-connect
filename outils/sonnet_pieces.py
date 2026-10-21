# Prépare le SONNET « en pièces » de Tripo (Generate in Parts, sans texture)
# pour la vue interactive : regroupe les 34 pièces par repère du schéma
# « SONNET Handling Overview », supprime les restes des traits de rappel,
# colore chaque groupe, allège, exporte en glb Draco.
#
#   "/Volumes/MUSIQUE/Logiciel🚀/Blender.app/Contents/MacOS/Blender" -b --factory-startup \
#     -P outils/sonnet_pieces.py -- <sonnet2-pieces-tripo.glb> modeles/sonnet.glb
#
# Le tableau PIECES vaut pour CE fichier Tripo (tâche 129483fc, 21/10/2026) :
# les numéros tripo_part_N ont été reconnus sur une planche de rendus, une
# pièce surlignée par vignette. Un autre export Tripo demande de le refaire.
import bpy, sys

args = sys.argv[sys.argv.index('--') + 1:]
entree, sortie = args[0], args[1]

# repère du schéma -> (nom du nœud exporté, couleur, pièces Tripo)
PIECES = {
    'r01_antenne':        ((0.93, 0.92, 0.92), [7, 8, 9, 10, 11, 12, 15, 16, 18, 22, 23, 26]),
    'r02_voyant_antenne': ((0.55, 0.55, 0.58), [1, 25]),
    'r03_cable':          ((0.62, 0.62, 0.65), [5, 6, 19]),
    'r04_boitier_pile':   ((0.91, 0.87, 0.87), [0, 31]),
    'r05_protection_micros': ((0.84, 0.80, 0.81), [2]),
    'r06_unite_commande': ((0.89, 0.85, 0.85), [3]),
    'r07_microphones':    ((0.35, 0.35, 0.38), [17, 24, 33]),
    'r08_voyant_processeur': ((0.20, 0.65, 0.35), [27, 29]),
    'r09_ergot_coude':    ((0.70, 0.70, 0.72), [21]),
    'r12_coude_ci':       ((0.80, 0.80, 0.82), [4]),
    'r13_entrees_air':    ((0.45, 0.45, 0.48), [14, 30, 32]),
}
A_SUPPRIMER = [13, 20, 28]   # trait horizontal, bille, tige fine : restes du schéma
FACES_PAR_GROUPE = {'r01_antenne': 9000, 'r04_boitier_pile': 12000}
FACES_DEFAUT = 3000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=entree)
par_num = {int(o.name.rsplit('_', 1)[1]): o for o in bpy.context.scene.objects
           if o.type == 'MESH' and o.name.startswith('tripo_part_')}
assert len(par_num) == 34, f'34 pièces attendues, {len(par_num)} trouvées : autre export Tripo ?'

for n in A_SUPPRIMER:
    bpy.data.objects.remove(par_num.pop(n), do_unlink=True)
restants = set(par_num) - {n for _, ns in PIECES.values() for n in ns}
assert not restants, f'pièces sans repère : {sorted(restants)}'

# Les traits de rappel du schéma sont devenus de fines tiges, parfois soudées à
# une pièce. On sépare chaque pièce en îlots et on retire ceux en forme de tige :
# deux dimensions sur trois sous EPAIS (l'objet entier mesure ~1 unité).
EPAIS = 0.012
def sans_tiges(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.mesh.separate(type='LOOSE')
    ilots = [x for x in bpy.context.selected_objects]
    gardes = []
    for x in ilots:
        d = sorted(x.dimensions)
        if d[1] < EPAIS and len(ilots) > 1: bpy.data.objects.remove(x, do_unlink=True)
        else: gardes.append(x)
    bpy.ops.object.select_all(action='DESELECT')
    for x in gardes: x.select_set(True)
    bpy.context.view_layer.objects.active = gardes[0]
    if len(gardes) > 1: bpy.ops.object.join()
    print(f'[sonnet] {o.name if len(gardes)==0 else gardes[0].name}: {len(ilots)-len(gardes)} tige(s) retirée(s) sur {len(ilots)} îlot(s)')
    return gardes[0]
for n in list(par_num):
    par_num[n] = sans_tiges(par_num[n])

# Bouts de traits soudés dans la masse, repérés par mesure (outils : stats des
# sommets par pièce) : on efface les sommets au-delà de la surface réelle.
import bmesh
COUPES = {11: lambda c: c.z > 0.455,          # tige au-dessus du disque de l'antenne
          17: lambda c: c.z > 0.603, 24: lambda c: c.z > 0.603,   # plots des micros
          0:  lambda c: c.x > -0.128}         # trait à droite du boîtier
for n, hors in COUPES.items():
    o = par_num[n]; bm = bmesh.new(); bm.from_mesh(o.data)
    mw = o.matrix_world
    tue = [v for v in bm.verts if hors(mw @ v.co)]
    bmesh.ops.delete(bm, geom=tue, context='VERTS'); bm.to_mesh(o.data); bm.free()
    print(f'[sonnet] coupe tripo_part_{n}: {len(tue)} sommets')

for nom, (couleur, nums) in PIECES.items():
    objs = [par_num[n] for n in nums]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = nom
    faces = len(o.data.polygons); cible = FACES_PAR_GROUPE.get(nom, FACES_DEFAUT)
    if faces > cible:
        m = o.modifiers.new('reduire', 'DECIMATE'); m.ratio = cible / faces
        bpy.ops.object.modifier_apply(modifier=m.name)
    mat = bpy.data.materials.new(nom); mat.use_nodes = True
    bs = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value = (*couleur, 1)
    bs.inputs['Roughness'].default_value = 0.5
    o.data.materials.clear(); o.data.materials.append(mat)
    print(f'[sonnet] {nom}: {len(nums)} pièce(s), {faces} -> {len(o.data.polygons)} faces')

bpy.ops.export_scene.gltf(filepath=sortie, export_format='GLB',
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_animations=False)
print('[sonnet] ecrit', sortie)
