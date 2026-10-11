import { useApi } from '../api/useApi.js';
import { useStep } from './rounding.js';
import { remiseFigures, remiseToApi, remiseLabel } from './remise.js';

// Tout ce qu'un écran de règlement veut savoir d'une remise : ses chiffres, ce qu'il
// faut envoyer à l'API, et la ligne de vérification. Un hook : à appeler AVANT tout
// retour anticipé.
export function useRemiseView(rm, due, amount, currency) {
  const step = useStep(currency);
  const reasons = useApi('/remises/reasons');
  const figures = remiseFigures(rm, due, amount, step);
  const reason = reasons.data?.reasons?.find((r) => r.id === Number(rm?.reasonId))?.label;
  return {
    step,
    figures,
    api: remiseToApi(rm, figures),
    line: figures.active ? { text: remiseLabel({ kind: rm.kind, percent: figures.percent, reason }), amount: figures.diff } : null,
  };
}
