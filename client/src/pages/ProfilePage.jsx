import { useState, useEffect, Fragment } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useTabTitle } from '../components/TabsContext.jsx';
import { Spinner, formatMoney, formatQty, errorMessage, useToast, EmptyState } from '../components/ui.jsx';
import { IconEl, initialsOf } from '../components/icons.jsx';
import { EntityPicker, OptionChips } from '../components/EntityPicker.jsx';
import { BON_STATUS } from '../components/bonStatus.js';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { defaultCurrencyFor } from '../lib/offices.js';
import AmountInput from '../components/AmountInput.jsx';
import { RolePicker, RoleBadges, personToForm, personBody, personValid } from '../components/RolePicker.jsx';
import { useIdempotent } from '../lib/useIdempotent.js';
import { useIsSuper } from '../auth/AuthContext.jsx';

const ENTRY_LABEL = {
  transport_fee: 'Frais de transport (dû)',
  fee_payment: 'Paiement du fournisseur',
  passager_due: 'Dû au passager',
  passager_payment: 'Paiement au passager',
  // Ce que le passager doit quand ce qu'il n'a pas livré valait plus que son
  // portage : une dette a son nom, pas un simple non-paiement.
  passager_manquant: 'Manquants à rembourser',
  adjustment: 'Ajustement',
  avance: 'Avance',
  remboursement: 'Remboursement',
  salaire: 'Salaire',
  prime: 'Prime',
  autre: 'Autre',
};
const TYPE_LABEL = { regular: 'Régulier', auto: 'Auto-entrepreneur' };

// One account, whichever role the movement came from. The sign says everything:
// > 0 = we owe them, < 0 = they owe us. A person who sells goods AND carries
// them has a single net figure, which is the whole point of merging the two.
function balanceState(value) {
  const n = Number(value);
  if (n === 0) return { text: 'Soldé', cls: 'muted' };
  return n > 0 ? { text: 'Vous lui devez', cls: 'pos' } : { text: 'Il vous doit', cls: 'neg' };
}

// Le solde dans cette devise, signe compris : > 0 = on lui doit.
const balanceIn = (balances, code) =>
  Number((balances ?? []).find((b) => b.currency_code === code)?.balance ?? 0);

// Ce qui reste dû dans cette devise, en valeur absolue : le sens — encaisser ou
// payer — est déjà porté par le formulaire, le champ ne veut que le nombre.
const owedIn = (balances, code) => Math.abs(balanceIn(balances, code)).toFixed(2);

// La devise dans laquelle il reste réellement quelque chose à régler : celle qui
// pèse le plus. Le formulaire partait toujours du dinar, si bien qu'une personne
// qui doit 8 000 CNY ouvrait sur un solde DZD à zéro — « Encaisser » proposait
// 0.00 sur une fiche qui doit pourtant de l'argent.
const owedCurrency = (balances) => {
  const owing = (balances ?? []).filter((b) => Number(b.balance) !== 0);
  if (!owing.length) return 'DZD';
  return owing.reduce((a, b) => (Math.abs(Number(b.balance)) > Math.abs(Number(a.balance)) ? b : a)).currency_code;
};

