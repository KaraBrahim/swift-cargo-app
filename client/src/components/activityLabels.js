// Ce qui s'est passé, écrit en français — pour le fil « Activité récente » du
// tableau de bord, la cloche de notifications et le journal.
//
// Le journal enregistre des codes (`person.create`) parce qu'une machine les
// compare ; personne ne lit un code. Chaque action connue a donc sa phrase, et
// une action inconnue est traduite à partir de ses deux moitiés plutôt que
// montrée telle quelle : une nouvelle action ajoutée côté serveur reste lisible
// le jour où elle apparaît, avant même qu'on ait pensé à l'écrire ici.
import { formatMoney } from './ui.jsx';
import { OFFICE_LABEL } from '../lib/offices.js';

// [phrase, icône]
const ACTION_LABEL = {
  // ── Bons passagers ──
  'bon.create': ['Bon passager créé', 'bon'],
  'bon.create.standalone': ['Bon passager créé', 'bon'],
  'bon.update': ['Bon passager modifié', 'bon'],
  'bon.delete': ['Bon passager supprimé', 'trash'],
  'bon.status': ['Bon passager : étape suivante', 'bon'],
  'bon.status.set': ['Statut du bon passager changé', 'bon'],
  'bon.reconcile': ['Manquants saisis', 'bon'],
  'bon.settle': ['Bon passager réglé', 'bon'],
  'bon.collect_fee': ['Frais encaissés du fournisseur', 'caisse'],
  'bon.pay_passager': ['Passager payé', 'caisse'],
  'bon.payment.cancel': ['Paiement annulé', 'trash'],

  // ── Bons fournisseurs ──
  'order.create': ['Bon fournisseur créé', 'order'],
  'order.delete': ['Bon fournisseur supprimé', 'trash'],

  // ── Caisse ──
  'caisse.deposit': ['Dépôt en caisse', 'caisse'],
  'caisse.withdraw': ['Retrait de caisse', 'caisse'],
  'caisse.convert': ['Devises converties', 'swap'],
  'caisse.transfer': ['Transfert entre caisses', 'swap'],
  'caisse.create': ['Caisse créée', 'caisse'],
  'caisse.update': ['Caisse modifiée', 'caisse'],
  'caisse.set_active': ['Caisse activée / désactivée', 'caisse'],
  'caisse.tx.update': ['Mouvement de caisse corrigé', 'caisse'],
  'caisse.tx.delete': ['Mouvement de caisse supprimé', 'trash'],

  // ── Transferts entre bureaux ──
  'transfer.send': ['Transfert envoyé', 'swap'],
  'transfer.receive': ['Transfert reçu', 'swap'],
  'transfer.receive.forced': ['Transfert reçu malgré un solde insuffisant', 'alert'],
  'transfer.update': ['Transfert modifié', 'swap'],
  'transfer.unreceive': ['Réception du transfert annulée', 'swap'],
  'transfer.delete': ['Transfert supprimé', 'trash'],

  // ── Personnes (fournisseurs & passagers) ──
  'person.create': ['Fiche créée', 'users'],
  'person.update': ['Fiche modifiée', 'users'],
  'person.activate': ['Fiche réactivée', 'users'],
  'person.deactivate': ['Fiche retirée', 'users'],
  'person.settle': ['Compte réglé', 'caisse'],
  'person.transaction': ['Opération sur un compte', 'coins'],
  'payment.update': ['Paiement corrigé', 'coins'],
  'payment.delete': ['Paiement annulé', 'trash'],

  // ── Stock & articles ──
  'stock.item.create': ['Article ajouté', 'stock'],
  'stock.item.update': ['Article modifié', 'stock'],
  'stock.item.delete': ['Article supprimé', 'trash'],
  'stock.item.set_active': ['Article activé / désactivé', 'stock'],
  'stock.category.create': ['Catégorie créée', 'tag'],
  'stock.category.update': ['Catégorie modifiée', 'tag'],
  'stock.category.delete': ['Catégorie supprimée', 'trash'],
  'stock.inventory': ['Inventaire saisi', 'stock'],
  'stock.movement.delete': ['Mouvement de stock supprimé', 'trash'],

  // ── Charges ──
  'charge.create': ['Charge enregistrée', 'chart'],
  'charge.update': ['Charge modifiée', 'chart'],
  'charge.delete': ['Charge supprimée', 'trash'],

  // ── Taux de change ──
  'rate.set': ['Taux de change mis à jour', 'taux'],
  'pair.create': ['Paire de devises ajoutée', 'taux'],
  'pair.set': ['Taux d’une paire modifié', 'taux'],
  'pair.reset': ['Paire recalculée depuis le dinar', 'taux'],
  'pair.delete': ['Paire supprimée', 'trash'],

  // ── Utilisateurs & système ──
  'admin.create': ['Utilisateur créé', 'users'],
  'admin.update': ['Utilisateur modifié', 'users'],
  'admin.set_active': ['Utilisateur activé / désactivé', 'users'],
  'admin.reset_password': ['Mot de passe réinitialisé', 'users'],
  'settings.update': ['Paramètres modifiés', 'gear'],
  'print.direct': ['Document imprimé', 'print'],
  'auth.login': ['Connexion', 'logout'],
  'auth.logout': ['Déconnexion', 'logout'],
  'auth.login_failed': ['Échec de connexion', 'alert'],
  'auth.change_password': ['Mot de passe changé', 'users'],
};

