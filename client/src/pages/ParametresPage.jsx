import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, errorMessage, useToast, PageHeader } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { FontGrid } from '../components/FontPicker.jsx';

const ACCENT = 'var(--c-audit)';

// The theme is a per-machine preference, not shared server state: the Algérie desk
// can run the light theme while Chine keeps the dark one. So it is saved in this
// browser only, while everything else on this page is stored server-side.
function ThemeSection() {
  const { themeId, themes, setTheme } = useTheme();
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Thème</h2>
        <span className="muted" style={{ fontSize: '0.76rem' }}>Enregistré sur ce poste uniquement</span>
      </div>
      <div className="theme-grid theme-grid-wide">
        {themes.map((t) => (
          <button
            key={t.id}
            className={`theme-card ${themeId === t.id ? 'active' : ''}`}
            onClick={() => setTheme(t.id)}
            aria-pressed={themeId === t.id}
          >
            <span className="theme-preview">
              {t.swatch.map((c, i) => <span key={i} className="theme-dot" style={{ background: c }} />)}
              {themeId === t.id && <span className="theme-check"><IconEl name="check" /></span>}
            </span>
            <span className="theme-name">{t.name}</span>
            <span className="theme-hint">{t.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Same story as the theme: a per-machine preference. Each family is corrected
// in theme/fonts.css so switching changes the look without changing how much
// room the tables and the sidebar need.
function FontSection() {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Police</h2>
        <span className="muted" style={{ fontSize: '0.76rem' }}>Enregistré sur ce poste uniquement</span>
      </div>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: -4, marginBottom: 12 }}>
        Chaque police est calibrée pour occuper la même place à l'écran : les tableaux et le
        menu gardent exactement la même densité. « Système » n'a rien à télécharger — à choisir
        si le poste n'accède pas à Internet.
      </p>
      <FontGrid wide />
    </div>
  );
}

const PRINT_MODES = [
  { key: 'navigateur', label: 'Navigateur', hint: 'Pas d’impression directe : les documents passent par la fenêtre d’impression.' },
  { key: 'reseau', label: 'Réseau', hint: 'Imprimante avec une adresse IP sur le réseau local. Le mode à préférer.' },
  { key: 'windows', label: 'USB / Windows', hint: 'Imprimante branchée sur ce poste et installée dans Windows.' },
  { key: 'fichier', label: 'Fichier', hint: 'Écrit le ticket dans un fichier — pour vérifier une mise en page sans gâcher de papier.' },
];

// Direct printing: what turns « Imprimer » on a bon into paper coming out of the
// thermal printer, instead of a browser print dialog.
//
// The settings live on the server, but each desk runs its own server — so each
// desk keeps its own printer, and Chine can be on USB while Alger is on the
// network.
function ImpressionSection() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/print/status');
  const [cfg, setCfg] = useState(null);
  const [printers, setPrinters] = useState([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (data?.config) setCfg(data.config);
    if (data?.printers?.length) setPrinters(data.printers);
  }, [data]);

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const loadPrinters = async () => {
    setBusy('printers');
    try {
      const res = await api('/print/printers');
      setPrinters(res.printers);
      if (!res.printers.length) toast.error('Aucune imprimante installée trouvée sur ce poste.');
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(''); }
  };

  const save = async () => {
    setBusy('save');
    try {
      await api('/settings/impression', { method: 'PUT', body: cfg });
      toast.success('Configuration d’impression enregistrée.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(''); }
  };

  // Tested with the values currently on screen, not the saved ones: a new
  // printer can be tried before committing to it.
  const test = async () => {
    setBusy('test');
    try {
      const res = await api('/print/test', { method: 'POST', body: cfg });
      toast.success(res.message || 'Ticket de test envoyé.');
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(''); }
  };

  if (loading) return <div className="panel"><Spinner /></div>;
  if (error) return <div className="panel"><div className="alert alert-error">{error}</div></div>;
  if (!cfg) return null;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Impression directe</h2>
        <span className="muted" style={{ fontSize: '0.76rem' }}>Imprimante de ce bureau</span>
      </div>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: -4, marginBottom: 12 }}>
        Une fois configurée, « Imprimer » sur un bon envoie le ticket directement à l’imprimante
        thermique — sans fenêtre ni boîte de dialogue. L’impression par le navigateur (A4, PDF,
        rouleau) reste toujours disponible.
      </p>

      <div className="theme-grid theme-grid-wide" style={{ marginBottom: 16 }}>
        {PRINT_MODES.map((m) => (
          <button
            key={m.key}
            className={`theme-card ${cfg.mode === m.key ? 'active' : ''}`}
            onClick={() => { set({ mode: m.key }); if (m.key === 'windows' && !printers.length) loadPrinters(); }}
            aria-pressed={cfg.mode === m.key}
          >
            <span className="theme-name">{m.label}</span>
            <span className="theme-hint">{m.hint}</span>
          </button>
        ))}
      </div>

      <div className="op-form">
        {cfg.mode === 'reseau' && (
          <>
            <label className="field field-grow"><span>Adresse IP ou nom d’hôte</span>
              <input value={cfg.hote} placeholder="192.168.1.50"
                onChange={(e) => set({ hote: e.target.value })} /></label>
            <label className="field"><span>Port</span>
              <input type="number" value={cfg.port} onChange={(e) => set({ port: e.target.value })} /></label>
          </>
        )}

        {cfg.mode === 'windows' && (
          <>
            <label className="field field-grow"><span>Imprimante installée</span>
              <select value={cfg.imprimante} onChange={(e) => set({ imprimante: e.target.value })}>
                <option value="">— choisir —</option>
                {/* A saved printer that is currently switched off is absent from
                    the list; keep it selected rather than silently clearing it. */}
                {cfg.imprimante && !printers.some((p) => p.Name === cfg.imprimante) && (
                  <option value={cfg.imprimante}>{cfg.imprimante} (non détectée)</option>
                )}
                {printers.map((p) => <option key={p.Name} value={p.Name}>{p.Name}</option>)}
              </select></label>
            <button type="button" className="btn" onClick={loadPrinters} disabled={busy === 'printers'}>
              <IconEl name="refresh" />{busy === 'printers' ? 'Recherche…' : 'Rechercher'}
            </button>
          </>
        )}

        {cfg.mode === 'fichier' && (
          <label className="field field-grow"><span>Chemin du fichier</span>
            <input value={cfg.fichier} placeholder="C:\tickets\ticket.bin"
              onChange={(e) => set({ fichier: e.target.value })} /></label>
        )}

        {cfg.mode !== 'navigateur' && (
          <>
            <label className="field"><span>Largeur du rouleau</span>
              <select value={cfg.largeur} onChange={(e) => set({ largeur: Number(e.target.value) })}>
                <option value={80}>80 mm (48 caractères)</option>
                <option value={58}>58 mm (32 caractères)</option>
              </select></label>
            <label className="field"><span>Modèle</span>
              <select value={cfg.type} onChange={(e) => set({ type: e.target.value })}>
                <option value="epson">Epson (le plus courant)</option>
                <option value="star">Star</option>
                <option value="tanca">Tanca</option>
                <option value="daruma">Daruma</option>
                <option value="brother">Brother</option>
              </select></label>
            <label className="field"><span>Jeu de caractères</span>
              <select value={cfg.jeu_caracteres} onChange={(e) => set({ jeu_caracteres: e.target.value })}>
                <option value="PC858_EURO">PC858 — accents + €</option>
                <option value="WPC1252">Windows-1252</option>
                <option value="PC437_USA">PC437 — sans accents</option>
              </select></label>
            <label className="field"><span>Copies</span>
              <input type="number" min="1" max="5" value={cfg.copies}
                onChange={(e) => set({ copies: e.target.value })} /></label>
            <label className="check-row"><input type="checkbox" checked={cfg.couper}
              onChange={(e) => set({ couper: e.target.checked })} /><span>Couper le papier</span></label>
            <label className="check-row"><input type="checkbox" checked={cfg.tiroir}
              onChange={(e) => set({ tiroir: e.target.checked })} /><span>Ouvrir le tiroir-caisse</span></label>
          </>
        )}
      </div>

      {/* Reachability as measured by the server, not guessed from the form. */}
      {cfg.mode !== 'navigateur' && data && (
        cfg.mode === data.config.mode ? (
          <div className={`alert ${data.ok ? 'alert-ok' : 'alert-warn'}`} style={{ marginTop: 12 }}>
            {data.message}
          </div>
        ) : (
          <div className="alert alert-warn" style={{ marginTop: 12 }}>
            Mode non enregistré. « Imprimer un ticket de test » utilise les valeurs ci-dessus ;
            « Enregistrer » les applique à tout le système.
          </div>
        )
      )}

      <div className="op-form" style={{ marginTop: 12 }}>
        <button className="btn btn-gold" onClick={save} disabled={busy === 'save'}>
          {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn" onClick={test} disabled={busy === 'test' || cfg.mode === 'navigateur'}>
          <IconEl name="print" />{busy === 'test' ? 'Envoi…' : 'Imprimer un ticket de test'}
        </button>
      </div>
    </div>
  );
}

export default function ParametresPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/settings');
  const [societe, setSociete] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (data?.settings) setSociete(data.settings.societe);
  }, [data]);

  const save = async (key, value) => {
    setBusy(key);
    try {
      await api(`/settings/${key}`, { method: 'PUT', body: value });
      toast.success('Paramètres enregistrés.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(''); }
  };

  if (loading) return <Spinner />;
  if (error) return <div className="alert alert-error">{error}</div>;

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader icon="gear" accent={ACCENT} title="Paramètres" subtitle="Apparence, police, identité de la société et impression." />

      <ThemeSection />

      <FontSection />

      <ImpressionSection />

      {societe && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); save('societe', societe); }}>
          <h2 className="panel-title">Société</h2>
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: -4 }}>
            Ces informations apparaissent en en-tête des documents imprimés.
          </p>
          <div className="op-form">
            <label className="field field-grow"><span>Nom</span>
              <input value={societe.nom} onChange={(e) => setSociete({ ...societe, nom: e.target.value })} /></label>
            <label className="field field-grow"><span>Adresse</span>
              <input value={societe.adresse} onChange={(e) => setSociete({ ...societe, adresse: e.target.value })} /></label>
            <label className="field"><span>Téléphone</span>
              <input value={societe.telephone} onChange={(e) => setSociete({ ...societe, telephone: e.target.value })} /></label>
            <label className="field field-grow"><span>Pied de page</span>
              <input value={societe.pied_de_page} onChange={(e) => setSociete({ ...societe, pied_de_page: e.target.value })} /></label>
            <button className="btn btn-gold" disabled={busy === 'societe'}>Enregistrer</button>
          </div>
        </form>
      )}
    </div>
  );
}
