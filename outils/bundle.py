"""Lecture / écriture du bundle index.html de MED-EL Connect.

index.html est un export d'artifact : un chargeur HTML, un manifeste de
ressources (gzip + base64) et le source de l'application sérialisé en chaîne
JSON. Ce module isole ces trois morceaux pour qu'on puisse éditer le source
comme un fichier normal.
"""

import base64
import gzip
import json
import re
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
INDEX = RACINE / "index.html"
SOURCE = RACINE / "source" / "app.html"
RESSOURCES = RACINE / "source" / "ressources"
MANIFESTE = RACINE / "source" / "ressources" / "manifeste.json"

_MANIFEST_RE = re.compile(
    r'(<script type="__bundler/manifest">\s*)(.*?)(\s*</script>)', re.S
)
_TEMPLATE_RE = re.compile(
    r'(<script type="__bundler/template">\s*)(.*?)(\s*</script>)', re.S
)

EXTENSIONS = {
    "text/javascript": ".js",
    "application/javascript": ".js",
    "text/css": ".css",
    "font/woff2": ".woff2",
    "image/png": ".png",
    "image/svg+xml": ".svg",
}


def lire_index():
    return INDEX.read_text(encoding="utf-8")


def lire_manifeste(html):
    m = _MANIFEST_RE.search(html)
    if not m:
        raise SystemExit("manifeste introuvable dans index.html")
    return json.loads(m.group(2))


def lire_template(html):
    m = _TEMPLATE_RE.search(html)
    if not m:
        raise SystemExit("template introuvable dans index.html")
    return json.loads(m.group(2))


def _sur_pour_html(bloc):
    """`</script>` dans une chaîne JSON fermerait la balise : on échappe la barre."""
    return bloc.replace("</", "<\\u002F")


def ecrire_index(html, manifeste=None, template=None):
    if manifeste is not None:
        bloc = _sur_pour_html(json.dumps(manifeste, separators=(",", ":")))
        html = _MANIFEST_RE.sub(lambda m: m.group(1) + bloc + m.group(3), html, count=1)
    if template is not None:
        bloc = _sur_pour_html(json.dumps(template))
        html = _TEMPLATE_RE.sub(lambda m: m.group(1) + bloc + m.group(3), html, count=1)
    INDEX.write_text(html, encoding="utf-8")


def decoder(entree):
    brut = base64.b64decode(entree["data"])
    if entree.get("compressed"):
        brut = gzip.decompress(brut)
    return brut


def encoder(brut, mime, compresser=True):
    data = gzip.compress(brut, 9) if compresser else brut
    return {
        "mime": mime,
        "compressed": compresser,
        "data": base64.b64encode(data).decode("ascii"),
    }
