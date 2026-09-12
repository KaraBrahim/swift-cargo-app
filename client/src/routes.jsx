import { Routes, Route } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { EmptyState } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CaissesPage from './pages/CaissesPage.jsx';
import CaisseDetailPage from './pages/CaisseDetailPage.jsx';
import RatesPage from './pages/RatesPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import BonsPage from './pages/BonsPage.jsx';
import BonDetailPage from './pages/BonDetailPage.jsx';
import FournisseursPage from './pages/FournisseursPage.jsx';
import PassagersPage from './pages/PassagersPage.jsx';
import StockPage from './pages/StockPage.jsx';
import ArticlesPage from './pages/ArticlesPage.jsx';
import ArticleDetailPage from './pages/ArticleDetailPage.jsx';
import CategoriesPage from './pages/CategoriesPage.jsx';
import ChargesPage from './pages/ChargesPage.jsx';
import OrdersPage from './pages/OrdersPage.jsx';
import OrderDetailPage from './pages/OrderDetailPage.jsx';
import OrderGoodsPage from './pages/OrderGoodsPage.jsx';
import NewOrderPage from './pages/NewOrderPage.jsx';
import NewBonPage from './pages/NewBonPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import RapportsPage from './pages/RapportsPage.jsx';
import ImpressionsPage from './pages/ImpressionsPage.jsx';
import UtilisateursPage from './pages/UtilisateursPage.jsx';
import MaintenancePage from './pages/MaintenancePage.jsx';
import ParametresPage from './pages/ParametresPage.jsx';

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
  );
}
