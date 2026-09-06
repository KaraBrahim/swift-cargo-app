import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, fitStyle, formatNumber, errorMessage, useToast, PageHeader } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import AmountInput from '../components/AmountInput.jsx';
import RateCalendar, { toISO } from '../components/RatePeriodPicker.jsx';
import RateChart from '../components/RateChart.jsx';
import Flag from '../components/Flag.jsx';

const rate6 = (v) => (v == null ? '—' : formatNumber(v, { decimals: 6, trim: true }));

// ── One currency, edited where it is shown ───────────────────────────
function RateCard({ c, onSaved }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const open = () => {
    
    setValue(c.dzd_per_unit != null ? String(Number(c.dzd_per_unit)) : '');
    setNote('');
    setEditing(true);
  };

  const save = async (e) => {
    e?.preventDefault();
    if (!(Number(value) > 0)) return;
    setBusy(true);
    try {
      await api('/rates', { method: 'POST', body: { currencyCode: c.code, dzdPerUnit: value, note } });
      toast.success(`Taux ${c.code} mis à jour.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rate-card ${c.is_base ? 'rate-base' : ''}`}>
      <div className="rate-head">
        <div>
          <div className="rate-code">{c.code}</div>
          <div className="rate-name">{c.name}</div>
        </div>
        {/* The dinar is 1 by definition and ALP follows the yuan: neither is a
            number anyone should be invited to type. */}
        {!c.is_base && !c.linked_to && !editing && (
          <button className="icon-btn" title="Modifier le taux" aria-label={`Modifier le taux ${c.code}`} onClick={open}>
            <IconEl name="edit" />
          </button>
        )}
        {c.linked_to && <span className="badge badge-gold">lié au {c.linked_to}</span>}
      </div>

      {editing ? (
        <form className="rate-edit" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}>
          <AmountInput autoFocus decimals={6} value={value} onChange={setValue} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (source, remarque…)" />
          <div className="rate-edit-actions">
            <button className="btn btn-gold btn-sm" disabled={busy || !(Number(value) > 0)}>
              {busy ? '…' : 'Enregistrer'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}><IconEl name="close" />Annuler</button>
          </div>
        </form>
      ) : (
        <>
          <div className="rate-value">
            {c.is_base ? '1.00' : rate6(c.dzd_per_unit)}
            <span className="rate-unit">DZD / unité</span>
          </div>
          {!c.is_base && (
            c.rate_is_seed ? (
              <div className="rate-stale">Valeur de départ — jamais vérifiée</div>
            ) : c.rate_set_at ? (
              <div className="rate-meta">
                {new Date(c.rate_set_at).toLocaleDateString('fr-FR')}
                {c.rate_set_by ? ` · ${c.rate_set_by}` : ''}
              </div>
            ) : null
          )}
        </>
      )}
    </div>
  );
}

