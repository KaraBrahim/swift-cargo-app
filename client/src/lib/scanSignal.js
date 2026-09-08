// « Ce bon vient d'etre scanne. »
//
// Le scan ouvre une fiche dans un onglet ; la fiche, elle, doit savoir qu'elle
// arrive par la douchette pour mettre en avant l'action attendue au comptoir.
// L'information ne peut pas voyager dans l'adresse : un onglet ne retient que
// son chemin (voir normalizePath), et un ?scan=1 y survivrait de toute facon a
// un rechargement, ce qui ferait reapparaitre le bandeau des jours plus tard.
//
// Donc un signal en memoire, sans provider a brancher : il naît au scan, la
// fiche concernee le lit, et il meurt avec la session.

import { useSyncExternalStore } from 'react';

let current = null;
const listeners = new Set();

const emit = () => { for (const l of listeners) l(); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => current;

export function setScanHit(hit) {
  current = hit ? { ...hit, at: Date.now() } : null;
  emit();
}

export const clearScanHit = () => setScanHit(null);

// Le signal, mais seulement s'il designe CETTE fiche.
export function useScanHit(kind, id) {
  const hit = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (!hit || hit.kind !== kind || String(hit.id) !== String(id)) return null;
  return hit;
}
