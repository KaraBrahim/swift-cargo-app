import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useTabTitle } from '../components/TabsContext.jsx';
import { Spinner, Money, formatMoney, errorMessage, useToast } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { defaultCurrencyFor, leadCurrencyFor, sortByImportance } from '../lib/offices.js';
import { PrintButton } from '../components/PrintButton.jsx';
import { tableDocBody } from '../components/printDocument.js';
import { listTicket } from '../components/printTicket.js';
import AmountInput from '../components/AmountInput.jsx';
import { formatNumber } from '../lib/format.js';

const OPS = [
  { key: 'deposit', label: 'Dépôt' },
  { key: 'withdraw', label: 'Retrait' },
  { key: 'convert', label: 'Conversion' },
  { key: 'transfer', label: 'Transfert' },
];

// Columns for the printed movements table — declared once, next to the screen
// table it mirrors.
const PRINT_COLS = [
  { key: 'created_at', label: 'Date', format: (v) => new Date(v).toLocaleString('fr-FR') },
  { key: 'type', label: 'Type' },
  { key: 'currency_code', label: 'Devise' },
  { key: 'amount', label: 'Montant', align: 'r', format: (v, r) => `${r.direction === 'in' ? '+' : '−'}${formatMoney(v)}` },
  { key: 'balance_after', label: 'Solde', align: 'r', format: (v) => formatMoney(v) },
  { key: 'admin_name', label: 'Par' },
];

