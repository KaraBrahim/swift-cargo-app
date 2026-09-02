import { createContext, useContext, useState, useCallback, Component } from 'react';
import { IconEl } from './icons.jsx';

// ── Money formatting (fr-FR, always 2 decimals) ──────────────────────
export function formatMoney(value, code) {
  const n = Number(value);
  const s = Number.isFinite(n)
    ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value);
  return code ? `${s} ${code}` : s;
}

export function Money({ value, code, className }) {
  return <span className={className}>{formatMoney(value, code)}</span>;
}

// ── Toast notifications ──────────────────────────────────────────────
const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message, type = 'info') => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => remove(id), 4500);
    },
    [remove]
  );
  const toast = {
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
  };
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => remove(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Turn an ApiError into a readable message (includes validation field details).
export function errorMessage(err) {
  if (!err) return 'Erreur inconnue.';
  if (err.details && Array.isArray(err.details)) {
    const parts = err.details.map((d) => (d.field ? `${d.field} : ${d.message}` : d.message));
    return `${err.message} (${parts.join(' ; ')})`;
  }
  if (err.details && typeof err.details === 'object' && err.details.available != null) {
    return `${err.message} Disponible : ${err.details.available} ${err.details.currency}.`;
  }
  return err.message || 'Erreur.';
}

// ── Page header (icon + title + subtitle + actions), accent per module ──
export function PageHeader({ icon, title, subtitle, accent, back, children }) {
  return (
    <div className="page-head" style={accent ? { '--accent': accent } : undefined}>
      <div>
        {back}
        <div className="page-title-row">
          {icon && <div className="page-ico"><IconEl name={icon} /></div>}
          <div>
            <h1>{title}</h1>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
        </div>
      </div>
      {children && <div className="profile-actions">{children}</div>}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────
export function EmptyState({ icon = 'inbox', title = 'Rien à afficher', sub, children }) {
  return (
    <div className="empty">
      <div className="empty-ico"><IconEl name={icon} /></div>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {children}
    </div>
  );
}

// ── Spinner ──────────────────────────────────────────────────────────
export function Spinner({ label = 'Chargement…' }) {
  return (
    <div className="spinner">
      <div className="spinner-dot" />
      <span>{label}</span>
    </div>
  );
}

// ── Error boundary (catches render-time crashes) ─────────────────────
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="panel error-panel">
          <h2>Une erreur est survenue</h2>
          <p>{String(this.state.error.message || this.state.error)}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
