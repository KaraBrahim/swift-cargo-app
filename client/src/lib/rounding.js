// Arrondir un montant : 52 340 → 52 000 ou 52 500.
//
// Le pas se règle par devise dans Paramètres (500 pour le dinar, 1 pour le reste,
// par défaut) ; le serveur applique le même pas pour borner un arrondi au-dessus
// du dû. Ici on ne fait que PROPOSER : le montant reste libre, on peut toujours
// taper autre chose.
import { useApi } from '../api/useApi.js';

export const DEFAULT_ARRONDI = { defaut: 1, pas: { DZD: 500 } };

// Le pas d'une devise, tel que les paramètres le disent.
export function useStep(currency) {
  const { data } = useApi('/settings');
  const a = data?.settings?.arrondi ?? DEFAULT_ARRONDI;
  const pas = { ...DEFAULT_ARRONDI.pas, ...(a.pas ?? {}) };
  return Number(pas[currency] ?? a.defaut ?? 1);
}

const cents = (v) => Math.round(v * 100) / 100;

// Les deux montants ronds qui encadrent `amount` : en dessous, au-dessus. Rien si
// le montant est déjà rond (ou nul) : il n'y a rien à proposer.
export function roundChoices(amount, step) {
  const n = Number(amount);
  if (!(n > 0) || !(step > 0)) return [];
  const down = cents(Math.floor(n / step) * step);
  const up = cents(Math.ceil(n / step) * step);
  if (down === up) return [];
  return [down, up].filter((v) => v > 0);
}
