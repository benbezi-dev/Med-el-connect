/* Persistance des séances dans un simple fichier JSON.

   Le volume attendu (2 créneaux x 5 lieux x quelques semaines) tient
   largement en mémoire : on garde tout chargé et on réécrit le fichier à
   chaque mutation. L'écriture passe par un fichier temporaire renommé, pour
   qu'une coupure ne laisse jamais un JSON tronqué. */

const fs = require('node:fs');
const path = require('node:path');

class Store {
  /** @param {string|null} filePath chemin du fichier JSON, ou null pour rester en mémoire. */
  constructor(filePath) {
    this.filePath = filePath;
    this.sessions = filePath ? readFile(filePath) : [];
  }

  all() {
    return this.sessions;
  }

  find(id) {
    return this.sessions.find((session) => session.id === id);
  }

  /** Remplace le contenu et persiste. */
  replaceAll(sessions) {
    this.sessions = sessions;
    this.flush();
  }

  flush() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ sessions: this.sessions }, null, 2)}\n`);
    fs.renameSync(temp, this.filePath);
  }
}

function readFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.sessions) ? parsed.sessions : [];
}

module.exports = { Store };
