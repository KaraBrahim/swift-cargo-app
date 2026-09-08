import { createContext, useContext, useRef, useCallback, useMemo, Component } from 'react';
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

// ── Notifications ────────────────────────────────────────────────────
// Une modale centrée, avec une icône qui se dessine, un X et une barre de
// temps. Elle remplace le rectangle gris qui s'affichait en bas à droite :
// sans icône, sans bouton, à l'opposé du regard de quelqu'un qui vient de
// cliquer au centre — un échec y passait aussi inaperçu qu'une réussite.
//
// Trois types, trois comportements, et la différence est délibérée :
//
//   succès / info — le fond N'EST PAS bloqué. `backdrop: false` suffit :
//     SweetAlert2 pose alors `body.swal2-no-backdrop`, qui met le conteneur
//     en `pointer-events: none` et laisse le popup cliquable. On continue
//     donc à travailler pendant que le message s'efface, et le défilement
//     de la page n'est pas verrouillé.
//   erreur — le fond EST bloqué et un bouton « Fermer » attend. C'est le
//     seul cas où il faut vraiment s'arrêter.
//
// L'API exposée ne change pas d'un caractère : { success, error, info }.
// Les 97 appels répartis dans les pages continuent de fonctionner tels quels.
const NotifyContext = createContext(null);
export const useNotify = () => useContext(NotifyContext);
// Ancien nom, gardé pour ne rien casser. Un « toast » qui est une modale est
// un nom qui ment ; le nouveau code doit écrire useNotify.
export const useToast = useNotify;

const KINDS = {
  // La durée suit le temps de lecture : « Bon réglé. » se lit en une
  // seconde, « Montant supérieur au reste dû : il reste 600,00 DZD » non.
  success: { icon: 'success', timer: 2500, blocking: false },
  info: { icon: 'info', timer: 4000, blocking: false },
  error: { icon: 'error', timer: 7000, blocking: true },
};

const TITLES = { success: 'Opération réussie', info: 'Information', error: 'Échec de l’opération' };

// Chargée au premier message, jamais au démarrage : le bundle pèse déjà plus
// d'un mégaoctet et aucune notification n'est nécessaire au premier rendu.
// Vite en fait un morceau séparé, feuille de style comprise.
let swalPromise = null;
const loadSwal = () => {
  if (!swalPromise) swalPromise = import('sweetalert2').then((m) => m.default);
  return swalPromise;
};

export function NotifyProvider({ children }) {
  // `Swal.fire()` remplace la modale visible par la nouvelle. Pour un succès
  // tant mieux — le dernier compte. Pour une erreur c'est inacceptable : deux
  // échecs coup sur coup n'en montreraient qu'un. D'où cette file.
  const queue = useRef([]);
  const showing = useRef(false);

  const drain = useCallback(async () => {
    if (showing.current) return;
    const next = queue.current.shift();
    if (!next) return;
    showing.current = true;
    try {
      const Swal = await loadSwal();
      const kind = KINDS[next.kind] ? next.kind : 'info';
      const k = KINDS[kind];
      await Swal.fire({
        icon: k.icon,
        title: TITLES[kind],
        text: next.message,
        timer: k.timer,
        timerProgressBar: true,
        showCloseButton: true,
        showConfirmButton: k.blocking,
        confirmButtonText: 'Fermer',
        backdrop: k.blocking,
        allowOutsideClick: true,
        allowEscapeKey: true,
        // Sans ça, SweetAlert2 impose une hauteur au <body> et la page saute
        // d'un cran à chaque message.
        heightAuto: false,
        // Ne pas voler le curseur d'une saisie en cours, et le lui rendre.
        focusConfirm: false,
        returnFocus: true,
        customClass: {
          popup: `sc-notify-${kind}`,
          container: k.blocking ? 'sc-notify-blocking' : 'sc-notify-passthrough',
        },
      });
    } catch {
      // Le module n'a pas pu être chargé (hors ligne au tout premier message).
      // Un message perdu ne doit pas emporter le geste qui l'a déclenché.
    } finally {
      showing.current = false;
      drain();
    }
  }, []);

  const push = useCallback(
    (message, kind) => {
      // Un plafond, pour qu'une boucle qui s'emballe ne fasse pas défiler
      // quarante modales à la suite. Les erreurs passent devant : ce sont
      // elles qu'il ne faut jamais perdre.
      if (queue.current.length >= 5) {
        if (kind !== 'error') return;
        queue.current.splice(0, 1);
      }
      queue.current.push({ message: String(message ?? ''), kind });
      drain();
    },
    [drain]
  );

  const notify = useMemo(
    () => ({
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error'),
      info: (m) => push(m, 'info'),
    }),
    [push]
  );

  return <NotifyContext.Provider value={notify}>{children}</NotifyContext.Provider>;
}

// Ancien nom du provider — App.jsx le monte encore sous celui-ci.
export const ToastProvider = NotifyProvider;

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