// De quoi parle l'action, et ce qu'on lui a fait : de quoi former une phrase
// pour une action que ce fichier ne connaît pas encore.
const DOMAIN = {
  bon: ['Bon passager', 'bon'],
  order: ['Bon fournisseur', 'order'],
  caisse: ['Caisse', 'caisse'],
  transfer: ['Transfert', 'swap'],
  person: ['Fiche', 'users'],
  payment: ['Paiement', 'coins'],
  stock: ['Stock', 'stock'],
  charge: ['Charge', 'chart'],
  rate: ['Taux de change', 'taux'],
  pair: ['Paire de devises', 'taux'],
  admin: ['Utilisateur', 'users'],
  settings: ['Paramètres', 'gear'],
  print: ['Impression', 'print'],
  auth: ['Session', 'logout'],
};

const VERB = {
  create: 'créé(e)',
  update: 'modifié(e)',
  delete: 'supprimé(e)',
  set: 'mis(e) à jour',
  set_active: 'activé(e) / désactivé(e)',
  activate: 'réactivé(e)',
  deactivate: 'retiré(e)',
  settle: 'réglé(e)',
  cancel: 'annulé(e)',
  send: 'envoyé(e)',
  receive: 'reçu(e)',
  status: 'changé(e) d’étape',
};

function fallbackLine(action) {
  const [head, ...rest] = String(action).split('.');
  const [subject, icon] = DOMAIN[head] ?? [head, 'audit'];
  const verb = VERB[rest.join('.')] ?? VERB[rest[rest.length - 1]] ?? rest.join(' ');
  return [`${subject} ${verb}`.trim(), icon];
}

const ROLE_FR = { fournisseur: 'fournisseur', passager: 'passager' };

// La deuxième ligne : de QUI ou de QUOI il s'agit. Sans elle, dix « Fiche
// créée » de suite ne disent rien.
function detailsOf(entry) {
  const d = entry.details ?? {};
  const bits = [];
  // Qui / quoi.
  if (d.reference) bits.push(d.reference);
  if (d.name) bits.push(d.name);
  if (d.full_name) bits.push(d.full_name);
  if (d.label) bits.push(d.label);
  if (d.username) bits.push(d.username);
  // Combien.
  if (d.amount != null) bits.push(`${formatMoney(d.amount)} ${d.currency ?? 'DZD'}`);
  if (d.dzd_per_unit != null) bits.push(`${d.dzd_per_unit} DZD`);
  if (d.rate != null) bits.push(`taux ${d.rate}`);
  // Dans quel sens.
  if (d.from && d.to) bits.push(`${d.from} → ${d.to}`);
  if (d.direction) bits.push(d.direction === 'in' ? 'entrée' : 'sortie');
  if (d.office) bits.push(OFFICE_LABEL[d.office] ?? d.office);
  // Le reste, seulement quand il dit quelque chose.
  if (Array.isArray(d.roles) && d.roles.length) bits.push(d.roles.map((r) => ROLE_FR[r] ?? r).join(', '));
  if (d.category) bits.push(d.category);
  if (d.type && !d.amount) bits.push(d.type);
  if (d.status) bits.push(d.status);
  if (d.counted != null) bits.push(`${d.counted} unités`);
  if (d.quantity != null) bits.push(`${d.quantity} unités`);
  if (d.manque != null) bits.push(`manque ${formatMoney(d.manque)}`);
  // Toujours dit : « Utilisateur activé / désactivé · admin2 » laisserait sinon
  // la question ouverte sur la seule ligne qui compte.
  if (d.active != null) bits.push(d.active ? 'activé' : 'désactivé');
  if (d.cible) bits.push(d.cible);
  if (d.reason) bits.push(d.reason);
  if (d.note && bits.length < 2) bits.push(d.note);
  return bits.slice(0, 3).join(' · ');
}

export function activityLine(entry) {
  const [label, icon] = ACTION_LABEL[entry.action] ?? fallbackLine(entry.action);
  return { label, icon, sub: detailsOf(entry) };
}

// Resolve an audit entry to the screen where the user can act on it. Bon = the
// passager document, order = the fournisseur document (see the rename).
export function entityHref(entry) {
  switch (entry.entity) {
    case 'bon': return `/bons-passager/${entry.entity_id}`;
    case 'order': return `/bons-fournisseur/${entry.entity_id}`;
    case 'person': return `/personnes/${entry.entity_id}`;
    case 'stock_item':
    case 'stock_movement':
    case 'stock_category': return '/stock';
    case 'charge': return '/charges';
    case 'office_transfer':
    case 'transaction':
    case 'conversion':
    case 'person_ledger':
    case 'caisse': return '/caisses';
    case 'currency':
    case 'currency_pair': return '/taux';
    case 'admin': return '/utilisateurs';
    case 'app_setting': return '/parametres';
    default: return '/audit';
  }
}
