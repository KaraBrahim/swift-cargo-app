import { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, formatMoney, errorMessage, useToast } from '../components/ui.jsx';

export default function RatesPage() {
  const toast = useToast();
  const currencies = useApi('/currencies');
  const [currencyCode, setCurrencyCode] = useState('');
  const [dzdPerUnit, setDzdPerUnit] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (currencies.loading) return <Spinner />;
  if (currencies.error) return <div className="alert alert-error">{currencies.error}</div>;

  const list = currencies.data.currencies;
  const editable = list.filter((c) => !c.is_base);
  const selected = currencyCode || editable[0]?.code || '';

  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(dzdPerUnit) > 0)) return;
    setBusy(true);
    try {
      await api('/rates', { method: 'POST', body: { currencyCode: selected, dzdPerUnit, note } });
      toast.success(`Taux ${selected} mis à jour.`);
      setDzdPerUnit('');
      setNote('');
      currencies.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Taux de change — marché noir</h1>
        <p className="muted">Taux manuels en DZD par unité. Le DZD est la référence (= 1).</p>
      </div>

      <div className="rates-grid">
        {list.map((c) => (
          <div key={c.code} className={`rate-card ${c.is_base ? 'rate-base' : ''}`}>
            <div className="rate-code">{c.code}</div>
            <div className="rate-name">{c.name}</div>
            <div className="rate-value">
              {c.is_base ? '1,00' : c.dzd_per_unit != null ? formatMoney(c.dzd_per_unit) : '—'}
              <span className="rate-unit">DZD / unité</span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 className="panel-title">Définir un nouveau taux</h2>
        <form className="op-form" onSubmit={submit}>
          <label className="field">
            <span>Devise</span>
            <select value={selected} onChange={(e) => setCurrencyCode(e.target.value)}>
              {editable.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>DZD par 1 unité</span>
            <input
              inputMode="decimal"
              value={dzdPerUnit}
              onChange={(e) => setDzdPerUnit(e.target.value.replace(',', '.'))}
              placeholder="ex. 30.50"
            />
          </label>
          <label className="field field-grow">
            <span>Note (optionnel)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Source, remarque…" />
          </label>
          <button className="btn btn-gold" disabled={busy || !(Number(dzdPerUnit) > 0)}>
            {busy ? '…' : 'Enregistrer'}
          </button>
        </form>
      </div>
    </div>
  );
}
