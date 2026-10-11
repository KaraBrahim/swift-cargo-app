// A styled confirmation modal — replaces the browser's native confirm(). Used for
// risky actions like stepping a bon's status backward (which reverses stock and
// money). Escape or a backdrop click cancels; the confirm button can show a tone.
//
// Deux garde-fous contre le geste réflexe :
//   • Entrée n'est plus écoutée sur toute la fenêtre. Elle valait « Confirmer »
//     même quand le focus était sur « Annuler » — on tabulait vers Annuler, on
//     appuyait sur Entrée, et l'action partait. Désormais Entrée active le bouton
//     qui a le focus, comme n'importe quel bouton.
//   • Pour une action destructrice, le focus d'ouverture est sur « Annuler ».
//   • Les premières 450 ms, « Confirmer » ne répond pas : l'Entrée qui a ouvert la
//     boîte (ou son rebond) ne doit pas aussi la fermer en confirmant.
import { useEffect, useRef } from 'react';
import { IconEl } from './icons.jsx';

const ARM_MS = 450;

export function ConfirmDialog({
  open, title, message, bullets, children, confirmLabel = 'Confirmer', cancelLabel = 'Annuler',
  // A third way out, for the case where "confirm or go back" is a false choice:
  // confirming a transfer the sending caisse can no longer cover leaves a real
  // decision to make — force it, or cancel the transfer entirely.
  extraLabel, onExtra,
  tone = 'danger', icon = 'alert', wide = false, confirmDisabled = false,
  busy = false, onConfirm, onCancel,
}) {
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const openedAt = useRef(0);
  // Les rappels changent à chaque rendu : on les lit par ref pour ne pas
  // ré-attacher l'écouteur (ni rejouer l'effet de focus) à chaque frappe.
  const cancelFn = useRef(onCancel);
  cancelFn.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    openedAt.current = Date.now();
    const onKey = (e) => { if (e.key === 'Escape') cancelFn.current?.(); };
    window.addEventListener('keydown', onKey);
    (tone === 'danger' ? cancelRef : confirmRef).current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, tone]);

  if (!open) return null;

  const confirm = () => {
    if (Date.now() - openedAt.current < ARM_MS) return;
    onConfirm?.();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div className={`modal-card ${wide ? 'modal-wide' : ''}`} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={`modal-icon ${tone}`}><IconEl name={icon} /></div>
        <h3 className="modal-title">{title}</h3>
        {message && <p className="modal-msg">{message}</p>}
        {children}
        {bullets?.length > 0 && (
          <ul className="modal-bullets">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" ref={cancelRef} className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            <IconEl name="close" />{cancelLabel}
          </button>
          {extraLabel && (
            <button type="button" className="btn btn-danger" onClick={onExtra} disabled={busy}>{extraLabel}</button>
          )}
          <button
            type="button"
            ref={confirmRef}
            className={`btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-gold'}`}
            onClick={confirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
