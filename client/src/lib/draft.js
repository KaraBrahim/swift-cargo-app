// Ce qu'on a commence a saisir survit a un onglet ferme.
//
// Remplir un panier prend du temps : trois fournisseurs, dix lots, deux prix par
// lot. Aller verifier un solde ailleurs dans l'application, ou fermer l'onglet
// par reflexe, ne doit pas tout effacer.
//
// sessionStorage et non localStorage, comme la barre d'onglets : le brouillon
// survit a un F5 et a la navigation, pas a la fermeture du navigateur — un
// panier d'avant-hier qui se rouvre tout seul serait un piege, pas un service.
// Et surtout : rien n'est ecrit en base tant que le bon n'est pas cree.

import { useEffect, useRef, useState } from 'react';

const read = (key, fallback) => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota, mode prive */ }
};

export const clearDraft = (key) => {
  try { sessionStorage.removeItem(key); } catch { /* rien a faire */ }
};

// Un useState qui se souvient. `restored` dit si la valeur vient du brouillon,
// pour que l'ecran puisse le signaler au lieu de le faire subir.
export function useDraft(key, initial) {
  const saved = useRef(read(key, null));
  const [value, setValue] = useState(() => saved.current ?? initial);
  const [restored, setRestored] = useState(() => saved.current != null);

  useEffect(() => {
    write(key, value);
  }, [key, value]);

  const reset = () => {
    clearDraft(key);
    setRestored(false);
    setValue(initial);
  };

  // Oublier le brouillon sans toucher a ce qui est affiche — apres creation.
  const forget = () => { clearDraft(key); setRestored(false); };

  return [value, setValue, { restored, reset, forget }];
}