export default function ProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isSuper = useIsSuper();
  const accent = 'var(--c-people)';

  const account = useApi(`/people/${id}/account`);
  // A bon passager carries this person's goods (through its source lines) when
  // they are a fournisseur, and is theirs to carry when they are a passager —
  // the server answers both from the same query.
  const bons = useApi(`/bons?fournisseurId=${id}&limit=200`);
  const carried = useApi(`/bons?passagerId=${id}&limit=200`);
  const orders = useApi(`/orders?fournisseurId=${id}&limit=200`);

  const [tab, setTab] = useState('apercu');
  // Ce qui attend cette personne au bureau d'Alger, tous ordres confondus. Un
  // bon passager remplit sa valise chez plusieurs fournisseurs, donc la fiche
  // d'UN ordre ne peut pas répondre à la question posée au comptoir : « qu'est-ce
  // qui est à moi ? ». Celle-ci le peut.
  const waiting = useApi(`/people/${id}/deliverable`);
  // lineId → { full, qty }. Absent = « tout », qui est le cas ordinaire.
  const [handover, setHandover] = useState({});
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const caisses = useApi('/caisses');
  const currencies = useApi('/currencies');
  const [pay, setPay] = useState({ caisseId: '', amount: '', note: '', currency: 'DZD' });
  const allPayments = useApi('/accounts/payments?personType=personne');
  const [editPay, setEditPay] = useState(null);
  const [confirmPay, setConfirmPay] = useState(null);
  const [txForm, setTxForm] = useState(null);

  // Le montant proposé, c'est ce qui reste dû.
  //
  // Il était passé en `placeholder` — donc jamais montré : un champ d'argent
  // vide affiche « 0.00 » et non son placeholder (voir AmountInput). Le chiffre
  // était écrit deux lignes plus haut et il fallait quand même le retaper.
  //
  // Un hook, donc AVANT tout retour anticipé. Il se redéclenche quand le compte
  // est rechargé : après un règlement partiel, le champ propose le NOUVEAU
  // reste dû plutôt que l'ancien.
  useEffect(() => {
    const bals = account.data?.account?.balances;
    if (!bals) return;
    // La devise aussi est proposée : on arrive souvent ici depuis « Dettes en
    // cours », où la dette a une devise bien précise.
    const currency = owedCurrency(bals);
    setPay((p) => ({ ...p, currency, amount: owedIn(bals, currency) }));
  }, [account.data]);

  // Correcting a payment touches both the caisse and this account.
  const idem = useIdempotent();
  const runPay = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      setEditPay(null);
      setConfirmPay(null);
      account.reload();
      allPayments.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  // L'onglet porte le nom de la fiche, pas celui de sa section : « BP-…-00003 »
  // se retrouve dans une barre d'onglets, « Bons passagers · fiche » non.
  useTabTitle(account.data?.account?.person?.name);
  if (account.loading) return <Spinner />;
  if (account.error) return <div className="alert alert-error">{account.error}</div>;

  const { person, balances, entries } = account.data.account;
  const isFournisseur = Boolean(person.is_fournisseur);
  const isPassager = Boolean(person.is_passager);
  // Merge without double counting: a bon can be in both lists when the person
  // carries goods they supplied themselves.
  const bonMap = new Map();
  for (const b of [...(bons.data?.bons ?? []), ...(carried.data?.bons ?? [])]) bonMap.set(b.id, b);
  const bonList = [...bonMap.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const orderList = orders.data?.orders ?? [];

  const officeCaisses = (caisses.data?.caisses ?? []).filter((c) => c.kind === 'office');
  const personPayments = (allPayments.data?.payments ?? []).filter((p) => String(p.person_id) === String(id));
  const dzd = balances.find((b) => b.currency_code === 'DZD')?.balance ?? '0';
  const state = balanceState(dzd);
  // Which way the money goes is no longer decided by what they are, but by what
  // the account says — a person can owe as a fournisseur and be owed as a
  // passager, and only the net has a direction.
  // Le sens suit la DEVISE CHOISIE, pas le dinar. Une personne peut vous devoir
  // en yuans pendant que vous lui devez en dinars : décider « encaisser ou
  // payer » sur le seul solde DZD se trompait alors de sens, et de montant.
  const selBalance = balanceIn(balances, pay.currency);
  const incoming = selBalance <= 0;
  const totalFees = bonList.reduce((s, b) => s + Number(b.transport_fee || 0), 0);
  const activeBons = bonList.filter((b) => b.status !== 'regle').length;

  // ── Le comptoir ──────────────────────────────────────────────────
  const waitingOrders = waiting.data?.orders ?? [];
  const unitOf = (l) => (l.measure === 'poids' ? 'kg' : l.measure === 'cbm' ? 'm³' : l.unit || 'u');
  // Absent du formulaire = « tout », parce qu'emporter tout est le cas ordinaire
  // et qu'il ne doit coûter aucun clic.
  const takeOf = (l) => {
    const h = handover[l.id];
    if (!h || h.full !== false) return Number(l.deliverable);
    const v = Number(h.qty);
    return Number.isFinite(v) ? Math.max(v, 0) : 0;
  };
  const handoverLines = waitingOrders.flatMap((o) => o.lines);
  const doHandover = async () => {
    const lines = handoverLines
      .filter((l) => takeOf(l) > 0)
      .map((l) => ({ lineId: Number(l.id), quantity: String(takeOf(l)) }));
    if (!lines.length) { toast.info('Aucune quantité à remettre.'); return; }
    setBusy(true);
    try {
      await idem((key) => api(`/people/${id}/deliver`, { method: 'POST', idem: key, body: { lines } }));
      toast.success(`Marchandise remise à ${person.name}.`);
      setHandover({});
      waiting.reload();
      orders.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const openEdit = () => setEdit(personToForm(person));

  // Settle the running balance directly from the profile: a fournisseur pays
  // down their debt (cash in), or we pay a passager what we owe (cash out).
  const submitPayment = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await idem((key) => api(`/people/${id}/payment`, {
        method: 'POST', idem: key,
        body: {
          caisseId: Number(pay.caisseId), amount: pay.amount, currency: pay.currency,
          direction: incoming ? 'in' : 'out', note: pay.note || undefined,
        },
      }));
      toast.success(incoming ? 'Encaissement enregistré.' : 'Paiement enregistré.');
      // La devise n'est pas remise au dinar : le rechargement du compte, juste
      // après, reproposera la devise et le montant qui restent à régler. La
      // forcer ici ne ferait que faire clignoter « 0.00 DZD » entre les deux.
      setPay((p) => ({ ...p, caisseId: '', amount: '', note: '' }));
      account.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/people/${id}`, { method: 'PUT', body: personBody(edit) });
      toast.success('Profil mis à jour.');
      setEdit(null);
      account.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ '--accent': accent }}>
      <div className="page-head page-head-bar">
        <span className="page-head-name">{person.name}</span>
      </div>

      {/* ── Hero ── */}
      <div className="profile-hero">
        <div className="avatar avatar-lg">{initialsOf(person.name)}</div>

        <div className="profile-id">
          <div className="profile-name">{person.name}</div>
          <div className="profile-roles">
            <RoleBadges person={person} />
            {isPassager && <span className="type-badge">{TYPE_LABEL[person.passager_type] || 'Régulier'}</span>}
          </div>
          <div className="profile-meta">
            {person.phone && <span className="profile-meta-item"><IconEl name="phone" />{person.phone}</span>}
            {person.created_at && <span className="profile-meta-item"><IconEl name="calendar" />Depuis le {new Date(person.created_at).toLocaleDateString('fr-FR')}</span>}
            {person.notes && <span className="profile-meta-item"><IconEl name="note" />{person.notes}</span>}
          </div>
        </div>

        <div className="profile-actions">
          <button className="btn" onClick={() => (edit ? setEdit(null) : openEdit())}>
            <IconEl name={edit ? 'close' : 'edit'} />{edit ? 'Fermer' : 'Modifier'}
          </button>
        </div>

        {/* Un chiffre porte son icône : on repère le solde à sa forme avant
            d'en lire le mot. */}
        <div className="profile-kpis">
          {[
            { icon: 'coins', val: `${formatMoney(Math.abs(Number(dzd)))} DZD`, label: `Solde · ${state.text}`, cls: state.cls },
            { icon: 'bon', val: bonList.length, label: 'Bons au total' },
            { icon: 'plane', val: activeBons, label: 'Bons en cours' },
            { icon: 'chart', val: formatMoney(totalFees), label: 'Volume frais (DZD)' },
          ].map((k) => (
            <div className="pk" key={k.label}>
              <span className="pk-ico"><IconEl name={k.icon} /></span>
              <span className="pk-body">
                <span className={`pk-val ${k.cls || ''}`}>{k.val}</span>
                <span className="pk-label">{k.label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {edit && (
        <form className="panel op-form" onSubmit={save}>
          <label className="field field-grow"><span>Nom</span>
            <input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field"><span>Téléphone</span>
            <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
          <label className="field field-grow"><span>Notes</span>
            <input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          {/* Ajouter le rôle manquant se fait ici, en un clic : la fiche, les
              bons et le compte restent les mêmes. */}
          <RolePicker value={edit} onChange={setEdit} />
          <button className="btn btn-gold" disabled={busy || !personValid(edit)}>Enregistrer</button>
        </form>
      )}

      {/* ── Tabs ── */}
      <div className="filter-bar">
        <div className="segmented">
          {[['apercu', 'Aperçu'], ['releve', 'Relevé'], ['bons', `Bons passagers (${bonList.length})`],
            ...(isFournisseur ? [['ordres', `Bons fournisseurs (${orderList.length})`]] : [])].map(([k, label]) => (
            <button key={k} className={tab === k ? 'seg-btn active' : 'seg-btn'} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'apercu' && (
        <>
          <div className="balances-row">
            {balances.length === 0 && <div className="muted">Aucun mouvement.</div>}
            {balances.map((b) => {
              const st = balanceState(b.balance);
              return (
                <div key={b.currency_code} className={`balance-card ${b.currency_code === 'DZD' ? 'balance-primary balance-own' : ''}`}>
                  <div className="balance-code">{b.currency_code}</div>
                  <div className="balance-amount">{formatMoney(Math.abs(Number(b.balance)))}</div>
                  <div className={`balance-name ${st.cls}`}>{st.text}</div>
                </div>
              );
            })}
          </div>
          {/* Ne s'affiche que s'il y a quelque chose à remettre : un panneau
              vide sur chaque fiche apprendrait à ne plus le regarder. */}
          {waitingOrders.length > 0 && (
            <div className="panel panel-accent">
              <h2 className="panel-title">Remise à {person.name}</h2>
              <p className="dt-hint">
                <IconEl name="box" />
                {waiting.data.total} lot(s) l’attendent au bureau d’Alger, sur {waitingOrders.length} bon(s)
                fournisseur(s). Tout est coché — décochez une ligne s’il n’en emporte qu’une partie.
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Désignation</th><th className="right">Au bureau</th><th className="right">Il emporte</th></tr>
                  </thead>
                  <tbody>
                    {waitingOrders.map((o) => (
                      <Fragment key={o.orderId}>
                        <tr className="group-row">
                          <td colSpan="3">
                            <Link to={`/bons-fournisseur/${o.orderId}`} className="gold">{o.reference}</Link>
                          </td>
                        </tr>
                        {o.lines.map((l) => {
                          const h = handover[l.id];
                          const full = !h || h.full !== false;
                          const over = takeOf(l) > Number(l.deliverable);
                          return (
                            <tr key={l.id}>
                              <td>{l.designation}</td>
                              <td className="right">{formatQty(l.deliverable)} <span className="muted">{unitOf(l)}</span></td>
                              <td className="right rec-arrived">
                                <label className="rec-all" title="Il emporte tout">
                                  <input
                                    type="checkbox"
                                    checked={full}
                                    onChange={(e) => setHandover({
                                      ...handover,
                                      [l.id]: { full: e.target.checked, qty: e.target.checked ? l.deliverable : (h?.qty ?? l.deliverable) },
                                    })}
                                  />
                                  <span>tout</span>
                                </label>
                                {!full && (
                                  <AmountInput decimals={3} className={`mini-input ${over ? 'input-error' : ''}`}
                                    step={l.measure === 'cbm' ? 0.1 : 1} max={l.deliverable}
                                    value={h?.qty ?? ''}
                                    onChange={(v) => setHandover({ ...handover, [l.id]: { full: false, qty: v } })} />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dt-actions">
                <button className="btn btn-gold" disabled={busy} onClick={doHandover}>
                  <IconEl name="check" />{busy ? '…' : 'Confirmer la remise'}
                </button>
              </div>
            </div>
          )}

          <div className="panel">
            <h2 className="panel-title">{incoming ? 'Encaisser une dette' : 'Payer cette personne'}</h2>
            <div className="money-head">
              <span className={`money-dir ${incoming ? 'in' : 'out'}`}>{incoming ? 'Entrée de caisse' : 'Sortie de caisse'}</span>
              <span>
                {selBalance === 0
                  ? `Rien à régler en ${pay.currency}.`
                  : incoming
                    ? <>Cette personne doit <strong className="neg">{formatMoney(Math.abs(selBalance))} {pay.currency}</strong>.</>
                    : <>Vous lui devez <strong className="pos">{formatMoney(Math.abs(selBalance))} {pay.currency}</strong>.</>}
              </span>
            </div>
            <form className="op-form" onSubmit={submitPayment}>
              <div className="field field-grow"><span>{incoming ? 'Caisse qui reçoit' : 'Caisse qui paie'}</span>
                <EntityPicker
                  icon="caisse"
                  value={pay.caisseId}
                  onChange={(v) => {
                    // Choisir une caisse peut changer la devise ; le montant
                    // proposé suit, sinon il resterait celui d'une autre monnaie.
                    const src = officeCaisses.find((c) => String(c.id) === v);
                    const currency = defaultCurrencyFor(src?.office);
                    setPay({ ...pay, caisseId: v, currency, amount: owedIn(balances, currency) });
                  }}
                  options={officeCaisses}
                  labelOf={(c) => c.label}
                  subOf={(c) => `${formatMoney(c.balances?.[pay.currency] ?? 0, pay.currency)} disponible`}
                  searchOf={(c) => c.label}
                  placeholder="Choisir la caisse"
                  emptyText="Aucune caisse de bureau."
                /></div>
              <div className="field"><span>Devise</span>
                <OptionChips
                  ariaLabel="Devise"
                  value={pay.currency}
                  onChange={(v) => setPay({ ...pay, currency: v, amount: owedIn(balances, v) })}
                  options={(currencies.data?.currencies ?? []).map((c) => ({ value: c.code, label: c.code }))}
                /></div>
              <label className="field"><span>Montant</span>
                <AmountInput value={pay.amount}
                  onChange={(v) => setPay({ ...pay, amount: v })} /></label>
              <label className="field field-grow"><span>Note</span>
                <input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="acompte, règlement partiel…" /></label>
              <button className="btn btn-gold" disabled={busy || !pay.caisseId || !(Number(pay.amount) > 0)}>
                {busy ? '…' : incoming ? 'Encaisser' : 'Payer'}
              </button>
            </form>
            <p className="muted line-hint">
              Un montant partiel est accepté : le solde restant reste {incoming ? 'dû par cette personne' : 'dû à cette personne'}.
            </p>

            {/* Anything that is not a plain settlement: an advance, a refund, a
                bonus — in either direction, with or without touching a caisse. */}
            <div className="lines-head" style={{ marginTop: 18 }}>
              <span>Autre opération</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTxForm(txForm ? null : { direction: 'out', type: 'avance', amount: '', caisseId: '', note: '' })}>
                <IconEl name={txForm ? 'close' : 'plus'} />{txForm ? 'Fermer' : 'Opération libre'}
              </button>
            </div>
            {txForm && (
              <form className="op-form" onSubmit={(e) => {
                e.preventDefault();
                runPay(() => idem((key) => api('/person-transactions', { method: 'POST', idem: key, body: {
                  personType: 'personne', personId: Number(id), direction: txForm.direction,
                  amount: txForm.amount, type: txForm.type,
                  caisseId: txForm.caisseId || undefined, note: txForm.note || undefined,
                } })), 'Opération enregistrée.');
                setTxForm(null);
              }}>
                <div className="field"><span>Sens</span>
                  <OptionChips
                    ariaLabel="Sens de l&rsquo;argent"
                    value={txForm.direction}
                    onChange={(v) => setTxForm({ ...txForm, direction: v })}
                    options={[
                      { value: 'out', label: 'Nous versons', icon: 'arrowOut' },
                      { value: 'in', label: 'Elle verse', icon: 'arrowIn' },
                    ]}
                  /></div>
                <div className="field field-full"><span>Nature</span>
                  <OptionChips
                    ariaLabel="Nature de l&rsquo;opération"
                    value={txForm.type}
                    onChange={(v) => setTxForm({ ...txForm, type: v })}
                    options={[
                      { value: 'avance', label: 'Avance' },
                      { value: 'remboursement', label: 'Remboursement' },
                      { value: 'salaire', label: 'Salaire' },
                      { value: 'prime', label: 'Prime' },
                      { value: 'adjustment', label: 'Correction' },
                      { value: 'autre', label: 'Autre' },
                    ]}
                  /></div>
                <label className="field"><span>Montant</span>
                  <AmountInput value={txForm.amount} onChange={(v) => setTxForm({ ...txForm, amount: v })} /></label>
                <div className="field field-grow"><span>Caisse (optionnel)</span>
                  <EntityPicker
                    icon="caisse"
                    value={txForm.caisseId}
                    onChange={(v) => setTxForm({ ...txForm, caisseId: v })}
                    options={officeCaisses}
                    labelOf={(c) => c.label}
                    searchOf={(c) => c.label}
                    placeholder="Écriture seule, sans argent"
                    emptyText="Aucune caisse de bureau."
                  /></div>
                <label className="field field-grow"><span>Note</span>
                  <input value={txForm.note} onChange={(e) => setTxForm({ ...txForm, note: e.target.value })} /></label>
                <button className="btn btn-gold" disabled={busy || !(Number(txForm.amount) > 0)}>Enregistrer</button>
              </form>
            )}
          </div>

          <div className="panel">
            <h2 className="panel-title">Paiements ({personPayments.length})</h2>
            {personPayments.length ? (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Date</th><th>Sens</th><th>Caisse</th><th>Bon</th><th>Par</th><th className="right">Montant</th><th className="right">Actions</th></tr></thead>
                    <tbody>
                      {personPayments.map((p) => (
                        <tr key={p.id}>
                          <td>{new Date(p.created_at).toLocaleString('fr-FR')}</td>
                          <td><span className={`money-dir ${p.type === 'fee_payment' ? 'in' : 'out'}`}>{p.type === 'fee_payment' ? 'Encaissé' : 'Payé'}</span></td>
                          <td className="muted">{p.caisse_label || '—'}</td>
                          <td>{p.bon_reference ? <Link to={p.order_id ? `/bons-fournisseur/${p.order_id}` : `/bons-passager/${p.bon_id}`} className="gold">{p.bon_order_reference ?? p.bon_reference}</Link> : <span className="muted">—</span>}</td>
                          <td className="muted">{p.admin_name}</td>
                          <td className={`right ${p.type === 'fee_payment' ? 'pos' : 'neg'}`}>
                            {formatMoney(Math.abs(Number(p.amount)))} {p.currency_code}
                          </td>
                          <td className="right nowrap">
                            <button className="icon-btn" title="Corriger le montant" aria-label="Corriger" disabled={busy}
                              onClick={() => setEditPay({ id: p.id, amount: String(Math.abs(Number(p.amount))), note: p.note || '', currency: p.currency_code })}>
                              <IconEl name="edit" />
                            </button>
                            {/* Annuler un paiement fait ressortir l'argent de la caisse et rouvre la dette : reserve au super-administrateur. */}
                            {isSuper && (
                              <button className="icon-btn danger" title="Annuler ce paiement" aria-label="Annuler" disabled={busy}
                                onClick={() => setConfirmPay(p)}>
                                <IconEl name="trash" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {editPay && (
                  <form className="op-form" style={{ marginTop: 12, padding: 14, borderRadius: 'var(--radius-soft)', background: 'var(--surface-2)' }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      runPay(() => api(`/payments/${editPay.id}`, { method: 'PATCH', body: { amount: editPay.amount, note: editPay.note || undefined } }), 'Paiement corrigé.');
                    }}>
                    <div className="field field-grow"><span>Corriger le paiement</span>
                      <span className="muted">La caisse et ce compte sont réajustés ensemble.</span></div>
                    <label className="field"><span>Montant ({editPay.currency})</span>
                      <AmountInput autoFocus value={editPay.amount}
                        onChange={(v) => setEditPay({ ...editPay, amount: v })} /></label>
                    <label className="field field-grow"><span>Note</span>
                      <input value={editPay.note} onChange={(e) => setEditPay({ ...editPay, note: e.target.value })} /></label>
                    <button className="btn btn-gold" disabled={busy || !(Number(editPay.amount) > 0)}>Enregistrer</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditPay(null)}><IconEl name="close" />Annuler</button>
                  </form>
                )}
              </>
            ) : <p className="muted pad" style={{ margin: 0 }}>Aucun paiement enregistré pour ce profil.</p>}
          </div>

          <div className="panel panel-accent">
            <h2 className="panel-title">Activité récente</h2>
            {entries.length ? (
              <ul className="timeline">
                {entries.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <span className="type-badge">{ENTRY_LABEL[e.type] || e.type}</span>
                    <span className={Number(e.amount) >= 0 ? 'pos' : 'neg'}>
                      {Number(e.amount) >= 0 ? '+' : '−'}{formatMoney(Math.abs(Number(e.amount)))} {e.currency_code}
                    </span>
                    <span className="muted">{new Date(e.created_at).toLocaleString('fr-FR')} · {e.admin_name}</span>
                    {(e.order_reference || e.bon_reference) && <span className="gold">{e.order_reference || e.bon_reference}</span>}
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon="trend" title="Aucune activité" sub="Les opérations liées à ce profil apparaîtront ici." />}
          </div>
        </>
      )}

      {tab === 'releve' && (
        <div className="panel">
          <h2 className="panel-title">Relevé de compte</h2>
          {entries.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Opération</th><th>Réf.</th><th className="right">Montant</th><th className="right">Solde</th><th>Par</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                      <td>{ENTRY_LABEL[e.type] || e.type}</td>
                      <td className="gold">{e.order_reference || e.bon_reference || '—'}</td>
                      <td className={`right ${Number(e.amount) >= 0 ? 'pos' : 'neg'}`}>
                        {Number(e.amount) >= 0 ? '+' : '−'}{formatMoney(Math.abs(Number(e.amount)))} {e.currency_code}
                      </td>
                      <td className="right">{formatMoney(e.balance_after)} {e.currency_code}</td>
                      <td>{e.admin_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Relevé vide" sub="Aucun mouvement financier pour ce profil." />}
        </div>
      )}

      {tab === 'bons' && (
        <div className="panel">
          <h2 className="panel-title">Bons passagers</h2>
          {bonList.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Référence</th><th>Passager</th><th>Fournisseurs</th><th>Statut</th><th className="right">Frais</th><th className="right">Perte</th><th>Date</th></tr></thead>
                <tbody>
                  {bonList.map((b) => (
                    <tr key={b.id} className="clickable" onClick={() => navigate(`/bons-passager/${b.id}`)}>
                      <td><span className="gold">{b.reference}</span></td>
                      <td>{b.passager_name || '—'}</td>
                      <td className="muted">{b.fournisseur_name || '—'}</td>
                      <td><span className={`status-badge ${BON_STATUS[b.status].cls}`}>{BON_STATUS[b.status].label}</span></td>
                      <td className="right">{formatMoney(b.transport_fee, b.transport_currency)}</td>
                      <td className={`right ${Number(b.loss_total) > 0 ? 'neg' : ''}`}>{formatMoney(b.loss_total)}</td>
                      <td>{new Date(b.created_at).toLocaleDateString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon="bon" title="Aucun bon passager" sub="Ce profil n'a encore aucun bon passager associé." />}
        </div>
      )}

      {tab === 'ordres' && (
        <div className="panel">
          <h2 className="panel-title">Bons fournisseurs</h2>
          {orderList.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Référence</th><th className="right">Bons passagers</th><th>Statut</th><th className="right">Total frais</th><th>Date</th></tr></thead>
                <tbody>
                  {orderList.map((o) => (
                    <tr key={o.id} className="clickable" onClick={() => navigate(`/bons-fournisseur/${o.id}`)}>
                      <td><span className="gold">{o.reference}</span></td>
                      <td className="right">{o.bon_count}</td>
                      <td>{o.status}</td>
                      <td className="right">{formatMoney(o.total_fee)}</td>
                      <td>{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState icon="order" title="Aucun bon fournisseur" sub="Ce fournisseur n'a encore aucun bon fournisseur." />}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmPay)}
        tone="danger"
        title="Annuler ce paiement ?"
        message={confirmPay
          ? `${confirmPay.type === 'fee_payment' ? 'Encaissement' : 'Paiement'} de ${formatMoney(Math.abs(Number(confirmPay.amount)))} ${confirmPay.currency_code}.`
          : ''}
        bullets={[
          confirmPay?.caisse_label ? `Retiré de la caisse « ${confirmPay.caisse_label} ».` : 'Retiré de la caisse.',
          'Le solde de cette personne remonte du même montant.',
        ]}
        confirmLabel="Annuler le paiement"
        busy={busy}
        onCancel={() => setConfirmPay(null)}
        onConfirm={() => runPay(() => api(`/payments/${confirmPay.id}`, { method: 'DELETE' }), 'Paiement annulé.')}
      />
    </div>
  );
}
