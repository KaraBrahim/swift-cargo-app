import { useEffect, useRef, useState } from 'react';
import RateCalendar, { toISO } from './RatePeriodPicker.jsx';
import { IconEl } from './icons.jsx';
import { formatRangeFr, daysBetween, lastDayOf } from '../lib/format.js';

// Le contrôle qui décide de ce que TOUS les rapports montrent.
//
// Deux champs qu'on peut taper, un calendrier pour ceux qui préfèrent cliquer,
// et des raccourcis. Les raccourcis ne sont pas des MODES : cliquer « Mois
// dernier » remplit les deux champs, et on peut ensuite corriger l'un des deux.
// Rien ne reste caché derrière un préréglage — l'écran dit toujours quelles
// deux dates sont réellement appliquées.
//
// Sous les champs, une phrase : « du 1er au 8 septembre 2026 · 8 jours ·
// heure d'Alger ». C'est elle qui rend le rapport vérifiable. Un total sans
// période affichée est un nombre qu'on ne peut ni contester ni reproduire.

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Aujourd'hui selon l'horloge du poste. Le serveur, lui, tranchera dans le
// fuseau du bureau — et le dira dans sa réponse.
const today = () => {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
};

// Le mois en cours jusqu'à aujourd'hui : la plage par défaut. Les totaux ne
// couvrent que des jours qui ont eu lieu, donc un total du 8 est un vrai total
// de huit jours — pas un mois aux trois quarts vide qu'on croit incomplet.
export function defaultRange() {
  const t = today();
  return { from: iso(t.y, t.m, 1), to: iso(t.y, t.m, t.d) };
}

const PRESETS = [
  { key: 'mois', label: 'Ce mois', range: defaultRange },
  {
    key: 'moisDernier',
    label: 'Mois dernier',
    range: () => {
      const t = today();
      const y = t.m === 1 ? t.y - 1 : t.y;
      const m = t.m === 1 ? 12 : t.m - 1;
      return { from: iso(y, m, 1), to: iso(y, m, lastDayOf(y, m)) };
    },
  },
  {
    key: 'trimestre',
    label: 'Ce trimestre',
    range: () => {
      const t = today();
      const first = Math.floor((t.m - 1) / 3) * 3 + 1;
      return { from: iso(t.y, first, 1), to: iso(t.y, t.m, t.d) };
    },
  },
  {
    key: 'annee',
    label: 'Cette année',
    range: () => {
      const t = today();
      return { from: iso(t.y, 1, 1), to: iso(t.y, t.m, t.d) };
    },
  },
  {
    // Assez large pour tout contenir sans inventer une notion de « tout » côté
    // serveur : la plage reste une plage, et le rapport continue de dire
    // laquelle il a suivie.
    key: 'tout',
    label: 'Tout',
    range: () => {
      const t = today();
      return { from: '2020-01-01', to: iso(t.y, t.m, t.d) };
    },
  },
];

// AAAA-MM-JJ ⇄ JJ/MM/AAAA. On tape des dates comme on les écrit ici.
const toFr = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const fromFr = (s) => {
  const m = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec((s || '').trim());
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > lastDayOf(y, mo)) return null;
  return iso(y, mo, d);
};

const toDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : undefined;
};

function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open, onClose]);
  return ref;
}

export default function DateRangePicker({ value, onChange, tzLabel }) {
  const [cal, setCal] = useState(false);
  const ref = useDismiss(cal, () => setCal(false));
  // Le texte tapé vit à part de la valeur appliquée : sinon chaque frappe
  // pendant qu'on écrit « 01/0 » relancerait une requête sur une date à moitié
  // saisie. Il ne remonte que lorsqu'il forme une date entière.
  const [draft, setDraft] = useState({ from: toFr(value.from), to: toFr(value.to) });

  useEffect(() => { setDraft({ from: toFr(value.from), to: toFr(value.to) }); }, [value.from, value.to]);

  const commit = (side) => (e) => {
    const parsed = fromFr(e.target.value);
    if (!parsed) { setDraft((d) => ({ ...d, [side]: toFr(value[side]) })); return; }
    const next = { ...value, [side]: parsed };
    // Une fin avant le début est presque toujours une inversion, pas une
    // erreur : on remet les deux dans l'ordre plutôt que de refuser.
    onChange(next.to < next.from ? { from: next.to, to: next.from } : next);
  };

  const activePreset = PRESETS.find((p) => {
    const r = p.range();
    return r.from === value.from && r.to === value.to;
  })?.key;

  const jours = daysBetween(value.from, value.to);

  return (
    <div className="range-bar" ref={ref}>
      <div className="range-fields">
        <label className="range-field">
          <span>Du</span>
          <input
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            onBlur={commit('from')}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            placeholder="JJ/MM/AAAA" inputMode="numeric" aria-label="Date de début"
          />
        </label>
        <label className="range-field">
          <span>Au</span>
          <input
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            onBlur={commit('to')}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            placeholder="JJ/MM/AAAA" inputMode="numeric" aria-label="Date de fin"
          />
        </label>
        <button type="button" className={`icon-btn ${cal ? 'active' : ''}`}
          title="Choisir dans le calendrier" aria-label="Calendrier" aria-expanded={cal}
          onClick={() => setCal((o) => !o)}>
          <IconEl name="calendar" />
        </button>
      </div>

      <div className="range-presets">
        {PRESETS.map((p) => (
          <button key={p.key} type="button"
            className={`chip ${activePreset === p.key ? 'active' : ''}`}
            onClick={() => onChange(p.range())}>
            {p.label}
          </button>
        ))}
      </div>

      {cal && (
        <div className="range-cal">
          <RateCalendar
            mode="range"
            value={{ from: toDate(value.from), to: toDate(value.to) }}
            // Aucune date interdite : demander « au 30 septembre » le 8 est
            // une question normale, et la réponse est simplement vide après
            // aujourd'hui.
            disabled={undefined}
            onChange={(r) => {
              if (!r?.from) return;
              onChange({ from: toISO(r.from), to: toISO(r.to ?? r.from) });
              if (r.to) setCal(false);
            }}
          />
        </div>
      )}

      <p className="range-said">
        <strong>{formatRangeFr(value.from, value.to)}</strong>
        <span> · {jours} jour{jours > 1 ? 's' : ''}</span>
        {tzLabel && <span> · {tzLabel}</span>}
      </p>
    </div>
  );
}
