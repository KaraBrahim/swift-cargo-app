import { createContext, useContext, useState, useCallback, Component } from 'react';
import { IconEl } from './icons.jsx';
import { formatMoney as fmtMoney } from '../lib/format.js';

// ── Money formatting ─────────────────────────────────────────────────
// Re-exported, not defined here: the same function formats the printed
// documents, which cannot import a .jsx module. See lib/format.js.
export { formatMoney, formatNumber, formatQty } from '../lib/format.js';

// A big amount must never wrap AND must never spill out of its card: a balance
// broken over two lines stops reading as one number, and one that runs under
// the next card hides its own digits — worse, because it looks complete.
//
// Guessing the size from the character count alone was not enough: it does not
// know how wide the box actually is. So the count is published as a CSS
// variable and the stylesheet does the arithmetic against the real container
// width (see --amount-chars in styles.css). Container queries make this exact
// at any window size, with no measuring in JavaScript and no reflow loop.
export function fitStyle(text) {
  return { '--amount-chars': String(text).length };
}

export function Money({ value, code, className, as: Tag = 'span' }) {
  const text = fmtMoney(value, code);
  return <Tag className={className} style={fitStyle(text)}>{text}</Tag>;
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
  // An unexpected error carries a short reference; the same string is in the
  // server log next to the full stack, so a screenshot is enough to find it.
  const base = err.message || 'Erreur.';
  return err.ref ? `${base} (référence ${err.ref})` : base;
}

// ── Page header (icon + title + subtitle + actions), accent per module ──
export function PageHeader({ icon, title, subtitle, accent, children }) {
  return (
    <div className="page-head" style={accent ? { '--accent': accent } : undefined}>
      <div>
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
