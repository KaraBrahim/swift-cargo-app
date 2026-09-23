// La fiche d'un bon passager.
//
// Ce qu'on vient y chercher : qui porte, ce qu'il porte, combien on lui doit, et
// où en est le bon. Ces quatre réponses sont en haut, en tuiles. Les actions
// d'argent — encaisser, payer — ne demandent plus de dérouler une liste de
// caisses : on cherche la caisse comme on cherche une personne, et son solde est
// écrit à côté de son nom.

import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useTabTitle } from '../components/TabsContext.jsx';
import { Spinner, formatMoney, errorMessage, useToast } from '../components/ui.jsx';
import { BON_STATUS, STATUS_ORDER } from '../components/bonStatus.js';
import { IconEl } from '../components/icons.jsx';
import { DetailHead, Kpis, Kpi, Section, Footnote, ScanBanner, StepFlow } from '../components/DetailKit.jsx';
import { EntityPicker, OptionChips } from '../components/EntityPicker.jsx';
import { PrintButton } from '../components/PrintButton.jsx';
import { bonDocBody, measureOf, measureQty, measureUnit, declaredOf } from '../components/printDocument.js';
import { bonTicket } from '../components/printTicket.js';
import { LineEditor, emptyLine, lineValid, lineTotal } from '../components/LineEditor.jsx';
import { GoodsPicker, pickedValid, pickedTotal, pickedToLine } from '../components/GoodsPicker.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import AmountInput from '../components/AmountInput.jsx';
import { formatQty } from '../lib/format.js';
import { useQr } from '../lib/useQr.js';
import { useScanHit, clearScanHit } from '../lib/scanSignal.js';
import { useIdempotent } from '../lib/useIdempotent.js';
import { useIsSuper } from '../auth/AuthContext.jsx';

const NEXT_LABEL = { cree: 'Marquer « En transit »', en_transit: 'Marquer « Arrivé »' };
const NEXT_ICON = { cree: 'plane', en_transit: 'check' };

// Convert a stored bon line back into the editable line shape. A bon passager
// line keeps its link to the bon fournisseur line it draws from.
const toEditLine = (l) => {
  const measure = l.measure || (Number(l.weight_kg) > 0 ? 'poids' : Number(l.cbm) > 0 ? 'cbm' : 'quantite');
  const value = String(measure === 'poids' ? l.weight_kg : measure === 'cbm' ? l.cbm : l.quantity);
  const base = { designation: l.designation, measure, value, unit: l.unit || 'pièce', unitPrice: String(l.unit_price ?? ''), note: l.note || '' };
  if (l.source_line_id) {
    return {
      ...base, sourceLineId: l.source_line_id, remaining: Number(value),
      salePrice: Number(l.source_unit_price ?? 0), sourceLabel: l.source_order_reference || '',
    };
  }
  return { ...base, itemId: l.item_id || null, createItem: false, categoryId: '' };
};

// Les aides de mesure (measureOf, measureQty, measureUnit, declaredOf) viennent de printDocument.js.
const qtyNum = measureQty;
const unitLabel = measureUnit;
const declared = declaredOf;