export default function CaisseDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const detail = useApi(`/caisses/${id}`);
  const currencies = useApi('/currencies');
  const caisses = useApi('/caisses');
  const [historyTab, setHistoryTab] = useState('ledger');
  const [editTx, setEditTx] = useState(null);
  const [confirmTx, setConfirmTx] = useState(null);
  const [txBusy, setTxBusy] = useState(false);
  const [ledgerAdmin, setLedgerAdmin] = useState('');
  const ledger = useApi(`/caisses/${id}/ledger?limit=50${ledgerAdmin ? `&adminId=${ledgerAdmin}` : ''}`);
  const conversions = useApi(`/caisses/${id}/conversions?limit=50`);

  // Actors come from the movements themselves; "Tous" counts what the tabs
  // count, so the numbers add up on screen.
  const actors = ledger.data?.actors ?? [];
  // undefined, not 0: a server that predates this endpoint sends no total, and
  // "Tous 0" above a table full of rows is a worse answer than no number.
  const actorTotal = ledger.data?.total;

  const reloadAll = () => {
    detail.reload();
    caisses.reload();
    ledger.reload();
    conversions.reload();
  };

  // Correcting a movement replays the whole balance chain server-side, so the
  // caisse totals must be refetched too.
  const runTx = async (fn, okMsg) => {
    setTxBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      setEditTx(null);
      setConfirmTx(null);
      reloadAll();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setTxBusy(false); }
  };

  // L'onglet porte le nom de la fiche, pas celui de sa section : « BP-…-00003 »
  // se retrouve dans une barre d'onglets, « Bons passagers · fiche » non.
  useTabTitle(detail.data?.caisse?.label);
  if (detail.loading || currencies.loading) return <Spinner />;
  if (detail.error) return <div className="alert alert-error">{detail.error}</div>;

  const caisse = detail.data.caisse;
  const curList = currencies.data?.currencies ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{caisse.label}</h1>
        </div>
        <div className="page-actions">
          <span className="badge badge-gold" style={{ alignSelf: 'center' }}>
            {caisse.office === 'china' ? 'Bureau Chine' : caisse.office === 'algeria' ? 'Bureau Algérie' : caisse.label}
          </span>
          <PrintButton
            title={`Mouvements ${caisse.label}`}
            docTitle="Mouvements de caisse"
            subtitle={caisse.label}
            a4={() => tableDocBody({
              columns: PRINT_COLS,
              rows: ledger.data?.transactions ?? [],
              meta: caisse.balances.map((b) => ({ label: b.currency_code, value: formatMoney(b.balance) })),
            })}
            ticket={(societe) => listTicket({
              societe, docLabel: 'Mouvements de caisse', subtitle: caisse.label,
              columns: [{ key: 'created_at', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'amount', label: 'Montant' }],
              rows: (ledger.data?.transactions ?? []).map((t) => ({
                created_at: new Date(t.created_at).toLocaleString('fr-FR'),
                type: t.type,
                amount: `${t.direction === 'in' ? '+' : '−'}${formatMoney(t.amount, t.currency_code)}`,
              })),
              totals: caisse.balances.map((b) => ({ label: b.currency_code, value: formatMoney(b.balance) })),
            })}
          />
        </div>
      </div>

      <div className="balances-row">
        {[...caisse.balances]
          .sort((a, b) => sortByImportance([a.currency_code, b.currency_code], caisse.office)[0] === a.currency_code ? -1 : 1)
          .map((b) => (
            <div
              key={b.currency_code}
              className={`balance-card ${b.currency_code === leadCurrencyFor(caisse.office) ? 'balance-primary balance-own' : ''}`}
            >
              <div className="balance-code">{b.currency_code}</div>
              <Money as="div" className="balance-amount" value={b.balance} />
              <div className="balance-name">{b.name}</div>
            </div>
          ))}
      </div>

      <OperationsPanel
        caisseId={Number(id)}
        office={caisse.office}
        currencies={curList}
        caisses={(caisses.data?.caisses ?? []).filter((c) => c.id !== Number(id))}
        onDone={reloadAll}
      />

      <div className="panel">
        <div className="tabs">
          <button className={historyTab === 'ledger' ? 'tab active' : 'tab'} onClick={() => setHistoryTab('ledger')}>
            Mouvements
          </button>
          <button className={historyTab === 'conversions' ? 'tab active' : 'tab'} onClick={() => setHistoryTab('conversions')}>
            Conversions
          </button>
        </div>
        {historyTab === 'ledger' ? (
          <>
            {/* Tabs, not a dropdown: with a handful of people the names are
                worth seeing at a glance, and the count says who actually works
                this till. Built from the caisse's own movements, so there are no
                empty tabs — and the super-admin never appears among them. */}
            <div className="seg ledger-actors">
              <button
                className={ledgerAdmin === '' ? 'active' : ''}
                onClick={() => setLedgerAdmin('')}
              >
                Tous
                {actorTotal != null && <span className="audit-count">{actorTotal}</span>}
              </button>
              {actors.map((a) => (
                <button
                  key={a.admin_id}
                  className={String(ledgerAdmin) === String(a.admin_id) ? 'active' : ''}
                  onClick={() => setLedgerAdmin(String(a.admin_id))}
                >
                  {a.full_name}
                  <span className="audit-count">{a.n}</span>
                </button>
              ))}
            </div>
            {editTx && (
              <form
                className="op-form"
                style={{ marginBottom: 14, padding: 14, borderRadius: 'var(--radius-soft)', background: 'var(--surface-2)' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  runTx(() => api(`/caisses/movements/${editTx.id}`, { method: 'PATCH', body: { amount: editTx.amount, note: editTx.note || undefined } }), 'Mouvement corrigé.');
                }}
              >
                <div className="field field-grow"><span>Corriger ce mouvement</span>
                  <span className="muted">Le solde de la caisse est recalculé sur tout l’historique.</span></div>
                <label className="field"><span>Montant ({editTx.currency})</span>
                  <AmountInput autoFocus value={editTx.amount}
                    onChange={(v) => setEditTx({ ...editTx, amount: v })} /></label>
                <label className="field field-grow"><span>Note</span>
                  <input value={editTx.note} onChange={(e) => setEditTx({ ...editTx, note: e.target.value })} /></label>
                <button className="btn btn-gold" disabled={txBusy || !(Number(editTx.amount) > 0)}>Enregistrer</button>
                <button type="button" className="btn btn-ghost" onClick={() => setEditTx(null)}><IconEl name="close" />Annuler</button>
              </form>
            )}
            <LedgerTable
              q={ledger}
              busy={txBusy}
              onEdit={(t) => setEditTx({ id: t.id, amount: t.amount, note: t.note || '', currency: t.currency_code })}
              onDelete={(t) => setConfirmTx(t)}
            />
          </>
        ) : <ConversionsTable q={conversions} />}
      </div>

      <ConfirmDialog
        open={Boolean(confirmTx)}
        tone="danger"
        title="Supprimer ce mouvement ?"
        message={confirmTx ? `${confirmTx.direction === 'in' ? 'Entrée' : 'Sortie'} de ${formatMoney(confirmTx.amount, confirmTx.currency_code)} — le solde sera recalculé sur tout l’historique.` : ''}
        bullets={['Refusé si le retrait rendait le solde négatif à un moment quelconque.']}
        confirmLabel="Supprimer"
        busy={txBusy}
        onCancel={() => setConfirmTx(null)}
        onConfirm={() => runTx(() => api(`/caisses/movements/${confirmTx.id}`, { method: 'DELETE' }), 'Mouvement supprimé.')}
      />
    </div>
  );
}

