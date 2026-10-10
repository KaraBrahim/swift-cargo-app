// Les phrases du journal : une seule rédaction pour l'écran ET pour le papier.
//
// Un événement arrive du serveur avec ses chiffres (quantité, poids, jour réel,
// manquants…) ; ici on en fait une phrase. Écran et PDF lisent la même fonction,
// donc disent la même chose.
import { formatQty, formatMoney, formatDateFr } from './format.js';

const qty = (e) => `${formatQty(e.quantity)} ${e.unit || ''}`.trim();
const kg = (e) => (Number(e.weight_kg) > 0 ? ` · ${formatQty(e.weight_kg)} kg` : '');
const who = (e) => (e.person ? `${e.person}${e.bon_reference ? ` (${e.bon_reference})` : ''}` : e.bon_reference || '');
const plural = (n, one, many) => (Number(n) > 1 ? many : one);

// Le jour à afficher : le jour RÉEL quand on le connaît, sinon celui de l'écriture.
export const dayOf = (e) => e.day || (e.at ? e.at.slice(0, 10) : null);
export const timeOf = (e) => (e.at ? new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');

// { title, detail, tone, icon } — tone : gold | green | red | blue | muted
export function describeEvent(e) {
  switch (e.kind) {
    // ── la marchandise d'un ordre ──
    case 'received':
      return { icon: 'box', tone: 'muted', title: `Reçue en Chine : ${qty(e)}${kg(e)}`, detail: e.actor ? `par ${e.actor}` : '' };
    case 'allocated':
      return { icon: 'passager', tone: 'gold', title: `Confiée à ${who(e)} : ${qty(e)}${kg(e)}`, detail: e.actor ? `saisi par ${e.actor}` : '' };
    case 'departed':
      return {
        icon: 'plane', tone: 'gold',
        title: e.person ? `Partie de Chine avec ${who(e)}` : 'Parti',
        detail: e.quantity && e.person ? `${qty(e)}${kg(e)}` : '',
      };
    case 'arrived': {
      const miss = Number(e.missing) > 0;
      const got = `${qty(e)} ${plural(e.quantity, 'reçue', 'reçues')}`;
      const lost = miss ? ` · ${formatQty(e.missing)} ${plural(e.missing, 'manquante', 'manquantes')}` : '';
      return {
        icon: miss ? 'alert' : 'check', tone: miss ? 'red' : 'green',
        title: e.person ? `Arrivée à Alger avec ${who(e)} : ${got}${lost}` : `Arrivé : ${got}${lost}`,
        detail: [
          e.note && `à qui la faute : ${e.note}`,
          e.promised && `promis le ${formatDateFr(e.promised)}`,
          e.days_late > 0 && `${e.days_late} ${plural(e.days_late, 'jour', 'jours')} de retard`,
        ].filter(Boolean).join(' · '),
      };
    }
    case 'delivered':
      return { icon: 'fournisseur', tone: 'blue', title: `Remise au fournisseur : ${qty(e)}${kg(e)}`, detail: e.actor ? `par ${e.actor}` : '' };
    case 'delivery_cancelled':
      return {
        icon: 'refresh', tone: 'muted',
        title: `Remise annulée : ${qty(e)} ${plural(e.quantity, 'rendue', 'rendues')} au bureau`,
        detail: e.actor ? `par ${e.actor}` : '',
      };

    // ── le voyage d'un bon passager ──
    case 'created':
      return {
        icon: 'bon', tone: 'muted',
        title: `Bon créé : ${formatQty(e.quantity)} pièce(s)${kg(e)}`,
        detail: [e.note, e.actor && `par ${e.actor}`].filter(Boolean).join(' · '),
      };
    case 'missing':
      return {
        icon: 'alert', tone: 'red',
        title: `${e.designation} : ${formatQty(e.quantity)} ${plural(e.quantity, 'manquante', 'manquantes')}${e.of ? ` sur ${formatQty(e.of)}` : ''}`,
        detail: [e.note && `à qui la faute : ${e.note}`, e.loss_value && `valeur ${formatMoney(e.loss_value)}`].filter(Boolean).join(' · '),
      };
    case 'settled':
      return {
        icon: 'check', tone: 'green',
        title: `Bon réglé${e.amount != null ? ` : ${formatMoney(e.amount, e.currency)} dus au passager` : ''}`,
        detail: e.actor ? `par ${e.actor}` : '',
      };
    case 'payment':
      return {
        icon: e.direction === 'in' ? 'arrowIn' : 'arrowOut', tone: e.direction === 'in' ? 'green' : 'gold',
        title: `${e.direction === 'in' ? 'Encaissé' : 'Payé au passager'} : ${formatMoney(e.amount, e.currency)}`,
        detail: [e.note && `caisse ${e.note}`, e.actor && `par ${e.actor}`].filter(Boolean).join(' · '),
      };
    default:
      return { icon: 'note', tone: 'muted', title: e.kind, detail: '' };
  }
}

// Le bon passager dit « parti le X » avec ses dates ; l'ordre dit « partie avec Y ».
export function describeBonEvent(e) {
  if (e.kind === 'departed') {
    return {
      icon: 'plane', tone: 'gold',
      title: `Parti${e.day ? ` le ${formatDateFr(e.day)}` : ''}`,
      detail: [e.planned && e.planned !== e.day && `prévu le ${formatDateFr(e.planned)}`, e.actor && `par ${e.actor}`].filter(Boolean).join(' · '),
    };
  }
  if (e.kind === 'arrived') {
    const d = describeEvent({ ...e, person: null });
    return { ...d, title: `Arrivé${e.day ? ` le ${formatDateFr(e.day)}` : ''} : ${formatQty(e.quantity)} reçue(s) sur ${formatQty(e.of)}` };
  }
  return describeEvent(e);
}
