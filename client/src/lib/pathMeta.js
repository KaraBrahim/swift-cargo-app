// Comment une adresse se nomme et s'illustre — pour les onglets, les flèches de
// navigation et tout ce qui doit dire « où » sans montrer une URL.

// L'ordre compte : le premier préfixe qui correspond gagne, donc les chemins les
// plus longs d'abord quand deux se ressemblent.
const PAGES = [
  ['/bons-fournisseur', 'Bons fournisseurs', 'order'],
  ['/bons-passager', 'Bons passagers', 'bon'],
  ['/caisses', 'Caisse & Finance', 'caisse'],
  ['/charges', 'Charges', 'wallet'],
  ['/stock', 'Stock', 'stock'],
  ['/articles', 'Articles', 'box'],
  ['/categories', 'Catégories', 'tag'],
  ['/passagers', 'Passagers', 'passager'],
  ['/fournisseurs', 'Fournisseurs', 'fournisseur'],
  ['/personnes', 'Fiche', 'users'],
  ['/rapports', 'Rapports', 'report'],
  ['/impressions', 'Impressions', 'print'],
  ['/taux', 'Taux de change', 'taux'],
  ['/utilisateurs', 'Utilisateurs', 'users'],
  ['/audit', "Journal d'audit", 'audit'],
  ['/parametres', 'Paramètres', 'gear'],
];

// Les adresses d'avant les renommages. Un onglet ouvert dessus doit atterrir sur
// la bonne page sans faire de redirection : une redirection dans un onglet
// d'arrière-plan changerait l'adresse de celui qu'on est en train de lire.
export function normalizePath(pathname) {
  const p = (pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  const m = (re, to) => p.replace(re, to);
  if (p === '/bons') return '/bons-passager';
  if (/^\/bons\/\d+$/.test(p)) return m(/^\/bons/, '/bons-passager');
  if (p === '/ordres') return '/bons-fournisseur';
  if (/^\/ordres\/\d+$/.test(p)) return m(/^\/ordres/, '/bons-fournisseur');
  // Fournisseur et passager sont deux rôles d'une même fiche (migration 022).
  if (/^\/(fournisseurs|passagers)\/\d+$/.test(p)) return p.replace(/^\/\w+/, '/personnes');
  return p;
}

// { title, icon } d'une adresse. Une fiche garde le nom de sa section jusqu'à ce
// que la page elle-même annonce le sien (voir useTabTitle) : « Bons passagers »
// puis « BP-HUB-00003 » une fois le bon chargé.
export function pathMeta(pathname) {
  const p = normalizePath(pathname);
  if (p === '/') return { title: 'Tableau de bord', icon: 'dashboard' };
  // Les écrans de création portent leur propre nom : « Bons passagers · fiche »
  // ne dirait pas qu'un formulaire à moitié rempli attend dans cet onglet.
  if (p === '/bons-fournisseur/nouveau') return { title: 'Nouveau bon fournisseur', icon: 'plus' };
  if (p === '/bons-passager/nouveau') return { title: 'Nouveau bon passager', icon: 'plus' };
  const hit = PAGES.find(([base]) => p === base || p.startsWith(`${base}/`));
  if (!hit) return { title: 'Page inconnue', icon: 'help' };
  const [base, label, icon] = hit;
  return { title: p === base ? label : `${label} · fiche`, icon };
}
