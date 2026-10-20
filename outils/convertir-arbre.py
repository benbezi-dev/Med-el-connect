"""source/arbre-diagnostic.json -> bloc DATA au format de l'assistant.

L'arbre vient du prototype « Processor Viewer » (Replit). Il est repris tel
quel : aucune question ni aucun conseil n'est réécrit ici, seule la forme
change. Sortie sur la sortie standard, à coller entre les marqueurs
ARBRE-DEBUT / ARBRE-FIN de source/app.html.
"""

import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SOURCE = RACINE / "source" / "arbre-diagnostic.json"

# Les noms d'icônes de l'arbre d'origine (Lucide) vers celles de l'assistant.
ICONES = {
    "Battery": "batterie", "Magnet": "aimant", "AlertTriangle": "alerte",
    "Volume2": "volume", "Radio": "onde", "Bluetooth": "bluetooth",
    "Power": "power", "Clock": "horloge", "Mic": "micro", "Cpu": "chip",
    "Headphones": "support", "Stethoscope": "stetho", "User": "user",
}

# Nœuds remplacés par les écrans « cible » et « processeur » de l'assistant.
IGNORES = {"start", "device_patient", "device_pro"}


def js(valeur):
    return json.dumps(valeur, ensure_ascii=False)


def court(texte, limite=20):
    """Libellé de fil d'Ariane : la partie utile de l'eyebrow, tronquée."""
    t = texte.split("—")[-1].strip() if "—" in texte else texte.strip()
    return t if len(t) <= limite else t[: limite - 1].rstrip() + "…"


def convertir_choix(cle, n):
    eyebrow = n.get("eyebrow", "Question")
    champs = [
        f"type:'menu'",
        f"crumb:{js(eyebrow)}",
        f"trail:{js(court(eyebrow))}",
        f"eyebrow:{js(eyebrow)}",
        f"title:{js(n.get('question', ''))}",
    ]
    if n.get("sub"):
        champs.append(f"lede:{js(n['sub'])}")
    if n.get("highlights"):
        champs.append(f"zones:{js(n['highlights'])}")
    if n.get("device"):
        champs.append(f"vue:{js(n['device'])}")

    options = []
    for o in n.get("options", []):
        bout = [f"to:{js(o['next'])}", f"title:{js(o['label'])}"]
        if o.get("hint"):
            bout.append(f"sub:{js(o['hint'])}")
        if o.get("icon") and o["icon"] in ICONES:
            bout.append(f"icon:{js(ICONES[o['icon']])}")
        options.append("        {" + ",".join(bout) + "}")

    return (
        f"    {cle}:{{" + ",".join(champs) + ",\n"
        + "      options:[\n" + ",\n".join(options) + "\n      ]},"
    )


def convertir_bilan(cle, n):
    champs = [
        "type:'bilan'",
        "crumb:'Conclusion'",
        "trail:'Conclusion'",
        f"severite:{js(n.get('severity', 'info'))}",
        f"title:{js(n.get('title', ''))}",
        f"resume:{js(n.get('summary', ''))}",
    ]
    if n.get("highlights"):
        champs.append(f"zones:{js(n['highlights'])}")
    if n.get("device"):
        champs.append(f"vue:{js(n['device'])}")
    if n.get("actions"):
        actions = ",\n        ".join(js(a) for a in n["actions"])
        champs.append("actions:[\n        " + actions + "\n      ]")
    return f"    {cle}:{{" + ",".join(champs) + "},"


def main():
    arbre = json.loads(SOURCE.read_text(encoding="utf-8"))
    lignes = []
    for cle, n in arbre.items():
        if cle in IGNORES:
            continue
        if n["type"] == "choice":
            lignes.append(convertir_choix(cle, n))
        else:
            lignes.append(convertir_bilan(cle, n))
    sys.stdout.write("\n".join(lignes) + "\n")


if __name__ == "__main__":
    sys.exit(main())
