// Un seul contrôle d'impression, pour tous les écrans.
//
// Chaque document sort en A4 ou en ticket (80 / 58 mm), imprimé par le
// navigateur ou enregistré en PDF — sur le poste, avec une vraie boîte
// d'enregistrement. La page fournit le document une fois (`a4`, `ticket`) ;
// le menu, l'en-tête de la société et le format mémorisé sont ici.
import { useState, useRef, useEffect } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { IconEl } from './icons.jsx';
import { useToast, errorMessage } from './ui.jsx';
import { printHtml, printWindowHtml } from './printDocument.js';
import { ticketWindowHtml } from './printTicket.js';

// Le poste de travail expose window.desk (desktop/desk-preload.js) : lui seul
// peut écrire un fichier sur cette machine. Dans un navigateur, « Enregistrer
// en PDF » passe par la boîte d'impression, qui le propose déjà.
const desk = () => (typeof window !== 'undefined' && typeof window.desk?.savePdf === 'function' ? window.desk : null);

// Le dernier format choisi revient en tête : on imprime presque toujours pareil.
const FORMAT_KEY = 'sc_print_format';
const lastFormat = () => { try { return localStorage.getItem(FORMAT_KEY); } catch { return null; } };
const rememberFormat = (k) => { try { localStorage.setItem(FORMAT_KEY, k); } catch { /* mode privé */ } };

const BROWSER_FORMATS = [
  { key: 'a4', label: 'A4 / PDF', hint: 'Document classique, pour archive ou e-mail' },
  { key: '80', label: 'Ticket 80 mm', hint: 'Via le navigateur — rouleau standard' },
  { key: '58', label: 'Ticket 58 mm', hint: 'Via le navigateur — rouleau compact' },
];

export function PrintButton({
  title,          // window/document title
  docTitle,       // heading printed on the A4 document
  subtitle,
  a4,             // () => html string (A4 body)
  ticket,         // (societe) => html string (roll body); omit to hide roll options
  label = 'Imprimer',
  className = 'btn btn-ghost',
  disabled = false,
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const settings = useApi('/settings');
  const societe = settings.data?.settings?.societe;

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Le même HTML sert à imprimer et à enregistrer.
  const buildHtml = (format) => (format === 'a4'
    ? printWindowHtml({ title, societe, docTitle: docTitle || title, subtitle, body: a4() })
    : ticketWindowHtml({ title, mm: Number(format), body: ticket(societe) }));

  const runBrowser = (format) => {
    setOpen(false);
    rememberFormat(format);
    try {
      printHtml(buildHtml(format));
    } catch (err) {
      toast.error(`Impression impossible : ${err.message}`);
    }
  };

  const runSave = async (format) => {
    setOpen(false);
    rememberFormat(format);
    try {
      const html = buildHtml(format);
      if (!desk()) { printHtml(html); return; } // la boîte d'impression propose « Enregistrer en PDF »
      const res = await desk().savePdf({ html, title, widthMm: format === 'a4' ? null : Number(format) });
      if (res.saved) toast.success(`PDF enregistré : ${res.path}`);
    } catch (err) {
      toast.error(`Enregistrement impossible : ${err.message}`);
    }
  };

  const all = ticket ? BROWSER_FORMATS : BROWSER_FORMATS.slice(0, 1);
  const last = lastFormat();
  const formats = [...all].sort((x, y) => (x.key === last ? -1 : y.key === last ? 1 : 0));

  // Nothing to choose from: no roll builder and no printer — print A4 directly.
  if (formats.length === 1) {
    return (
      <button className={className} onClick={() => runBrowser('a4')} disabled={disabled}>
        <IconEl name="print" />{label}
      </button>
    );
  }

  return (
    <div className="pop-wrap" ref={ref}>
      <button className={className} onClick={() => setOpen((o) => !o)} disabled={disabled || busy} aria-haspopup="menu" aria-expanded={open}>
        <IconEl name="print" />{busy ? 'Impression…' : label}
      </button>
      {open && (
        <div className="pop pop-print" role="menu">
          <div className="pop-section">
            <div className="pop-section-title">Imprimer</div>
            {formats.map((f) => (
              <button key={f.key} className="print-opt" role="menuitem" onClick={() => runBrowser(f.key)}>
                <span className="print-opt-label">{f.label}</span>
                <span className="print-opt-hint">{f.hint}</span>
              </button>
            ))}
          </div>
          <div className="pop-section">
            <div className="pop-section-title">{desk() ? 'Enregistrer en PDF' : 'Enregistrer en PDF (via la boîte d’impression)'}</div>
            {formats.map((f) => (
              <button key={`pdf-${f.key}`} className="print-opt" role="menuitem" onClick={() => runSave(f.key)}>
                <span className="print-opt-label"><IconEl name="download" />{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
