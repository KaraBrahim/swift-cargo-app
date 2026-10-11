// La remise, côté écran : ce que la personne choisit, et ce que ça donne en chiffres.
//
// Quatre sortes (les mêmes que le serveur) :
//   amount  — un montant libre        on laisse tomber 400
//   percent — un pourcentage du dû    5 % de 52 340
//   round   — arrondir                52 340 → 52 000 ou 52 500
//   settle  — total convenu           on dit le total réglé, la remise est la différence
//                                     avec le dû (l'option principale à l'écran)
//
// L'écran calcule pour MONTRER ; c'est le serveur qui recalcule et qui fait foi.
// Un pourcentage n'est jamais envoyé sous forme de montant : on envoie « 5 % » et
// le serveur en tire la somme.
export const NO_REMISE = { kind: 'none', value: '', reasonId: null, note: '' };

export const KIND_LABEL = { amount: 'Montant', percent: 'Pourcentage', round: 'Arrondi', settle: 'Total convenu' };

const r2 = (n) => Math.round(n * 100) / 100;

// due : ce qui reste dû · amount : l'argent versé · step : le pas d'arrondi de la devise
export function remiseFigures(rm, due, amount, step) {
  const d = Number(due) || 0;
  const a = Number(amount) || 0;
  const base = { active: false, pending: false, diff: 0, percent: null, error: null, left: r2(Math.max(d - a, 0)), excess: r2(Math.max(a - d, 0)) };
  if (!rm || rm.kind === 'none' || !(d > 0)) return base;

  let diff = 0;
  let percent = null;
  let error = null;
  let pending = false;

  if (rm.kind === 'amount') {
    diff = r2(Number(String(rm.value).replace(/\s/g, '').replace(',', '.')) || 0);
    pending = !(diff > 0);
  } else if (rm.kind === 'percent') {
    percent = Number(String(rm.value).replace(',', '.')) || 0;
    if (percent > 100) error = 'Un pourcentage ne dépasse pas 100.';
    diff = r2((d * percent) / 100);
    pending = !(diff > 0);
  } else {
    diff = r2(d - a);
    pending = diff === 0;
    if (diff < 0 && -diff > step) error = `Au-delà de l’arrondi permis (${step}).`;
  }

  if (!error && (rm.kind === 'amount' || rm.kind === 'percent') && !pending && a + diff > d + 0.004) {
    error = 'Le versement et la remise dépassent le dû.';
  }

  const settles = rm.kind === 'round' || rm.kind === 'settle';
  return {
    active: !pending && !error,
    pending,
    diff,
    percent: percent ?? (d > 0 && diff !== 0 ? r2((diff / d) * 100) : null),
    error,
    // « solder » et « arrondir » ramènent la dette à zéro ; un montant ou un
    // pourcentage ne soldent que ce qu'ils couvrent.
    left: settles ? 0 : r2(Math.max(d - a - diff, 0)),
    excess: settles ? 0 : r2(Math.max(a + diff - d, 0)),
  };
}

// Ce que l'API reçoit : rien s'il n'y a pas de remise valable.
export function remiseToApi(rm, figures) {
  if (!figures?.active) return undefined;
  const out = { kind: rm.kind };
  if (rm.kind === 'amount' || rm.kind === 'percent') out.value = String(rm.value).replace(/\s/g, '').replace(',', '.');
  if (rm.reasonId) out.reasonId = Number(rm.reasonId);
  if (rm.note?.trim()) out.note = rm.note.trim();
  return out;
}

// Le corps `remise` d'une requête, depuis ce que l'écran a saisi. Le pas d'arrondi
// n'est pas connu ici : le serveur le vérifie, et c'est lui qui fait foi.
export const remiseBody = (rm, due, amount) => remiseToApi(rm, remiseFigures(rm, due, amount, Infinity));

// La phrase qui dit la remise, pour la vérification et les fiches.
export function remiseLabel({ kind, percent, reason }) {
  const what = kind === 'percent' && percent != null ? `${Number(percent)} %` : KIND_LABEL[kind] ?? 'Remise';
  return reason ? `${what} · ${reason}` : what;
}
