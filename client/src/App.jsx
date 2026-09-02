import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { ToastProvider, Spinner, ErrorBoundary } from './components/ui.jsx';
import { Layout } from './components/Layout.jsx';
import { AnimatedBackground } from './components/AnimatedBackground.jsx';
import Login from './pages/Login.jsx';
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
import ProfilePage from './pages/ProfilePage.jsx';
import RapportsPage from './pages/RapportsPage.jsx';
import ImpressionsPage from './pages/ImpressionsPage.jsx';
import UtilisateursPage from './pages/UtilisateursPage.jsx';
import ParametresPage from './pages/ParametresPage.jsx';

function Protected({ children }) {
  const { admin, loading } = useAuth();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!admin) return <Navigate to="/login" replace />;
  return children;
}

// Admin-account management is super-admin only.
function SuperAdminOnly({ children }) {
  const { admin } = useAuth();
  return admin?.role === 'superadmin' ? children : <Navigate to="/" replace />;
}

// Redirect a legacy detail path (/ordres/:id, /bons/:id) to its new home,
// carrying the id through.
function LegacyRedirect({ to }) {
  const { id } = useParams();
  return <Navigate to={`${to}/${id}`} replace />;
}

function AppRoutes() {
  const { admin, loading } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <div className="center-screen"><Spinner /></div> : admin ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="caisses" element={<CaissesPage />} />
        <Route path="charges" element={<ChargesPage />} />
        <Route path="caisses/:id" element={<CaisseDetailPage />} />
        <Route path="bons-fournisseur" element={<OrdersPage />} />
        <Route path="bons-fournisseur/:id" element={<OrderDetailPage />} />
        <Route path="bons-passager" element={<BonsPage />} />
        <Route path="bons-passager/:id" element={<BonDetailPage />} />
        {/* Legacy paths → new bon routes (old bookmarks / links keep working). */}
        <Route path="ordres" element={<Navigate to="/bons-fournisseur" replace />} />
        <Route path="ordres/:id" element={<LegacyRedirect to="/bons-fournisseur" />} />
        <Route path="bons" element={<Navigate to="/bons-passager" replace />} />
        <Route path="bons/:id" element={<LegacyRedirect to="/bons-passager" />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="articles" element={<ArticlesPage />} />
        <Route path="articles/:id" element={<ArticleDetailPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="fournisseurs" element={<FournisseursPage />} />
        <Route path="fournisseurs/:id" element={<ProfilePage type="fournisseur" />} />
        <Route path="passagers" element={<PassagersPage />} />
        <Route path="passagers/:id" element={<ProfilePage type="passager" />} />
        <Route path="rapports" element={<RapportsPage />} />
        <Route path="impressions" element={<ImpressionsPage />} />
        <Route path="utilisateurs" element={<SuperAdminOnly><UtilisateursPage /></SuperAdminOnly>} />
        <Route path="parametres" element={<ParametresPage />} />
        <Route path="taux" element={<RatesPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        {/* One instance for the whole app: keeps running across route changes. */}
        <AnimatedBackground />
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
