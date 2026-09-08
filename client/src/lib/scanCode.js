// Le code imprime sur une piece, et lu par la douchette a l'autre bout du monde.
//
// Format : SC:<type>:<uuid>.  Court (41 caracteres), donc un QR version 4 en
// correction M, net meme imprime en 58 mm sur du papier thermique. Opaque :
// scanne hors de l'application il ne dit ni adresse, ni nom, ni montant.
//
// L'uuid est celui que chaque table synchronisable porte deja (004_sync.sql) —
// unique au monde, donc deux bureaux hors ligne ne peuvent pas imprimer deux
// pieces au meme code. Ce fichier est le jumeau de server/src/lib/scanCode.js :
// un seul format, ecrit deux fois plutot que partage par un import qui
// traverserait les deux paquets. Toute modification va dans les deux.

export const SCAN_PREFIX = 'SC';

// Le type tient en une lettre pour garder le code court.
export const SCAN_KINDS = {
  B: 'bon',
  O: 'order',
  P: 'person',
  T: 'transaction',
};

const LETTER_OF = Object.fromEntries(Object.entries(SCAN_KINDS).map(([k, v]) => [v, k]));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeScan(kind, uuid) {
  const letter = LETTER_OF[kind];
  if (!letter) throw new Error(`Type de piece inconnu : ${kind}`);
  return `${SCAN_PREFIX}:${letter}:${String(uuid).toLowerCase()}`;
}

// Rend { kind, uuid } ou null. Tolere les espaces et la casse : une douchette
// mal reglee ajoute parfois un blanc, et rien ne justifie de refuser pour ca.
export function parseScan(code) {
  const parts = String(code ?? '').trim().split(':');
  if (parts.length !== 3) return null;
  const [prefix, letter, uuid] = parts;
  if (prefix.toUpperCase() !== SCAN_PREFIX) return null;
  const kind = SCAN_KINDS[letter.toUpperCase()];
  if (!kind) return null;
  if (!UUID_RE.test(uuid.trim())) return null;
  return { kind, uuid: uuid.trim().toLowerCase() };
}
