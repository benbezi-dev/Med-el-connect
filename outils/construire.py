"""source/app.html + source/images/ + source/ressources/ -> index.html

C'est la commande à lancer après chaque édition du source.

Les fichiers de source/images/ sont embarqués dans le bundle comme les polices :
chacun reçoit un identifiant stable, et le chargeur le remplace au démarrage par
une URL blob. L'application reste un fichier unique, utilisable hors ligne.
"""

import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bundle

IMAGES = bundle.RACINE / "source" / "images"
TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
         ".webp": "image/webp", ".svg": "image/svg+xml"}

_BLOC_RE = re.compile(
    r"(  // ---------- IMAGES-DEBUT ----------\n).*?(  // ---------- IMAGES-FIN ----------\n)",
    re.S,
)


def identifiant(nom):
    """Identifiant stable dérivé du nom, au format des autres ressources."""
    h = hashlib.sha256(("medel-image:" + nom).encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def recenser_images():
    if not IMAGES.is_dir():
        return {}
    trouvees = {}
    for f in sorted(IMAGES.iterdir()):
        mime = TYPES.get(f.suffix.lower())
        if f.is_file() and mime:
            trouvees[f.stem] = (f, mime, identifiant(f.name))
    return trouvees


def ecrire_bloc(images):
    """Réécrit la table IMAGES du source entre ses marqueurs."""
    app = bundle.SOURCE.read_text(encoding="utf-8")
    if not _BLOC_RE.search(app):
        raise SystemExit("marqueurs IMAGES-DEBUT / IMAGES-FIN absents de source/app.html")
    lignes = [
        "  // Visuels officiels MED-EL. Table régénérée par outils/construire.py",
        "  // à partir de source/images/ : ne pas la modifier à la main.",
        "  IMAGES = {",
    ]
    for cle, (_, _, uid) in images.items():
        lignes.append(f"    {json.dumps(cle)}: {json.dumps(uid)},")
    lignes.append("  };")
    bloc = "\n".join(lignes) + "\n"
    app = _BLOC_RE.sub(lambda m: m.group(1) + bloc + m.group(2), app, count=1)
    bundle.SOURCE.write_text(app, encoding="utf-8")
    return app


def main():
    images = recenser_images()
    template = ecrire_bloc(images)
    index = json.loads(bundle.MANIFESTE.read_text(encoding="utf-8"))

    manifeste = {}
    for uid, infos in index.items():
        brut = (bundle.RESSOURCES / infos["fichier"]).read_bytes()
        manifeste[uid] = bundle.encoder(brut, infos["mime"])
    for cle, (chemin, mime, uid) in images.items():
        manifeste[uid] = bundle.encoder(chemin.read_bytes(), mime)

    bundle.ecrire_index(bundle.lire_index(), manifeste=manifeste, template=template)

    taille = bundle.INDEX.stat().st_size
    print(f"index.html : {taille // 1024} Ko, {len(manifeste)} ressources "
          f"dont {len(images)} images")


if __name__ == "__main__":
    sys.exit(main())
