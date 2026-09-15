import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, errorMessage, useToast, PageHeader } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { ThemeGrid } from '../components/ThemePicker.jsx';

const ACCENT = 'var(--c-audit)';

// The theme is a per-machine preference, not shared server state: the Algérie desk
// can run the light theme while Chine keeps the dark one. So it is saved in this
// browser only, while everything else on this page is stored server-side.
function ThemeSection() {
  const { navGroups, setNavGroups } = useTheme();
  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Thème</h2>
        <span className="muted" style={{ fontSize: '0.76rem' }}>Enregistré sur ce poste uniquement</span>
      </div>
      <ThemeGrid wide />

      {/* Same kind of setting as the theme, so it sits with it rather than in a
          panel of its own. */}
      <label className="switch-row pref-row">
        <input
          type="checkbox"
          checked={navGroups}
          onChange={(e) => setNavGroups(e.target.checked)}
        />
        <span>
          <strong>Titres de sections dans le menu</strong>
          <span className="muted">
            {navGroups
              ? '« Opérations », « Répertoire »… sont affichés au-dessus de chaque groupe.'
              : 'Le menu est une liste continue : il tient sur moins de hauteur.'}
          </span>
        </span>
      </label>
    </div>
  );
}

const PRINT_MODES = [
  { key: 'navigateur', label: 'Navigateur', hint: 'Pas d’impression directe : les documents passent par la fenêtre d’impression.' },
  { key: 'reseau', label: 'Réseau', hint: 'Imprimante avec une adresse IP sur le réseau local. Le mode à préférer.' },
  { key: 'windows', label: 'USB / Windows', hint: 'Imprimante branchée sur ce poste et installée dans Windows.' },
];

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



      {/* Alipay yuan and cash yuan are the same money in this business. Keeping
          the two rates equal by hand is a way to eventually get them apart. */}
      {data?.settings?.taux && (
        <div className="panel">
          <h2 className="panel-title">Taux de change</h2>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={data.settings.taux.alp_suit_cny}
              disabled={busy === 'taux'}
              onChange={(e) => save('taux', { alp_suit_cny: e.target.checked })}
            />
            <span>
              <strong>L’ALP suit le CNY</strong>
              <span className="muted">
                {data.settings.taux.alp_suit_cny
                  ? 'Modifier le taux du CNY met l’ALP à la même valeur. L’ALP n’a pas de crayon tant que le lien est actif.'
                  : 'L’ALP est indépendant : il se modifie séparément depuis Taux de change.'}
              </span>
            </span>
          </label>
        </div>
      )}

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
