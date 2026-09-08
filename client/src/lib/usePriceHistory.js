// Ce qui a ete convenu la derniere fois.
//
// Le meme article, le meme fournisseur, la meme commission, mois apres mois :
// les retaper de memoire est une perte de temps et une source d'ecart. Rien
// n'est stocke en double pour autant — le serveur derive ces prix des bons
// existants (voir priceHistory dans bons.service.js), donc ils sont toujours
// d'accord avec eux.
//
// `own` : le dernier prix avec CETTE personne. `any` : le dernier vu ailleurs,
// utilise en repli et signale comme tel, pour qu'on sache toujours d'ou vient
// le chiffre propose.

import { useMemo } from 'react';
import { useApi } from '../api/useApi.js';

const norm = (v) => String(v ?? '').trim().toLowerCase();

export function usePriceHistory({ fournisseurId, passagerId, scope } = {}) {
  // `scope` dit de quel cote on parle meme sans personne choisie : sans lui, un
  // formulaire encore vide proposerait les prix de l'autre metier.
  const params = new URLSearchParams();
  if (fournisseurId) params.set('fournisseurId', fournisseurId);
  if (passagerId) params.set('passagerId', passagerId);
  if (scope) params.set('scope', scope);
  const { data } = useApi(`/bons/price-history${params.toString() ? `?${params}` : ''}`);

  return useMemo(() => {
    // Deux entrees par prix : par article du catalogue, et par nom. Un article
    // tout juste tape n'a pas encore d'identifiant, mais il a deja un nom.
    const index = (rows, own) => {
      const byId = new Map();
      const byName = new Map();
      for (const r of rows ?? []) {
        const hit = { ...r, own };
        if (r.item_id != null) byId.set(String(r.item_id), hit);
        if (r.designation) byName.set(norm(r.designation), hit);
      }
      return { byId, byName };
    };
    const own = index(data?.own, true);
    const any = index(data?.any, false);

    const lookup = (itemId, designation) => {
      const id = itemId != null && itemId !== '' ? String(itemId) : null;
      const nm = norm(designation);
      return (id && own.byId.get(id))
        || (nm && own.byName.get(nm))
        || (id && any.byId.get(id))
        || (nm && any.byName.get(nm))
        || null;
    };

    return { lookup, commission: data?.commission ?? null, ready: Boolean(data) };
  }, [data]);
}