// ── Operations ─────────────────────────────────────────────────────────
function OperationsPanel({ caisseId, office, currencies, caisses, onDone }) {
  const toast = useToast();
  const [op, setOp] = useState('deposit');
  const [busy, setBusy] = useState(false);
  const codes = currencies.map((c) => c.code);
  // Open on the currency this desk actually works in — yuan in China, dinars in
  // Algeria — rather than whatever happens to sort first.
  const own = defaultCurrencyFor(office);

  const [currency, setCurrency] = useState(own);
  const [fromCurrency, setFromCurrency] = useState(own);
  const [toCurrency, setToCurrency] = useState(codes.find((c) => c !== own) || 'DZD');
  // Left empty on purpose and filled by the effect below: useState only reads
  // its argument on the FIRST render, and the caisse list usually arrives after
  // that. The select then showed a destination while the state was still empty,
  // which left the Transfert button dead with no visible reason — and only
  // sometimes, depending on which request answered first.
  const [toCaisseId, setToCaisseId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!toCaisseId && caisses.length) setToCaisseId(caisses[0].id);
  }, [caisses, toCaisseId]);

  const rateOf = (code) => {
    const c = currencies.find((x) => x.code === code);
    if (!c) return null;
    if (c.is_base) return 1;
    return c.dzd_per_unit != null ? Number(c.dzd_per_unit) : null;
  };

  const preview = useMemo(() => {
    if (op !== 'convert') return null;
    const amt = Number(amount);
    const fr = rateOf(fromCurrency);
    const tr = rateOf(toCurrency);
    if (!amt || amt <= 0 || fromCurrency === toCurrency || !fr || !tr) return null;
    const dzd = Math.round(amt * fr * 100) / 100;
    const to = Math.round((dzd / tr) * 100) / 100;
    return { dzd, to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, amount, fromCurrency, toCurrency, currencies]);

  const valid = () => {
    if (!(Number(amount) > 0)) return false;
    if (op === 'convert') return fromCurrency !== toCurrency;
    if (op === 'transfer') return Boolean(toCaisseId);
    return true;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!valid()) return;
    setBusy(true);
    try {
      if (op === 'deposit') {
        await api(`/caisses/${caisseId}/deposit`, { method: 'POST', body: { currency, amount, note } });
        toast.success('Dépôt enregistré.');
      } else if (op === 'withdraw') {
        await api(`/caisses/${caisseId}/withdraw`, { method: 'POST', body: { currency, amount, note } });
        toast.success('Retrait enregistré.');
      } else if (op === 'convert') {
        await api(`/caisses/${caisseId}/convert`, {
          method: 'POST',
          body: { fromCurrency, toCurrency, amount, note },
        });
        toast.success('Conversion effectuée.');
      } else if (op === 'transfer') {
        // Creates a transfer awaiting confirmation — the same one the Caisses
        // page lists. No money moves here; both caisses stay as they are until
        // the destination confirms.
        await api('/office-transfers', {
          method: 'POST',
          body: { fromCaisseId: caisseId, toCaisseId: Number(toCaisseId), currency, amount, note },
        });
        toast.success('Transfert créé. Il attend la confirmation du bureau destinataire.');
      }
      setAmount('');
      setNote('');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="tabs">
        {OPS.map((o) => (
          <button key={o.key} className={op === o.key ? 'tab active' : 'tab'} onClick={() => setOp(o.key)} type="button">
            {o.label}
          </button>
        ))}
      </div>

      <form className="op-form" onSubmit={submit}>
        {(op === 'deposit' || op === 'withdraw') && (
          <label className="field">
            <span>Devise</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </label>
        )}

        {op === 'convert' && (
          <>
            <label className="field">
              <span>De</span>
              <select value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)}>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Vers</span>
              <select value={toCurrency} onChange={(e) => setToCurrency(e.target.value)}>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
          </>
        )}

        {op === 'transfer' && (
          <>
            <p className="muted line-hint" style={{ flexBasis: '100%' }}>
              L’argent ne bouge pas maintenant : le transfert attend la confirmation
              de la caisse destinataire, depuis « Caisse &amp; Finance ».
            </p>
            <label className="field">
              <span>Vers la caisse</span>
              <select value={toCaisseId} onChange={(e) => setToCaisseId(e.target.value)}>
                {caisses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Devise</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
          </>
        )}

        <label className="field">
          <span>Montant</span>
          <AmountInput
            value={amount}
            onChange={(v) => setAmount(v)}
            placeholder="0.00"
          />
        </label>

        <label className="field field-grow">
          <span>Note (optionnel)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Référence, motif…" />
        </label>

        <button className="btn btn-gold" disabled={busy || !valid()}>
          {busy ? '…' : OPS.find((o) => o.key === op).label}
        </button>
      </form>

      {op === 'convert' && preview && (
        <div className="preview">
          Estimation : <strong>{formatMoney(amount, fromCurrency)}</strong> ≈{' '}
          <strong className="gold">{formatMoney(preview.to, toCurrency)}</strong>{' '}
          <span className="muted">(valeur pivot {formatMoney(preview.dzd, 'DZD')})</span>
        </div>
      )}
      {op === 'convert' && !preview && Number(amount) > 0 && fromCurrency !== toCurrency && (
        <div className="preview muted">Taux manquant pour l'estimation — l'opération utilisera les taux du serveur.</div>
      )}
    </div>
  );
}

