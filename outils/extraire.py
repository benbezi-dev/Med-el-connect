"""index.html -> source/app.html + source/ressources/

À lancer une seule fois, ou pour repartir d'un index.html reçu d'ailleurs.
Écrase le source éditable : à ne pas lancer après avoir édité source/app.html.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bundle


def main():
    html = bundle.lire_index()
    manifeste = bundle.lire_manifeste(html)
    template = bundle.lire_template(html)

    bundle.SOURCE.parent.mkdir(parents=True, exist_ok=True)
    bundle.RESSOURCES.mkdir(parents=True, exist_ok=True)
    bundle.SOURCE.write_text(template, encoding="utf-8")

    index = {}
    for uid, entree in manifeste.items():
        ext = bundle.EXTENSIONS.get(entree["mime"], ".bin")
        nom = uid + ext
        (bundle.RESSOURCES / nom).write_bytes(bundle.decoder(entree))
        index[uid] = {"fichier": nom, "mime": entree["mime"]}

    bundle.MANIFESTE.write_text(
        json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"source/app.html : {len(template)} octets")
    print(f"source/ressources : {len(index)} fichiers")


if __name__ == "__main__":
    sys.exit(main())
