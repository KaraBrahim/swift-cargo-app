import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { EmptyState, Spinner } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
// Chaque page arrive quand on l'ouvre, pas toutes au premier écran : le serveur
// est loin, et un seul fichier d'un mégaoctet retardait le tableau de bord de
// tout ce qu'on n'y utilise pas (graphiques des taux, calendrier, QR…).
const CaissesPage = lazy(() => import('./pages/CaissesPage.jsx'));
const CaisseDetailPage = lazy(() => import('./pages/CaisseDetailPage.jsx'));
const RatesPage = lazy(() => import('./pages/RatesPage.jsx'));
const AuditPage = lazy(() => import('./pages/AuditPage.jsx'));
const BonsPage = lazy(() => import('./pages/BonsPage.jsx'));
const BonDetailPage = lazy(() => import('./pages/BonDetailPage.jsx'));
const FournisseursPage = lazy(() => import('./pages/FournisseursPage.jsx'));
const PassagersPage = lazy(() => import('./pages/PassagersPage.jsx'));
const StockPage = lazy(() => import('./pages/StockPage.jsx'));
const ArticlesPage = lazy(() => import('./pages/ArticlesPage.jsx'));
const ArticleDetailPage = lazy(() => import('./pages/ArticleDetailPage.jsx'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage.jsx'));
const ChargesPage = lazy(() => import('./pages/ChargesPage.jsx'));
const OrdersPage = lazy(() => import('./pages/OrdersPage.jsx'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage.jsx'));
const OrderGoodsPage = lazy(() => import('./pages/OrderGoodsPage.jsx'));
const NewOrderPage = lazy(() => import('./pages/NewOrderPage.jsx'));
const NewBonPage = lazy(() => import('./pages/NewBonPage.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const RapportsPage = lazy(() => import('./pages/RapportsPage.jsx'));
const ImpressionsPage = lazy(() => import('./pages/ImpressionsPage.jsx'));
const UtilisateursPage = lazy(() => import('./pages/UtilisateursPage.jsx'));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage.jsx'));
const ParametresPage = lazy(() => import('./pages/ParametresPage.jsx'));

// Les pages de l'application, rendues pour UNE adresse donnée.
//
// Chaque onglet ouvert monte cet arbre avec sa propre adresse : c'est ce qui
// permet à plusieurs pages d'exister en même temps, celle de l'onglet actif
// affichée et les autres en attente, formulaire intact.
//
// Aucune redirection ici, volontairement : un <Navigate> dans un onglet
// d'arrière-plan changerait l'adresse de la fenêtre entière, donc la page qu'on
// est en train de lire. Les anciennes adresses sont corrigées à l'ouverture de
// l'onglet (normalizePath), et ce qui reste introuvable le dit sans bouger.

function UnknownPage() {
  return (
    <EmptyState
      icon="help"
      title="Page introuvable"
      sub="Cette adresse ne correspond à aucune page de l'application."
    />
  );
}

function SuperAdminOnly({ children }) {
  const { admin } = useAuth();
  if (admin?.role === 'superadmin') return children;
  return (
    <EmptyState
      icon="audit"
      title="Réservé au super-administrateur"
      sub="La gestion des utilisateurs n'est pas accessible depuis ce compte."
    />
  );
}

export function AppPages({ path }) {
  return (
    <Suspense fallback={<Spinner />}>
    <Routes location={path}>
      <Route path="/" element={<Dashboard />} />
      <Route path="/caisses" element={<CaissesPage />} />
      <Route path="/caisses/:id" element={<CaisseDetailPage />} />
      <Route path="/charges" element={<ChargesPage />} />
      <Route path="/bons-fournisseur" element={<OrdersPage />} />
      <Route path="/bons-fournisseur/nouveau" element={<NewOrderPage />} />
      <Route path="/bons-fournisseur/:id" element={<OrderDetailPage />} />
      {/* Modifier les marchandises d'un bon fournisseur, sans sortir de sa
          section : l'écran est celui d'un bon, l'adresse reste celle de l'ordre. */}
      <Route path="/bons-fournisseur/:id/marchandises" element={<OrderGoodsPage />} />
      <Route path="/bons-passager" element={<BonsPage />} />
      <Route path="/bons-passager/nouveau" element={<NewBonPage />} />
      <Route path="/bons-passager/:id" element={<BonDetailPage />} />
      <Route path="/stock" element={<StockPage />} />
      <Route path="/articles" element={<ArticlesPage />} />
      <Route path="/articles/:id" element={<ArticleDetailPage />} />
      <Route path="/categories" element={<CategoriesPage />} />
      <Route path="/fournisseurs" element={<FournisseursPage />} />
      <Route path="/passagers" element={<PassagersPage />} />
      <Route path="/personnes/:id" element={<ProfilePage />} />
      <Route path="/rapports" element={<RapportsPage />} />
      <Route path="/impressions" element={<ImpressionsPage />} />
      <Route path="/utilisateurs" element={<SuperAdminOnly><UtilisateursPage /></SuperAdminOnly>} />
      <Route path="/maintenance" element={<SuperAdminOnly><MaintenancePage /></SuperAdminOnly>} />
      <Route path="/parametres" element={<ParametresPage />} />
      <Route path="/taux" element={<RatesPage />} />
      <Route path="/audit" element={<AuditPage />} />
      <Route path="*" element={<UnknownPage />} />
    </Routes>
    </Suspense>
  );
}
