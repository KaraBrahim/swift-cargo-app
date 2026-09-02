// Shared mapping from audit actions to readable French, used by both the
// dashboard "Activité récente" feed and the notifications bell. Anything
// unmapped falls back to the raw action code (visible, not silently dropped).
import { formatMoney } from './ui.jsx';

// [label, icon]
const ACTION_LABEL = {
  'bon.create': ['Nouveau bon passager créé', 'bon'],
  'bon.create.standalone': ['Nouveau bon passager créé', 'bon'],
  'bon.status': ['Statut mis à jour', 'order'],
  'bon.reconcile': ['Bon passager réconcilié', 'bon'],
  'bon.settle': ['Bon passager réglé', 'bon'],
  'bon.collect_fee': ['Paiement reçu', 'caisse'],
  'bon.pay_passager': ['Passager payé', 'caisse'],
  'order.create': ['Nouveau bon fournisseur créé', 'order'],
  'caisse.deposit': ['Dépôt en caisse', 'caisse'],
  'caisse.withdraw': ['Retrait de caisse', 'caisse'],
  'caisse.convert': ['Conversion de devise', 'swap'],
  'caisse.transfer': ['Transfert entre caisses', 'swap'],
  'caisse.create': ['Caisse créée', 'caisse'],
  'transfer.send': ['Transfert envoyé', 'swap'],
  'transfer.receive': ['Transfert reçu', 'swap'],
  'stock.item.create': ['Article ajouté', 'stock'],
  'stock.item.update': ['Article modifié', 'stock'],
  'stock.inventory': ['Stock mis à jour', 'stock'],
  'stock.category.create': ['Catégorie créée', 'stock'],
  'rate.set': ['Taux de change mis à jour', 'taux'],
  'fournisseur.create': ['Fournisseur ajouté', 'fournisseur'],
  'passager.create': ['Passager ajouté', 'passager'],
  'admin.create': ['Utilisateur créé', 'users'],
  'admin.update': ['Utilisateur modifié', 'users'],
  'admin.set_active': ['Utilisateur activé / désactivé', 'users'],
  'admin.reset_password': ['Mot de passe réinitialisé', 'users'],
  'settings.update': ['Paramètres modifiés', 'gear'],
};

export function activityLine(entry) {
  const [label, icon] = ACTION_LABEL[entry.action] ?? [entry.action, 'audit'];
  const d = entry.details ?? {};
  const bits = [];
  if (d.reference) bits.push(d.reference);
  if (d.amount) bits.push(`${formatMoney(d.amount)} ${d.currency ?? 'DZD'}`);
  if (d.from && d.to) bits.push(`${d.from} → ${d.to}`);
  if (d.counted != null) bits.push(`${d.counted} unités`);
  return { label, icon, sub: bits.join(' · ') };
}

// Resolve an audit entry to the screen where the user can act on it. Bon = the
// passager document, order = the fournisseur document (see the rename).
export function entityHref(entry) {
  switch (entry.entity) {
    case 'bon': return `/bons-passager/${entry.entity_id}`;
    case 'order': return `/bons-fournisseur/${entry.entity_id}`;
    case 'stock_item':
    case 'stock_category': return '/stock';
    case 'office_transfer':
    case 'transaction':
    case 'conversion':
    case 'caisse': return '/caisses';
    case 'currency': return '/taux';
    case 'admin': return '/utilisateurs';
    default: return '/audit';
  }
}