// ── History tables ─────────────────────────────────────────────────────
// Only a hand-entered movement may be corrected here; anything a bon, a
// conversion or a transfer produced must be fixed at its source, or the two
// sides would disagree.
const EDITABLE = ['deposit', 'withdrawal', 'adjustment'];
const notEditableWhy = (t) =>
  t.ref_conversion_id ? 'Fait partie d’une conversion'
    : t.ref_transfer_id ? 'Fait partie d’un transfert inter-bureaux'
      : 'Générée par un bon — à corriger depuis le bon';

// A cash receipt is proof of a single movement — printed one at a time from the
// row itself, straight to the thermal printer.
function ReceiptButton({ id, disabled }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    try {
      await api(`/print/mouvement/${id}`, { method: 'POST' });
      toast.success('Reçu envoyé à l’imprimante.');
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <button className="icon-btn" aria-label="Imprimer le reçu" title="Imprimer le reçu (imprimante thermique)"
      disabled={disabled || busy} onClick={print}>
      <IconEl name="print" />
    </button>
  );
}

function LedgerTable({ q, onEdit, onDelete, busy }) {
  if (q.loading) return <Spinner />;
  if (q.error) return <div className="alert alert-error">{q.error}</div>;
  const rows = q.data?.transactions ?? [];
  if (!rows.length) return <p className="muted pad">Aucun mouvement.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Devise</th><th className="right">Montant</th><th className="right">Solde</th><th>Par</th><th className="right">Actions</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const editable = EDITABLE.includes(t.type) && !t.ref_conversion_id && !t.ref_transfer_id;
            return (
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString('fr-FR')}</td>
                <td><TypeBadge type={t.type} dir={t.direction} /></td>
                <td>{t.currency_code}</td>
                <td className={`right ${t.direction === 'in' ? 'pos' : 'neg'}`}>
                  {t.direction === 'in' ? '+' : '−'}{formatMoney(t.amount)}
                </td>
                <td className="right"><Money value={t.balance_after} /></td>
                <td>{t.admin_name}</td>
                <td className="right nowrap">
                  <ReceiptButton id={t.id} disabled={busy} />
                  <button className="icon-btn" aria-label="Corriger" disabled={busy || !editable}
                    title={editable ? 'Corriger le montant' : notEditableWhy(t)} onClick={() => onEdit(t)}>
                    <IconEl name="edit" />
                  </button>
                  <button className="icon-btn danger" aria-label="Supprimer" disabled={busy || !editable}
                    title={editable ? 'Supprimer ce mouvement' : notEditableWhy(t)} onClick={() => onDelete(t)}>
                    <IconEl name="trash" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConversionsTable({ q }) {
  if (q.loading) return <Spinner />;
  if (q.error) return <div className="alert alert-error">{q.error}</div>;
  const rows = q.data?.conversions ?? [];
  if (!rows.length) return <p className="muted pad">Aucune conversion.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Date</th><th>De</th><th>Vers</th><th className="right">Valeur DZD</th><th className="right">Taux effectif</th><th>Par</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{new Date(c.created_at).toLocaleString('fr-FR')}</td>
              <td>{formatMoney(c.from_amount, c.from_currency)}</td>
              <td className="gold">{formatMoney(c.to_amount, c.to_currency)}</td>
              <td className="right">{formatMoney(c.dzd_value)}</td>
              <td className="right">{formatNumber(c.effective_rate, { decimals: 6, trim: true })}</td>
              <td>{c.admin_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TypeBadge({ type, dir }) {
  const labels = { deposit: 'Dépôt', withdrawal: 'Retrait', conversion: 'Conversion', transfer: 'Transfert', adjustment: 'Ajustement' };
  return <span className={`type-badge ${dir}`}>{labels[type] || type}</span>;
}