// `bonId` : ouvert depuis la section des bons FOURNISSEURS, pour éditer les
// marchandises d'un ordre. En base, ces marchandises sont portées par une ligne
// `bons` rattachée à l'ordre — la caisse dans laquelle la marchandise attend —
// et c'est le même écran qui l'édite. Mais cette ligne n'est PAS un bon
// passager : elle n'a pas de passager, elle porte la commission, et son numéro
// BP-… ne désigne, pour l'utilisateur, aucune pièce qui existe. D'où le
// paramètre : l'adresse reste celle du bon fournisseur, et l'écran s'annonce
// sous le numéro BF-… que la personne a en main.
export default function BonDetailPage({ bonId, autoEdit = false }) {
  const { id: routeId } = useParams();
  const id = bonId ?? routeId;
  const navigate = useNavigate();
  const toast = useToast();
  const isSuper = useIsSuper();
  // Un hook, donc AVANT tout retour anticipe : le placer plus bas le faisait
  // sauter au premier rendu (chargement) et exister au second — c'est
  // l'erreur React #310, et elle plantait la page.
  const idem = useIdempotent();
  const { data, loading, error, reload } = useApi(`/bons/${id}`);
  const caisses = useApi('/caisses');
  const currencies = useApi('/currencies');
  const categories = useApi('/stock/categories');
  const passagers = useApi('/people?role=passager');
  const catalogue = useApi('/stock/items');
  const chinaStock = useApi('/stock/levels?office=china');
  const allocatable = useApi(data?.bon && data.bon.order_id == null ? `/bons/allocatable?forBonId=${id}` : null);

  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState({});
  const [payment, setPayment] = useState('');
  const [payMode, setPayMode] = useState('auto');
  const [feeForm, setFeeForm] = useState({ caisseId: '', amount: '' });
  const [payForm, setPayForm] = useState({ caisseId: '', amount: '' });
  // La caisse qui paie au règlement. Vide = régler sans payer tout de suite.
  const [settleCaisse, setSettleCaisse] = useState('');
  // Ce qu'on donne au passager TOUT DE SUITE. Peut être moins que ce qu'on lui
  // doit : on règle le bon, on verse ce qu'on a en caisse, le reste se paie
  // depuis « Argent ». Vide = tout le dû.
  const [settlePaid, setSettlePaid] = useState('');
  const [edit, setEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPayment, setConfirmPayment] = useState(null);
  const [editPayment, setEditPayment] = useState(null);
  const [confirmJump, setConfirmJump] = useState(null);

  // Le code imprimé sur le papier, préparé pendant que la fiche s'affiche.
  const qr = useQr('bon', data?.bon?.uuid);
  // La douchette vient-elle d'ouvrir CETTE fiche ?
  const scanHit = useScanHit('bon', id);
  const goodsRef = useRef(null);
  const moneyRef = useRef(null);

  // Un bon fournisseur s'annonce sous SON numéro — celui de l'ordre, BF-… —
  // et jamais sous le BP-… interne de sa ligne de marchandises.
  useTabTitle(data?.bon?.order_reference ?? data?.bon?.reference);
  const bon = data?.bon;

  useEffect(() => {
    if (bon) {
      const init = {};
      for (const l of bon.lines) {
        // Jamais réconciliée : tout est réputé arrivé. Déjà réconciliée : on
        // rouvre sur ce qui avait été compté, coché ou non selon qu'il manquait
        // quelque chose.
        const q = qtyNum(l);
        const got = l.received_quantity != null ? Number(l.received_quantity) : q;
        init[l.id] = { full: got >= q, received: String(got), responsible: l.responsible ?? '' };
      }
      setRec(init);
      // Les deux formulaires d'argent s'ouvrent sur ce qui RESTE dû, pas sur le
      // total d'origine : payer deux fois un bon à moitié réglé est l'erreur
      // qu'il faut rendre impossible.
      const paidOf = (type) =>
        (bon.payments ?? []).filter((p) => p.type === type)
          .reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0);
      const due = (total, type) => Math.max(Number(total ?? 0) - paidOf(type), 0).toFixed(2);
      setFeeForm((f) => ({ ...f, amount: due(bon.transport_fee, 'fee_payment') }));
      setPayForm((f) => ({ ...f, amount: due(bon.passager_payment, 'passager_payment') }));
    }
  }, [bon]);

  // « Modifier » depuis le bon fournisseur ouvre le formulaire tout de suite.
  // Ce hook DOIT précéder les retours anticipés ci-dessous : un hook placé
  // après change le nombre de hooks d'un rendu à l'autre, et React s'arrête
  // (erreur #310). openEdit est défini plus bas ; on le lit via une ref.
  const autoOpened = useRef(false);
  const openEditRef = useRef(null);
  useEffect(() => {
    if (!autoEdit || autoOpened.current || !bon || bon.status !== 'cree' || allocatable.loading) return;
    autoOpened.current = true;
    openEditRef.current?.();
  }, [autoEdit, bon, allocatable.loading]);

  if (loading) return <Spinner />;
  if (error) return <div className="alert alert-error">{error}</div>;

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const advance = () => act(() => api(`/bons/${id}/advance`, { method: 'POST', body: {} }), 'Statut mis à jour.');
  const doJump = (target) =>
    act(() => api(`/bons/${id}/status`, { method: 'POST', body: { target } })
      .then(() => { chinaStock.reload(); catalogue.reload(); }), 'Statut mis à jour.');
  const jumpStatus = (target) => {
    if (target === bon.status) return;
    if (STATUS_ORDER.indexOf(target) < STATUS_ORDER.indexOf(bon.status)) { setConfirmJump(target); return; }
    doJump(target);
  };
  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/bons/${id}`, { method: 'DELETE' });
      toast.success(`Bon ${bon.order_reference ?? bon.reference} supprimé.`);
      // On revient là d'où l'on vient : la liste des bons passagers, ou la fiche
      // du bon fournisseur dont on éditait les marchandises.
      navigate(bon.order_id ? `/bons-fournisseur/${bon.order_id}` : '/bons-passager');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  // Les quatre gestes qui touchent à l'argent passent par idem() : un réessai
  // après une coupure porte la même clé et ne rejoue rien. Voir useIdempotent.
  // Ce qui est ARRIVÉ, ligne par ligne — la case cochée valant « tout ».
  // L'API accepte `receivedQuantity` aussi bien que `missing` ; on lui envoie
  // celui des deux que la personne au comptoir a réellement compté.
  const receivedOf = (l) => {
    const r = rec[l.id];
    if (!r || r.full) return qtyNum(l);
    const v = Number(r.received);
    return Number.isFinite(v) ? Math.max(v, 0) : 0;
  };
  const reconcile = () =>
    act(() => idem((key) => api(`/bons/${id}/reconcile`, {
      method: 'POST', idem: key,
      body: {
        lines: bon.lines.map((l) => ({
          lineId: l.id,
          receivedQuantity: String(receivedOf(l)),
          responsible: receivedOf(l) < qtyNum(l) ? rec[l.id]?.responsible : undefined,
        })),
      },
    })), 'Réconciliation enregistrée.');
  const settle = () =>
    act(() => idem((key) => api(`/bons/${id}/settle`, {
      method: 'POST', idem: key,
      body: {
        passagerPayment: payment || undefined,
        caisseId: settleCaisse ? Number(settleCaisse) : undefined,
        paidNow: settleCaisse && settlePaid ? settlePaid : undefined,
      },
    })), settleCaisse ? 'Bon réglé et passager payé.' : 'Bon réglé — passager à payer.');
  const collectFee = () =>
    act(() => idem((key) => api(`/bons/${id}/collect-fee`, { method: 'POST', idem: key, body: { caisseId: Number(feeForm.caisseId), amount: feeForm.amount } })), 'Frais encaissés.');
  const payPassager = () =>
    act(() => idem((key) => api(`/bons/${id}/pay-passager`, { method: 'POST', idem: key, body: { caisseId: Number(payForm.caisseId), amount: payForm.amount } })), 'Passager payé.');

  const isFournisseurBon = bon.order_id != null;
  // L'action que le bandeau propose. Avancer d'un cran passe par le même chemin
  // que le bouton ordinaire ; les deux autres ne font que porter le regard là où
  // la saisie attend.
  const runScanAction = () => {
    const act = scanHit?.next?.action;
    clearScanHit();
    if (act === 'advance') advance();
    else if (act === 'reconcile') goodsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (act === 'pay') moneyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const toPickedLine = (l, index) => {
    const e = toEditLine(l);
    const src = index.get(String(l.source_line_id));
    return {
      ...e,
      sourceLineId: l.source_line_id,
      remaining: src ? Number(src.remaining) : Number(e.value),
      salePrice: Number(l.source_unit_price ?? src?.sale_price ?? 0),
      // La valeur du manquant deja convenue sur ce bon, pas celle par defaut.
      missingPrice: String(l.missing_unit_price ?? l.source_unit_price ?? ''),
      fournisseurId: src?.fournisseur_id ?? null,
      fournisseurName: src?.fournisseur_name || '—',
      sourceLabel: l.source_order_reference || src?.order_reference || '',
    };
  };
  const openEdit = () => {
    const index = new Map((allocatable.data?.lines ?? []).map((o) => [String(o.line_id), o]));
    setEdit({
      transportCurrency: bon.transport_currency,
      commission: String(bon.commission ?? '0'),
      passagerId: bon.passager_id ? String(bon.passager_id) : '',
      lines: bon.lines.map((l) => (isFournisseurBon ? toEditLine(l) : toPickedLine(l, index))),
    });
  };
  openEditRef.current = openEdit;
  const setEditLine = (i, next) => setEdit((e) => ({ ...e, lines: e.lines.map((l, idx) => (idx === i ? next : l)) }));
  const addEditLine = () => setEdit((e) => ({ ...e, lines: [...e.lines, emptyLine()] }));
  const removeEditLine = (i) => setEdit((e) => ({ ...e, lines: e.lines.filter((_, idx) => idx !== i) }));
  const editValid = edit && edit.lines.length > 0 && edit.lines.every(isFournisseurBon ? lineValid : pickedValid);
  const editLinesTotal = edit ? edit.lines.reduce((s, l) => s + (isFournisseurBon ? lineTotal(l) : pickedTotal(l)), 0) : 0;
  const editTotal = editLinesTotal + (isFournisseurBon ? Number(edit?.commission || 0) : 0);
  const saveEdit = () =>
    act(async () => {
      await api(`/bons/${id}`, {
        method: 'PATCH',
        body: {
          transportCurrency: edit.transportCurrency,
          ...(isFournisseurBon ? { commission: edit.commission || '0' } : { passagerId: edit.passagerId || null }),
          lines: isFournisseurBon ? edit.lines : edit.lines.map(pickedToLine),
        },
      });
      setEdit(null);
      catalogue.reload();
      chinaStock.reload();
    }, 'Bon modifié.');

  const offices = (caisses.data?.caisses ?? []).filter((c) => c.kind === 'office');
  const cur = bon.transport_currency;
  // Le solde de la caisse dans la devise du bon, écrit sous son nom : c'est la
  // question qu'on se pose au moment de choisir laquelle paie.
  const caisseSub = (c) => `${formatMoney(c.balances?.[cur] ?? 0, cur)} disponible`;

  const reconciling = bon.status === 'arrive';

  // Un bon dont il manque quelque chose ne doit pas ressembler à un bon complet.
  // Marque MUETTE, pas dorée : le manquant est déjà constaté et porté en avoir
  // au fournisseur — c'est un fait, pas une tâche. Réserver la couleur à ce qui
  // attend encore un geste est ce qui lui garde son sens.
  const reconciled = bon.lines.filter((l) => l.received_quantity != null);
  const shortLines = reconciled.filter((l) => Number(l.received_quantity) < qtyNum(l));
  const arriveFill = reconciled.length
    ? reconciled.reduce((s, l) => s + Math.min(1, qtyNum(l) > 0 ? Number(l.received_quantity) / qtyNum(l) : 1), 0) / reconciled.length
    : null;
  const steps = STATUS_ORDER.map((key) => {
    const step = { key, label: BON_STATUS[key].label };
    if (key === 'arrive' && shortLines.length && Number(bon.loss_total) > 0) {
      return {
        ...step, fill: arriveFill, tag: 'incomplet', tone: 'settled',
        title: `${bon.lines.length - shortLines.length} lot(s) sur ${bon.lines.length} arrivés complets · `
          + `${shortLines.length} incomplet(s), ${formatMoney(bon.loss_total, bon.transport_currency)} portés en avoir`,
      };
    }
    return step;
  });

  // Un manquant vaut ce que vaut la marchandise (« valeur du manquant »), pas
  // son tarif de portage — exactement ce que le serveur enregistre. Si les
  // pertes dépassent le portage, le passager n'est pas payé : il nous doit la
  // différence.
  const recMissingTotal = bon.lines.reduce(
    (s, l) => s + Number(l.missing_unit_price ?? l.unit_price) * Math.max(qtyNum(l) - receivedOf(l), 0), 0
  );
  const recNet = Number(bon.transport_fee) - recMissingTotal;
  const recDeliveredTotal = Math.max(recNet, 0);
  const recOwedByPassager = Math.max(-recNet, 0);

  const fourns = bon.fournisseurs ?? [];
  const fournValue = isFournisseurBon
    ? bon.fournisseur_name
    : fourns.length === 0 ? '—' : fourns.length === 1 ? fourns[0].name : `${fourns.length} fournisseurs`;
  const fournTo = isFournisseurBon
    ? `/personnes/${bon.fournisseur_id}`
    : fourns.length === 1 ? `/personnes/${fourns[0].id}` : null;

  return (
    <div>
      {/* Deux pièces distinctes, deux identités. Un bon fournisseur porte son
          numéro BF-… et l'icône des ordres ; un bon passager le sien. L'écran
          affichait jusqu'ici le BP-… interne en titre, avec le vrai numéro en
          sous-titre — soit exactement l'inverse. */}
      <DetailHead
        icon={isFournisseurBon ? 'order' : 'bon'}
        accent={isFournisseurBon ? 'var(--c-order)' : 'var(--c-bon)'}
        title={isFournisseurBon ? bon.order_reference : bon.reference}
        status={<span className={`status-badge ${BON_STATUS[bon.status].cls}`}>{BON_STATUS[bon.status].label}</span>}
        sub={isFournisseurBon && (
          <Link to={`/bons-fournisseur/${bon.order_id}`} className="dt-link">
            <IconEl name="order" />Revenir à la fiche du bon fournisseur
          </Link>
        )}
        actions={
          <>
            {bon.status === 'cree' && (
              <button className="btn" onClick={() => (edit ? setEdit(null) : openEdit())} title={edit ? 'Annuler la modification' : 'Modifier le bon'}>
                <IconEl name={edit ? 'close' : 'edit'} />{edit ? 'Annuler' : 'Modifier'}
              </button>
            )}
            <PrintButton
              title={bon.reference}
              docTitle="Bon passager"
              subtitle={bon.reference}
              a4={() => bonDocBody(bon, qr)}
              ticket={(societe) => bonTicket(bon, societe, qr)}
            />
            {/* Supprimer definitivement : reserve au super-administrateur. */}
            {isSuper && (
              <button className="btn btn-danger" disabled={busy} title="Supprimer ce bon" onClick={() => setConfirmDelete(true)}>
                <IconEl name="trash" />
              </button>
            )}
          </>
        }
      />

      <ScanBanner hit={scanHit} onAct={runScanAction} onDismiss={clearScanHit} />

      {/* Cliquable, contrairement à celui d'un ordre : le statut d'un bon est
          réel — stocké, avancé à la main — pas déduit. */}
      <StepFlow steps={steps} current={bon.status} onJump={jumpStatus} busy={busy} />

      {/* Un bon fournisseur n'a pas de passager : à sa place, ce qu'il contient.
          Une tuile qui dit « — » occupe la même surface qu'une qui informe. */}
      <Kpis>
        {isFournisseurBon ? (
          <Kpi icon="box" label="Marchandises" value={`${bon.lines.length} ${bon.lines.length > 1 ? 'lots' : 'lot'}`} />
        ) : (
          <Kpi icon="passager" label="Passager" value={bon.passager_name || '—'} sub={bon.passager_phone} person
            to={bon.passager_id ? `/personnes/${bon.passager_id}` : undefined} />
        )}
        <Kpi icon="fournisseur" label={fourns.length > 1 ? 'Fournisseurs' : 'Fournisseur'} value={fournValue}
          sub={fourns.length > 1 ? fourns.map((f) => f.name).join(', ') : null} to={fournTo || undefined} />
        <Kpi hero icon="coins" tone="gold"
          label={isFournisseurBon ? 'Facturé' : bon.status === 'regle' ? 'Payé au passager' : 'À payer'}
          value={formatMoney(bon.status === 'regle' && bon.passager_payment != null ? bon.passager_payment : bon.transport_fee, cur)}
          sub={isFournisseurBon && Number(bon.commission) > 0
            ? `dont ${formatMoney(bon.commission, cur)} de commission`
            : null} />
        <Kpi icon="alert" label="Manquants" value={formatMoney(bon.loss_total, cur)} tone={Number(bon.loss_total) > 0 ? 'neg' : ''} />
      </Kpis>

      {NEXT_LABEL[bon.status] && !edit && (
        <div className="dt-next">
          <button className="btn btn-gold" disabled={busy} onClick={advance}>
            <IconEl name={NEXT_ICON[bon.status]} />{NEXT_LABEL[bon.status]}
          </button>
        </div>
      )}

      {edit && (
        <Section icon="edit" title="Modifier le bon">
          <div className="wz-money">
            {!isFournisseurBon && (
              <div className="field field-grow">
                <span>Passager</span>
                <EntityPicker
                  icon="passager"
                  value={edit.passagerId}
                  onChange={(v) => setEdit({ ...edit, passagerId: v })}
                  options={passagers.data?.people ?? []}
                  loading={passagers.loading}
                  placeholder="Chercher un passager"
                  subOf={(p) => p.phone || null}
                  searchOf={(p) => `${p.name} ${p.phone || ''}`}
                />
              </div>
            )}
            <div className="field">
              <span>Devise</span>
              <OptionChips
                ariaLabel="Devise"
                value={edit.transportCurrency}
                onChange={(v) => setEdit({ ...edit, transportCurrency: v })}
                options={(currencies.data?.currencies ?? []).map((c) => ({ value: c.code, label: c.code }))}
              />
            </div>
            {isFournisseurBon && (
              <label className="field wz-amount"><span>Commission</span>
                <AmountInput value={edit.commission} onChange={(v) => setEdit({ ...edit, commission: v })} /></label>
            )}
          </div>

          {isFournisseurBon ? (
            <>
              <div className="wz-lines">
                {edit.lines.map((l, i) => (
                  <LineEditor
                    key={i}
                    line={l}
                    items={catalogue.data?.items ?? []}
                    categories={categories.data?.categories ?? []}
                    onPatch={(nl) => setEditLine(i, nl)}
                    onRemove={() => removeEditLine(i)}
                    removable={edit.lines.length > 1}
                    autoFocus={i === edit.lines.length - 1}
                    allowCreate
                  />
                ))}
              </div>
              <button type="button" className="wz-add" onClick={addEditLine}>
                <IconEl name="plus" />Ajouter une marchandise
              </button>
              <div className="form-total form-total-sub">
                <span>Marchandises</span>
                <strong>{formatMoney(editLinesTotal, edit.transportCurrency)}</strong>
              </div>
              <div className="form-total">
                <span>À facturer au fournisseur</span>
                <strong>{formatMoney(editTotal, edit.transportCurrency)}</strong>
              </div>
            </>
          ) : (
            <GoodsPicker
              options={allocatable.data?.lines ?? []}
              picked={edit.lines}
              currency={edit.transportCurrency}
              loading={allocatable.loading}
              onChange={(lines) => setEdit((e) => ({ ...e, lines }))}
            />
          )}

          <div className="dt-actions">
            <button className="btn btn-gold" disabled={busy || !editValid} onClick={saveEdit}>
              <IconEl name="check" />{busy ? '…' : 'Enregistrer'}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEdit(null)}>
              <IconEl name="close" />Annuler
            </button>
          </div>
        </Section>
      )}

      <div ref={goodsRef} />
      <Section icon="box" title="Marchandises" count={bon.lines.length}>
        {reconciling && (
          <p className="dt-hint">
            <IconEl name="alert" />
            Tout est coché comme <strong>arrivé</strong>. Décochez une ligne et saisissez ce que vous
            avez compté — le manquant se calcule tout seul.
          </p>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th className="right">{isFournisseurBon ? 'Prix de revient' : 'Prix de transport'}</th>
                {!isFournisseurBon && <th className="right">Valeur du manquant</th>}
                <th className="right">Quantité</th>
                {reconciling ? (
                  <><th className="right">Arrivé</th><th className="right">Manquant</th><th className="right">Montant</th><th>Responsable</th></>
                ) : (
                  <><th className="right">Manquant</th><th className="right">Montant</th></>
                )}
              </tr>
            </thead>
            <tbody>
              {bon.lines.map((l) => {
                const q = qtyNum(l);
                const up = Number(l.unit_price);
                if (reconciling) {
                  const r = rec[l.id] ?? { full: true, received: String(q), responsible: '' };
                  const arrived = receivedOf(l);
                  const miss = Math.max(q - arrived, 0);
                  const over = arrived > q;
                  return (
                    <tr key={l.id}>
                      <td>{l.designation}</td>
                      <td className="right">{formatMoney(up, cur)} <span className="muted">/ {unitLabel(l)}</span></td>
                      {!isFournisseurBon && (
                        <td className="right">{formatMoney(l.missing_unit_price, cur)} <span className="muted">/ {unitLabel(l)}</span></td>
                      )}
                      <td className="right">{declared(l)}</td>
                      {/* La case cochée est le cas ordinaire : tout est arrivé.
                          La décocher ouvre le champ et demande le nombre qu'on
                          vient de COMPTER — pas celui qu'il faut soustraire. */}
                      <td className="right rec-arrived">
                        <label className="rec-all" title="Tout est arrivé">
                          <input
                            type="checkbox"
                            checked={r.full}
                            onChange={(e) => setRec({
                              ...rec,
                              [l.id]: { ...r, full: e.target.checked, received: e.target.checked ? String(q) : r.received },
                            })}
                          />
                          <span>tout</span>
                        </label>
                        {!r.full && (
                          <AmountInput decimals={3} className={`mini-input ${over ? 'input-error' : ''}`}
                            step={measureOf(l) === 'cbm' ? 0.1 : 1} max={q}
                            value={r.received ?? ''}
                            onChange={(v) => setRec({ ...rec, [l.id]: { ...r, received: v } })} />
                        )}
                      </td>
                      <td className={`right ${miss > 0 ? 'neg' : 'muted'}`}>
                        {miss > 0 ? `${formatQty(miss)} ${unitLabel(l)}` : '—'}
                      </td>
                      <td className="right gold">{formatMoney(arrived * up, cur)}</td>
                      {/* Demander un responsable sur une ligne complète, c'est le
                          demander sur chaque ligne de chaque bon normal. */}
                      <td>
                        {miss > 0
                          ? <input className="mini-input" value={r.responsible ?? ''}
                              onChange={(e) => setRec({ ...rec, [l.id]: { ...r, responsible: e.target.value } })}
                              placeholder="responsable…" />
                          : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                }
                const missDone = l.received_quantity != null ? Math.max(q - Number(l.received_quantity), 0) : 0;
                return (
                  <tr key={l.id}>
                    <td>{l.designation}</td>
                    <td className="right">{formatMoney(up, cur)} <span className="muted">/ {unitLabel(l)}</span></td>
                    {!isFournisseurBon && (
                      <td className="right">{formatMoney(l.missing_unit_price, cur)} <span className="muted">/ {unitLabel(l)}</span></td>
                    )}
                    <td className="right">{declared(l)}</td>
                    <td className={`right ${missDone > 0 ? 'neg' : 'muted'}`}>{missDone > 0 ? `${formatQty(missDone)} ${unitLabel(l)}` : '—'}</td>
                    <td className="right">{formatMoney(up * (l.received_quantity != null ? Number(l.received_quantity) : q), cur)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td colSpan={(reconciling ? 5 : 4) + (isFournisseurBon ? 0 : 1)} className="right">Total {reconciling ? 'à payer (livré)' : bon.status === 'regle' ? 'payé' : 'commandé'}</td>
                <td className="right gold"><strong>{formatMoney(reconciling ? recDeliveredTotal : (bon.status === 'regle' ? bon.passager_payment ?? 0 : bon.transport_fee), cur)}</strong></td>
                {reconciling && <td />}
              </tr>
            </tfoot>
          </table>
        </div>

        {reconciling && (
          <div className="reconcile-actions">
            <div className="recon-sum">
              <span>Commandé <strong>{formatMoney(bon.transport_fee, cur)}</strong></span>
              <span>Manquants <strong className={recMissingTotal > 0 ? 'neg' : ''}>{formatMoney(recMissingTotal, cur)}</strong></span>
              {recOwedByPassager > 0 && payMode === 'auto'
                ? <span>À la charge du passager <strong className="neg">{formatMoney(recOwedByPassager, cur)}</strong></span>
                : <span>Dû au passager <strong className="gold">{formatMoney(payMode === 'manual' && payment !== '' ? Number(payment || 0) : recDeliveredTotal, cur)}</strong></span>}
            </div>
            {payMode === 'auto' && recOwedByPassager > 0 && (
              <p className="dt-hint">
                <IconEl name="alert" />
                Les manquants ({formatMoney(recMissingTotal, cur)}) dépassent le portage ({formatMoney(bon.transport_fee, cur)}) :
                le passager ne sera pas payé et devra <strong className="neg">{formatMoney(recOwedByPassager, cur)}</strong>, inscrits à son compte au règlement.
              </p>
            )}

            <div className="dt-actions">
              <button className="btn" disabled={busy} onClick={reconcile}><IconEl name="check" />Enregistrer les manquants</button>
            </div>

            <div className="dt-sub">
              <span className="dt-sub-title">Montant dû au passager</span>
              <OptionChips
                ariaLabel="Mode de calcul"
                value={payMode}
                onChange={(v) => { setPayMode(v); setPayment(v === 'manual' ? String(recDeliveredTotal.toFixed(2)) : ''); }}
                options={[
                  { value: 'auto', label: 'Calculé', icon: 'chart' },
                  { value: 'manual', label: 'Montant libre', icon: 'edit' },
                ]}
              />
              {payMode === 'auto' ? (
                <p className="dt-hint">
                  {formatMoney(bon.transport_fee, cur)} − {formatMoney(recMissingTotal, cur)} de manquants
                  = <strong className="gold">{formatMoney(recDeliveredTotal, cur)}</strong>
                </p>
              ) : (
                <label className="field wz-amount"><span>Prix du service ({cur})</span>
                  <AmountInput autoFocus value={payment} onChange={(v) => setPayment(v)} /></label>
              )}
              <div className="wz-money" style={{ marginTop: 10 }}>
                <div className="field field-grow"><span>Caisse qui paie le passager</span>
                  <EntityPicker
                    icon="caisse"
                    value={settleCaisse}
                    onChange={(v) => {
                      setSettleCaisse(v);
                      // Le cas ordinaire est de tout verser : le champ s'ouvre
                      // sur le dû, pas sur un vide à remplir.
                      if (v && !settlePaid) setSettlePaid(String((payMode === 'manual' && payment !== '' ? Number(payment || 0) : recDeliveredTotal).toFixed(2)));
                    }}
                    options={offices}
                    labelOf={(c) => c.label}
                    subOf={caisseSub}
                    searchOf={(c) => c.label}
                    placeholder="Payer plus tard (choisir une caisse pour payer maintenant)"
                    emptyText="Aucune caisse de bureau."
                  /></div>
                {settleCaisse && (
                  <label className="field wz-amount"><span>Versé maintenant ({cur})</span>
                    <AmountInput value={settlePaid} onChange={setSettlePaid} /></label>
                )}
              </div>
              <div className="dt-actions">
                <button className="btn btn-gold" disabled={busy || (payMode === 'manual' && !(Number(payment) >= 0))} onClick={settle}>
                  <IconEl name="check" />{settleCaisse
                    ? `Régler et verser ${formatMoney(Number(settlePaid || 0), cur)}`
                    : 'Régler (payer plus tard)'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Section>

      <div ref={moneyRef} />
      <Section icon="caisse" title="Argent">
        {bon.payments?.length > 0 && (
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="table table-tight">
              <thead><tr><th>Date</th><th>Sens</th><th>Personne</th><th>Caisse</th><th className="right">Montant</th><th className="right" /></tr></thead>
              <tbody>
                {bon.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="muted">{new Date(p.created_at).toLocaleDateString('fr-FR')}</td>
                    <td>
                      <span className={`money-dir ${p.type === 'fee_payment' ? 'in' : 'out'}`}>
                        <IconEl name={p.type === 'fee_payment' ? 'arrowIn' : 'arrowOut'} />
                        {p.type === 'fee_payment' ? 'Encaissé' : 'Payé'}
                      </span>
                    </td>
                    <td>{p.person_name}</td>
                    <td className="muted">{p.caisse_label || '—'}</td>
                    <td className="right">{formatMoney(p.amount, p.currency_code)}</td>
                    <td className="right nowrap">
                      <button className="icon-btn" title="Corriger le montant" aria-label="Corriger ce paiement"
                        disabled={busy} onClick={() => setEditPayment({ id: p.id, amount: String(Math.abs(Number(p.amount))), note: p.note || '', currency: p.currency_code })}>
                        <IconEl name="edit" />
                      </button>
                      {/* Annuler un paiement fait ressortir l'argent de la caisse et rouvre la dette : reserve au super-administrateur. */}
                      {isSuper && (
                        <button className="icon-btn danger" title="Annuler ce paiement" aria-label="Annuler ce paiement"
                          disabled={busy} onClick={() => setConfirmPayment(p)}>
                          <IconEl name="trash" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editPayment && (
          <form
            className="dt-sub"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api(`/payments/${editPayment.id}`, { method: 'PATCH', body: { amount: editPayment.amount, note: editPayment.note || undefined } });
                setEditPayment(null);
              }, 'Paiement corrigé.');
            }}
          >
            <span className="dt-sub-title">Corriger le paiement</span>
            <div className="wz-money">
              <label className="field wz-amount"><span>Montant ({editPayment.currency})</span>
                <AmountInput autoFocus value={editPayment.amount} onChange={(v) => setEditPayment({ ...editPayment, amount: v })} /></label>
              <label className="field field-grow"><span>Note</span>
                <input value={editPayment.note} onChange={(e) => setEditPayment({ ...editPayment, note: e.target.value })} /></label>
            </div>
            <div className="dt-actions">
              <button className="btn btn-gold" disabled={busy || !(Number(editPayment.amount) > 0)}><IconEl name="check" />Enregistrer</button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditPayment(null)}><IconEl name="close" />Annuler</button>
            </div>
          </form>
        )}

        {isFournisseurBon ? (
          <div className="money-block">
            <div className="money-head">
              <span className="money-dir in"><IconEl name="arrowIn" />Entrée</span>
              <span>Le fournisseur <strong>{bon.fournisseur_name}</strong> vous règle le transport.</span>
            </div>
            <div className="wz-money">
              <div className="field field-grow"><span>Caisse qui reçoit</span>
                <EntityPicker
                  icon="caisse"
                  value={feeForm.caisseId}
                  onChange={(v) => setFeeForm({ ...feeForm, caisseId: v })}
                  options={offices}
                  labelOf={(c) => c.label}
                  subOf={caisseSub}
                  searchOf={(c) => c.label}
                  placeholder="Choisir la caisse"
                  emptyText="Aucune caisse de bureau."
                /></div>
              <label className="field wz-amount"><span>Montant reçu</span>
                <AmountInput value={feeForm.amount} onChange={(v) => setFeeForm({ ...feeForm, amount: v })} /></label>
              <button className="btn btn-gold" disabled={busy || !feeForm.caisseId || !(Number(feeForm.amount) > 0)} onClick={collectFee}>
                <IconEl name="arrowIn" />Encaisser
              </button>
            </div>
          </div>
        ) : (
          <div className="money-block">
            <div className="money-head">
              <span className="money-dir out"><IconEl name="arrowOut" />Sortie</span>
              <span>Vous payez le passager <strong>{bon.passager_name || '—'}</strong>.</span>
            </div>
            {bon.status === 'regle' && bon.passager_id ? (
              <div className="wz-money">
                <div className="field field-grow"><span>Caisse qui paie</span>
                  <EntityPicker
                    icon="caisse"
                    value={payForm.caisseId}
                    onChange={(v) => setPayForm({ ...payForm, caisseId: v })}
                    options={offices}
                    labelOf={(c) => c.label}
                    subOf={caisseSub}
                    searchOf={(c) => c.label}
                    placeholder="Choisir la caisse"
                    emptyText="Aucune caisse de bureau."
                  /></div>
                <label className="field wz-amount"><span>Montant versé</span>
                  <AmountInput value={payForm.amount} onChange={(v) => setPayForm({ ...payForm, amount: v })} /></label>
                <button className="btn btn-gold" disabled={busy || !payForm.caisseId || !(Number(payForm.amount) > 0)} onClick={payPassager}>
                  <IconEl name="arrowOut" />Payer
                </button>
              </div>
            ) : (
              <p className="dt-hint">
                <IconEl name="help" />Le montant se fixe au règlement du bon, une fois les manquants connus.
              </p>
            )}
          </div>
        )}
      </Section>

      <Section icon="audit" title="Historique" count={bon.history.length}>
        <ul className="timeline">
          {bon.history.map((h) => (
            <li key={h.id}>
              <span className={`status-badge ${BON_STATUS[h.status]?.cls || ''}`}>{BON_STATUS[h.status]?.label || h.status}</span>
              <span className="muted">{new Date(h.created_at).toLocaleString('fr-FR')} · {h.admin_name}</span>
              {h.note && <span className="tl-note">{h.note}</span>}
            </li>
          ))}
        </ul>
      </Section>

      <Footnote by={bon.created_by_name} at={bon.created_at} />

      <ConfirmDialog
        open={!!confirmJump}
        tone="danger"
        title={confirmJump ? `Revenir à « ${BON_STATUS[confirmJump].label} » ?` : ''}
        message="Ce retour en arrière annulera automatiquement les opérations postérieures :"
        bullets={[
          'Mouvements de stock (retour en Chine / sortie d’Algérie)',
          'Paiements et écritures déjà enregistrés',
          'Réconciliation des manquants',
        ]}
        confirmLabel="Revenir en arrière"
        busy={busy}
        onCancel={() => setConfirmJump(null)}
        onConfirm={() => { const t = confirmJump; setConfirmJump(null); doJump(t); }}
      />

      <ConfirmDialog
        open={Boolean(confirmPayment)}
        tone="danger"
        title="Annuler ce paiement ?"
        message={confirmPayment
          ? `${confirmPayment.type === 'fee_payment' ? 'Encaissement' : 'Paiement'} de ${formatMoney(confirmPayment.amount, confirmPayment.currency_code)} — ${confirmPayment.person_name}.`
          : ''}
        bullets={[
          confirmPayment?.caisse_label ? `Retiré de la caisse « ${confirmPayment.caisse_label} ».` : 'Retiré de la caisse.',
          'Le compte de la personne redevient débiteur / créditeur du même montant.',
        ]}
        confirmLabel="Annuler le paiement"
        busy={busy}
        onCancel={() => setConfirmPayment(null)}
        onConfirm={() => act(async () => {
          await api(`/bons/${id}/payments/${confirmPayment.id}`, { method: 'DELETE' });
          setConfirmPayment(null);
        }, 'Paiement annulé.')}
      />

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title={`Supprimer le bon ${bon.reference} ?`}
        message="Le bon est d’abord ramené à « Créé », ce qui annule tout ce qui en découle, puis supprimé définitivement :"
        bullets={[
          'Mouvements de stock liés à ce bon',
          'Sommes dues au passager et avoirs du fournisseur',
          isFournisseurBon ? 'Réception en Chine et facturation du fournisseur' : 'Marchandises rendues au bon fournisseur d’origine',
          'Refusé si de l’argent est déjà passé en caisse pour ce bon.',
        ]}
        confirmLabel="Supprimer définitivement"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </div>
  );
}