// ── A pair: computed until someone quotes it ─────────────────────────
function PairCard({ p, onChanged }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const manual = p.mode === 'manuel';

  const run = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveRate = (e) => {
    e.preventDefault();
    if (!(Number(value) > 0)) return;
    run(
      () => api(`/pairs/${p.from_code}/${p.to_code}/rate`, { method: 'POST', body: { unitsPerUnit: value } }),
      'Taux de la paire enregistré.'
    );
  };

  return (
    <div className={`rate-card pair-card ${manual ? 'pair-manual' : ''}`}>
      <div className="rate-head">
        <div>
          <div className="rate-code">{p.from_code} → {p.to_code}</div>
          <span className={`badge ${manual ? 'badge-gold' : ''}`}>{manual ? 'manuel' : 'calculé'}</span>
        </div>
        {!editing && (
          <button
            className="icon-btn"
            title="Modifier ce taux"
            aria-label="Modifier ce taux"
            onClick={() => { setValue(p.rate != null ? String(Number(p.rate)) : ''); setEditing(true); }}
          >
            <IconEl name="edit" />
          </button>
        )}
      </div>

      {editing ? (
        <form className="rate-edit" onSubmit={saveRate} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}>
          <AmountInput autoFocus decimals={6} value={value} onChange={setValue} />
          <div className="rate-edit-actions">
            <button className="btn btn-gold btn-sm" disabled={busy || !(Number(value) > 0)}>Enregistrer</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}><IconEl name="close" />Annuler</button>
          </div>
        </form>
      ) : (
        <>
          <div className="rate-value">
            {rate6(p.rate)}
            <span className="rate-unit">{p.to_code} / 1 {p.from_code}</span>
          </div>
          {/* Not a warning — just the other number, visible. */}
          {manual && p.derived_rate != null && (
            <div className="rate-meta">calculé via DZD : {rate6(p.derived_rate)}</div>
          )}
          {manual && p.rate_set_at && (
            <div className="rate-meta">
              {new Date(p.rate_set_at).toLocaleDateString('fr-FR')}
              {p.rate_set_by ? ` · ${p.rate_set_by}` : ''}
            </div>
          )}
          <div className="pair-actions">
            {manual && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => run(
                  () => api(`/pairs/${p.from_code}/${p.to_code}/reset`, { method: 'POST' }),
                  'Paire recalculée depuis le DZD.'
                )}
              >
                Recalculer depuis le DZD
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => run(
                () => api(`/pairs/${p.from_code}/${p.to_code}`, { method: 'DELETE' }),
                'Paire supprimée.'
              )}
            >
              Supprimer
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── What a pair was worth on a date, or on average over a period ─────
// The one panel on this page that is read rather than edited, so it is given the
// room to be read: the calendar on the left, the question and its answer on the
// right, and the whole thing on a dark plate with the world behind it.
function CurrencyPick({ label, value, codes, onChange }) {
  return (
    <label className="cur-pick">
      <span className="cur-label">{label}</span>
      <span className="cur-field">
        <Flag code={value} />
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </span>
    </label>
  );
}

function HistoryPanel({ codes, base }) {
  const toast = useToast();
  // "How many dinars for one yuan", not the reciprocal: the inverse direction
  // shows 0.03 where the useful figure is 32.
  const [from, setFrom] = useState(codes.find((c) => c !== base) ?? codes[0]);
  const [to, setTo] = useState(base);
  const [mode, setMode] = useState('single');
  // Opens on today, so the panel answers something the moment it is on screen.
  const [day, setDay] = useState(new Date());
  const [range, setRange] = useState(undefined);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const ready = mode === 'single' ? Boolean(day) : Boolean(range?.from && range?.to);
  const key = mode === 'single'
    ? `${from}|${to}|d|${toISO(day)}`
    : `${from}|${to}|p|${toISO(range?.from)}|${toISO(range?.to)}`;

  // No "Afficher" button: everything needed to answer is already on screen, and
  // asking for a click to confirm a choice that was itself a click is noise.
  useEffect(() => {
    if (!ready || from === to) { setResult(null); return undefined; }
    let alive = true;
    setBusy(true);
    const qs = new URLSearchParams({ from, to });
    if (mode === 'single') qs.set('date', toISO(day));
    else { qs.set('start', toISO(range.from)); qs.set('end', toISO(range.to)); }

    api(`/rates/lookup?${qs}`)
      .then((r) => { if (alive) setResult(r); })
      .catch((err) => { if (alive) { toast.error(errorMessage(err)); setResult(null); } })
      .finally(() => { if (alive) setBusy(false); });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  const swap = () => { setFrom(to); setTo(from); };
  const up = result?.changePct != null && Number(result.changePct) >= 0;

  return (
    <section className="rate-hist">
      <div className="rate-hist-inner">
        <header className="rh-head">
          <h2>Taux à une date</h2>
          <div className="seg rh-seg">
            <button className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>À une date</button>
            <button className={mode === 'range' ? 'active' : ''} onClick={() => setMode('range')}>Sur une période</button>
          </div>
        </header>

        <div className="rh-grid">
          <div className="rh-cal glass">
            <RateCalendar
              mode={mode}
              value={mode === 'single' ? day : range}
              onChange={(v) => (mode === 'single' ? setDay(v) : setRange(v))}
            />
          </div>

          <div className="rh-side">
            <div className="rh-pair">
              <CurrencyPick label="De" value={from} codes={codes} onChange={setFrom} />
              <button type="button" className="rh-swap" onClick={swap} title="Inverser" aria-label="Inverser les devises">
                <IconEl name="swap" />
              </button>
              <CurrencyPick label="Vers" value={to} codes={codes} onChange={setTo} />
            </div>

            {from === to ? (
              <p className="muted">Choisissez deux devises différentes.</p>
            ) : !ready ? (
              <p className="muted">Choisissez la date de début, puis celle de fin.</p>
            ) : busy && !result ? (
              <p className="muted">…</p>
            ) : !result ? null : mode === 'single' ? (
              result.rate == null ? (
                <p className="muted">Aucun taux connu à cette date.</p>
              ) : (
                <div className="rh-hero">
                  <span className="rh-label">
                    1 {result.from} le {new Date(`${result.date}T12:00:00`).toLocaleDateString('fr-FR')}
                  </span>
                  <div className="rh-value" style={fitStyle(rate6(result.rate))}>{rate6(result.rate)}</div>
                  <span className="rh-unit">{result.to} / 1 {result.from}</span>
                </div>
              )
            ) : result.average == null ? (
              <p className="muted">Aucun taux connu sur cette période.</p>
            ) : (
              <>
                {/* Figures on the left, the shape of them on the right — side
                    by side, because a number and its curve answer the same
                    question and reading one should not mean scrolling past the
                    other. */}
                <div className="rh-answer">
                  <div className="rh-figures">
                    <div className="rh-hero">
                      <span className="rh-label">Moyenne pondérée</span>
                      <div className="rh-value" style={fitStyle(rate6(result.average))}>{rate6(result.average)}</div>
                      <span className="rh-unit">{result.to} / 1 {result.from}</span>
                    </div>

                    <div className="rh-stats glass">
                      <div><span className="rh-label">Début</span><div className="rh-stat">{rate6(result.first)}</div></div>
                      <div><span className="rh-label">Fin</span><div className="rh-stat">{rate6(result.last)}</div></div>
                      {result.changePct != null && (
                        <div>
                          <span className="rh-label">Variation</span>
                          <div className={`rh-stat ${up ? 'up' : 'down'}`}>
                            <IconEl name="trend" style={up ? undefined : { transform: 'scaleY(-1)' }} />
                            {up ? '+' : ''}{result.changePct} %
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {result.points.length > 1 && (
                    <div className="rh-chart">
                      <RateChart points={result.points} />
                      <p className="rh-note">Chaque taux compte à hauteur du temps pendant lequel il s’est appliqué.</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function RatesPage() {
  const toast = useToast();
  const currencies = useApi('/currencies');
  const pairs = useApi('/pairs');
  const [adding, setAdding] = useState(false);
  const [pairFrom, setPairFrom] = useState('');
  const [pairTo, setPairTo] = useState('');
  const [busy, setBusy] = useState(false);

  if (currencies.loading) return <Spinner />;
  if (currencies.error) return <div className="alert alert-error">{currencies.error}</div>;

  const list = currencies.data.currencies;
  const codes = list.filter((c) => c.active).map((c) => c.code);
  const pairList = pairs.data?.pairs ?? [];

  const addPair = async () => {
    if (!pairFrom || !pairTo || pairFrom === pairTo) return;
    setBusy(true);
    try {
      await api('/pairs', { method: 'POST', body: { fromCode: pairFrom, toCode: pairTo } });
      toast.success('Paire ajoutée.');
      setAdding(false);
      setPairFrom('');
      setPairTo('');
      pairs.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* The one action this page offers lives in its header, not halfway down
          the page next to the thing it creates. */}
      <PageHeader
        icon="taux"
        title="Taux de change"
        subtitle="Taux manuels en DZD par unité. Le DZD est la référence (= 1)."
      >
        {!adding && (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            <IconEl name="plus" /> Ajouter une paire
          </button>
        )}
      </PageHeader>

      {adding && (
        <div className="op-form pair-add">
          <label className="field"><span>De</span>
            <select value={pairFrom} onChange={(e) => setPairFrom(e.target.value)}>
              <option value="">— choisir —</option>
              {codes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field"><span>Vers</span>
            <select value={pairTo} onChange={(e) => setPairTo(e.target.value)}>
              <option value="">— choisir —</option>
              {codes.filter((c) => c !== pairFrom).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button className="btn btn-gold" disabled={busy || !pairFrom || !pairTo} onClick={addPair}>Ajouter</button>
          <button className="btn btn-ghost" onClick={() => setAdding(false)}><IconEl name="close" />Annuler</button>
        </div>
      )}

      {/* One row: five currencies read as one board, not as a paragraph of
          cards. They share the width rather than each claiming a minimum. */}
      <div className="rates-row">
        {list.map((c) => (
          <RateCard
            key={c.code}
            c={c}
            // A derived pair is computed FROM these rates, so it goes stale the
            // moment one changes. Reload both or the pair shows the old cross.
            onSaved={() => { currencies.reload(); pairs.reload(); }}
          />
        ))}
      </div>

      {pairList.length > 0 && (
        <div className="rates-row pairs-row">
          {pairList.map((p) => (
            <PairCard
              key={`${p.from_code}>${p.to_code}`}
              p={p}
              onChanged={() => { pairs.reload(); currencies.reload(); }}
            />
          ))}
        </div>
      )}

      <HistoryPanel codes={codes} base={list.find((c) => c.is_base)?.code ?? 'DZD'} />
    </div>
  );
}
