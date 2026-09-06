import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import { ToastProvider, Spinner, ErrorBoundary } from './components/ui.jsx';
import { Layout } from './components/Layout.jsx';
import { AnimatedBackground } from './components/AnimatedBackground.jsx';
import Login from './pages/Login.jsx';

function Protected({ children }) {
  const { admin, loading } = useAuth();
  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!admin) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { admin, loading } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <div className="center-screen"><Spinner /></div> : admin ? <Navigate to="/" replace /> : <Login />}
      />
      {/* Une seule route pour toute l'application : les pages sont montées par
          onglet dans Layout (voir routes.jsx), pas par le routeur ici. */}
      <Route
        path="/*"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      />
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
