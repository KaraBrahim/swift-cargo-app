// A styled confirmation modal — replaces the browser's native confirm(). Used for
// risky actions like stepping a bon's status backward (which reverses stock and
// money). Escape or a backdrop click cancels; the confirm button can show a tone.
import { useEffect, useRef } from 'react';
import { IconEl } from './icons.jsx';

export function ConfirmDialog({
  open, title, message, bullets, confirmLabel = 'Confirmer', cancelLabel = 'Annuler',
  // A third way out, for the case where "confirm or go back" is a false choice:
  // confirming a transfer the sending caisse can no longer cover leaves a real
  // decision to make — force it, or cancel the transfer entirely.
  extraLabel, onExtra,
  tone = 'danger', busy = false, onConfirm, onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
      if (e.key === 'Enter') onConfirm?.();
    };
    window.addEventListener('keydown', onKey);
    confirmRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div className="modal-card" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={`modal-icon ${tone}`}><IconEl name="alert" /></div>
        <h3 className="modal-title">{title}</h3>
        {message && <p className="modal-msg">{message}</p>}
        {bullets?.length > 0 && (
          <ul className="modal-bullets">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            <IconEl name="close" />{cancelLabel}
          </button>
          {extraLabel && (
            <button type="button" className="btn btn-danger" onClick={onExtra} disabled={busy}>{extraLabel}</button>
          )}
          <button
            type="button"
            ref={confirmRef}
            className={`btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-gold'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
