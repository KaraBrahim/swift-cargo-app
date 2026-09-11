import { useCallback, useState } from 'react';

// Un réglage d'affichage qui survit à la fermeture de l'application.
//
// Une période choisie, un onglet, un mode d'affichage : ce sont des décisions
// que la personne a prises une fois et qu'elle ne veut pas reprendre chaque
// matin. Ils vivent dans le navigateur et non sur le serveur — c'est un confort
// de poste, pas une donnée de l'entreprise, et le poste de Chine peut très bien
// regarder la semaine pendant que celui d'Alger regarde le mois.
//
// S'utilise exactement comme useState.
export function useSticky(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : JSON.parse(saved);
    } catch {
      // Navigation privée, stockage refusé, JSON abîmé par une version
      // précédente : aucune de ces situations ne doit empêcher la page de
      // s'afficher. On repart de la valeur par défaut.
      return initial;
    }
  });

  const set = useCallback((next) => {
    setValue((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* le réglage ne sera simplement pas retenu */
      }
      return resolved;
    });
  }, [key]);

  return [value, set];
}
