// Gear button + settings popover: the two appearance settings — theme and
// font — each presented as cards that preview themselves.
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { IconEl } from './icons.jsx';
import { FontGrid } from './FontPicker.jsx';
import { ThemeGrid } from './ThemePicker.jsx';

// Close on outside click or Escape.
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

export function SettingsMenu({ compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div className="pop-wrap" ref={ref}>
      <button
        className={`icon-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Paramètres"
        aria-label="Paramètres"
        aria-expanded={open}
      >
        <IconEl name="gear" />
        {!compact && <span className="icon-btn-label">Paramètres</span>}
      </button>

      {open && (
        <div className="pop pop-settings" role="dialog" aria-label="Paramètres">
          <div className="pop-head">
            <span>Paramètres</span>
            <button className="pop-x" onClick={() => setOpen(false)} aria-label="Fermer">
              <IconEl name="close" />
            </button>
          </div>

          <div className="pop-scroll">
            <div className="pop-section">
              <div className="pop-section-title">Thème</div>
              <ThemeGrid />
            </div>

            <div className="pop-section">
              <div className="pop-section-title">Police</div>
              <FontGrid />
            </div>

            <Link className="pop-item" to="/parametres" onClick={() => setOpen(false)}>
              <IconEl name="settings" />
              <span>Tous les paramètres</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
