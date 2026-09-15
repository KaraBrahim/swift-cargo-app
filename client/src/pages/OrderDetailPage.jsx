// La fiche d'un bon fournisseur.
//
// Trois choses à voir en arrivant : à qui appartient la marchandise, ce qu'elle
// vaut, et ce qui en reste à confier. Le reste — qui a créé la fiche, la
// devise, le trajet — n'a jamais besoin d'être lu en premier.

import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useTabTitle } from '../components/TabsContext.jsx';
import { Spinner, formatMoney, errorMessage, useToast, EmptyState } from '../components/ui.jsx';
import { ORDER_STATUS, ORDER_ORDER } from '../components/orderStatus.js';
import { BON_STATUS } from '../components/bonStatus.js';
import { IconEl } from '../components/icons.jsx';
import { DetailHead, Kpis, Kpi, Bar, Section, Footnote, ScanBanner, StepFlow } from '../components/DetailKit.jsx';
import { Who } from '../components/cells.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import AmountInput from '../components/AmountInput.jsx';
import { PrintButton } from '../components/PrintButton.jsx';
import { orderManifestBody } from '../components/printDocument.js';
import { orderTicket } from '../components/printTicket.js';
import { formatQty } from '../lib/format.js';
import { useQr } from '../lib/useQr.js';
import { useScanHit, clearScanHit } from '../lib/scanSignal.js';
import { useIsSuper } from '../auth/AuthContext.jsx';

const unitOf = (l) => (l.measure === 'poids' ? 'kg' : l.measure === 'cbm' ? 'm³' : l.unit || 'u');

export default function OrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isSuper = useIsSuper();
  const { data, loading, error, reload } = useApi(`/orders/${id}`);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // La remise en cours de saisie : lineId → quantité tapée. Remplie à
  // l'ouverture de la fenêtre plutôt que par un effet, pour que rien ne dépende
  // de `data` avant les retours anticipés au-dessus.
  const [deliver, setDeliver] = useState(null);
  const [confirmUndoDeliver, setConfirmUndoDeliver] = useState(false);
  const qr = useQr('order', data?.order?.uuid);
  const scanHit = useScanHit('order', id);
  useTabTitle(data?.order?.reference);

  if (loading) return <Spinner />;
  if (error) return <div className="alert alert-error">{error}</div>;

  const o = data.order;
  const cur = o.bons?.[0]?.transport_currency || 'DZD';
  const lines = o.lines ?? [];
  // « Confié » se compte en lots, pas en unités : additionner des kilos et des
  // cartons ne voudrait rien dire.
  const done = lines.filter((l) => Number(l.remaining) <= 0).length;
  // Livré aussi en lots : c'est la même unité de compte que « Confié », et
  // additionner des kilos et des cartons ne voudrait pas plus dire ici.
  const deliveredLots = lines.filter((l) => Number(l.arrived) > 0 && Number(l.deliverable) <= 0).length;
  const arrivedLots = lines.filter((l) => Number(l.arrived) > 0).length;
  const canDeliver = lines.some((l) => Number(l.deliverable) > 0);
  const hasDelivered = lines.some((l) => Number(l.delivered_quantity) > 0);

  // La part d'avancement, en MOYENNE des lignes et non en somme des quantités :
  // additionner des cartons, des kilos et des mètres cubes ne donnerait pas un
  // nombre, juste une illusion. Le rapport par ligne, lui, est sans unité.
  const meanRatio = (rows, num, den) => {
    const usable = rows.filter((l) => Number(den(l)) > 0);
    if (!usable.length) return null;
    return usable.reduce((s, l) => s + Math.min(1, Number(num(l)) / Number(den(l))), 0) / usable.length;
  };
  const confieFill = meanRatio(lines, (l) => l.allocated, (l) => l.quantity);
  const livreFill = meanRatio(lines, (l) => l.delivered_quantity, (l) => l.arrived);
  const lotsRestants = lines.filter((l) => Number(l.remaining) > 0).length;
  const lotsAuBureau = lines.filter((l) => Number(l.deliverable) > 0).length;

  // Deux étapes peuvent être « à moitié », et les deux veulent qu'on agisse :
  // de la marchandise attend un passager en Chine, ou attend son propriétaire à
  // Alger. Les manquants, eux, ne sont pas marqués ici : ils appartiennent au
  // bon passager qui les a constatés, et ils sont déjà compensés.
  const steps = ORDER_ORDER.map((key) => {
    const step = { key, label: ORDER_STATUS[key].label };
    if (key === 'ouverte' && lotsRestants > 0 && confieFill > 0) {
      return { ...step, fill: confieFill, tag: 'partiel', tone: 'open',
        title: `${lines.length - lotsRestants} lot(s) sur ${lines.length} entièrement confiés · ${lotsRestants} attendent encore un passager en Chine` };
    }
    if (key === 'livree' && lotsAuBureau > 0 && livreFill > 0) {
      return { ...step, fill: livreFill, tag: 'partiel', tone: 'open',
        title: `${arrivedLots - lotsAuBureau} lot(s) sur ${arrivedLots} entièrement remis · ${lotsAuBureau} encore au bureau d’Alger` };
    }
    return step;
  });

  // Le statut d'un bon fournisseur DÉCOULE des faits : un passager emporte,
  // arrive, la marchandise est remise, les frais sont encaissés. Cliquer une
  // étape mène donc à l'action qui la produit — jamais à un statut posé à la
  // main, qui serait recalculé à la seconde d'après.
  const jumpTo = (key) => {
    const order = ORDER_ORDER.indexOf(key), cur = ORDER_ORDER.indexOf(o.status);
    if (order < cur) {
      toast.error('Pour revenir en arrière, ouvrez le bon passager concerné : c’est lui qui porte l’étape.');
      return;
    }
    const carrier = o.carriers?.[0];
    if (key === 'en_transit' || key === 'arrivee') {
      if (carrier) { navigate(`/bons-passager/${carrier.id}`); return; }
      toast.error('Aucun passager ne transporte encore cette marchandise. Créez un bon passager qui l’emporte.');
      navigate('/bons-passager/nouveau');
      return;
    }
    if (key === 'livree') {
      if (lotsAuBureau > 0 || arrivedLots > 0) openDeliver();
      else toast.error('Rien n’est encore arrivé au bureau : la remise attend l’arrivée d’un passager.');
      return;
    }
    if (key === 'cloturee') {
      toast.error('Clôture : encaissez les frais du fournisseur et réglez chaque passager.');
      navigate(`/bons-fournisseur/${o.id}/marchandises`);
    }
  };

  // Le formulaire s'ouvre déjà rempli avec tout ce qui est arrivé et n'est pas
  // encore parti : le cas normal est une seule confirmation. Baisser un chiffre
  // reste possible pour le client qui n'emporte que la moitié.
  const openDeliver = () => setDeliver(Object.fromEntries(
    lines.filter((l) => Number(l.deliverable) > 0).map((l) => [l.line_id, l.deliverable])
  ));

  const doDeliver = async () => {
    const body = {
      lines: Object.entries(deliver)
        .filter(([, q]) => Number(q) > 0)
        .map(([lineId, quantity]) => ({ lineId: Number(lineId), quantity: String(quantity) })),
    };
    if (!body.lines.length) { toast.info('Aucune quantité à livrer.'); return; }
    setBusy(true);
    try {
      await api(`/orders/${id}/deliver`, { method: 'POST', body });
      toast.success('Marchandise remise au fournisseur.');
      setDeliver(null);
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const undoDeliver = async () => {
    setBusy(true);
    try {
      await api(`/orders/${id}/deliver/cancel`, { method: 'POST' });
      toast.success('Livraison annulée — la marchandise est revenue au stock d’Alger.');
      setConfirmUndoDeliver(false);
      reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/orders/${id}`, { method: 'DELETE' });
      toast.success(`Bon fournisseur ${o.reference} supprimé.`);
      navigate('/bons-fournisseur');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div>
      <DetailHead
        icon="order"
        accent="var(--c-order)"
        title={o.reference}
        status={<span className={`status-badge ${ORDER_STATUS[o.status].cls}`}>{ORDER_STATUS[o.status].label}</span>}
        actions={
          <>
            <PrintButton
              title={o.reference}
              docTitle="Bon fournisseur — manifeste"
              subtitle={o.reference}
              a4={() => orderManifestBody(o, qr)}
              ticket={(societe) => orderTicket(o, societe, qr)}
            />
            <button
              className="btn btn-gold"
              disabled={busy || !canDeliver}
              onClick={openDeliver}
              // Un bouton grisé sans raison est un bouton cassé : il dit
              // toujours pourquoi il ne peut rien faire.
              title={canDeliver
                ? 'Remettre au fournisseur ce qui est arrivé'
                : hasDelivered ? 'Tout ce qui est arrivé a déjà été remis.' : 'Rien n’est encore arrivé au bureau.'}
            >
              <IconEl name="check" />Livrer
            </button>
            {/* Annuler une remise fait revenir la marchandise au stock d'Alger :
                même geste destructif que les autres, même garde. */}
            {isSuper && hasDelivered && (
              <button className="btn" disabled={busy} title="Annuler la livraison"
                onClick={() => setConfirmUndoDeliver(true)}>
                <IconEl name="arrowIn" />
              </button>
            )}
            {o.bons[0] && (
              <Link to={`/bons-fournisseur/${o.id}/marchandises`} className="btn" title="Modifier les marchandises">
                <IconEl name="edit" />Modifier
              </Link>
            )}
            {/* Supprimer definitivement : reserve au super-administrateur. */}
            {isSuper && (
              <button className="btn btn-danger" disabled={busy} title="Supprimer ce bon" onClick={() => setConfirmDelete(true)}>
                <IconEl name="trash" />
              </button>
            )}
          </>
        }
      />

      <ScanBanner hit={scanHit} onDismiss={clearScanHit} />

      {/* Un indicateur, pas une commande. Le statut d'un ordre se DÉDUIT de
          cinq portes — marchandise confiée, partie, arrivée, remise, payée —
          et rien ici ne peut l'écrire. Le bouton cliquable d'avant ne
          déplaçait que le bon fournisseur enfant : l'écran ne bougeait pas,
          mais ses lignes devenaient silencieusement immodifiables. */}
      <StepFlow steps={steps} current={o.status} onJump={jumpTo} />

      <Kpis>
        <Kpi icon="fournisseur" label="Fournisseur" value={o.fournisseur_name} sub={o.fournisseur_phone} person to={`/personnes/${o.fournisseur_id}`} />
        <Kpi hero icon="coins" label="Facturé" value={formatMoney(o.totals.billed, cur)} tone="gold"
          sub={o.totals.commission > 0 ? `dont ${formatMoney(o.totals.commission, cur)} de commission` : null} />
        <Kpi icon="plane" label="Confié" value={`${done} / ${lines.length}`} sub="lots partis" />
        <Kpi icon="check" label="Livré" value={`${deliveredLots} / ${arrivedLots}`} sub="lots remis"
          tone={arrivedLots > 0 && deliveredLots === arrivedLots ? 'pos' : ''} />
        <Kpi icon="alert" label="Manquants" value={formatMoney(o.totals.loss_total, cur)} tone={Number(o.totals.loss_total) > 0 ? 'neg' : ''} />
      </Kpis>

      <Section icon="box" title="Marchandises reçues" count={lines.length}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Désignation</th><th className="right">Prix de revient</th><th className="right">Reçu</th>
                <th>Confié</th><th className="right">Arrivé</th><th>Livré</th>
                <th className="right">Reste</th><th className="right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const u = unitOf(l);
                return (
                  <tr key={l.line_id}>
                    <td>{l.designation}</td>
                    <td className="right">{formatMoney(l.unit_price, cur)} <span className="muted">/ {u}</span></td>
                    <td className="right">{formatQty(l.quantity)} {u}</td>
                    <td className="bar-cell">
                      <Bar value={l.allocated} max={l.quantity} title={`${formatQty(l.allocated)} / ${formatQty(l.quantity)} ${u}`} />
                    </td>
                    {/* Arrivé = ce que les porteurs ont réellement rapporté,
                        manquants déduits. C'est le plafond de ce qu'on peut
                        remettre, pas la quantité commandée. */}
                    <td className="right">{formatQty(l.arrived)} {u}</td>
                    <td className="bar-cell">
                      {Number(l.arrived) > 0
                        ? <Bar value={l.delivered_quantity} max={l.arrived}
                            title={`${formatQty(l.delivered_quantity)} / ${formatQty(l.arrived)} ${u} remis`} />
                        : <span className="muted">—</span>}
                    </td>
                    <td className={`right ${Number(l.remaining) > 0 ? 'gold' : 'muted'}`}>{formatQty(l.remaining)} {u}</td>
                    <td className="right">{formatMoney(Number(l.unit_price) * Number(l.quantity), cur)}</td>
                  </tr>
                );
              })}
              {!lines.length && <tr><td colSpan="8" className="muted pad">Aucune marchandise.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="7" className="right muted">Total marchandises</td>
                <td className="right">{formatMoney(o.totals.goods, cur)}</td>
              </tr>
              {o.totals.commission > 0 && (
                <tr>
                  <td colSpan="7" className="right muted">Commission</td>
                  <td className="right">{formatMoney(o.totals.commission, cur)}</td>
                </tr>
              )}
              {o.totals.discount > 0 && (
                <tr>
                  <td colSpan="7" className="right muted">Remise</td>
                  <td className="right pos">− {formatMoney(o.totals.discount, cur)}</td>
                </tr>
              )}
              <tr className="total-row">
                <td colSpan="7" className="right">À facturer</td>
                <td className="right gold"><strong>{formatMoney(o.totals.billed, cur)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      <Section icon="passager" title="Transporté par" count={o.carriers?.length ?? 0}>
        {o.carriers?.length ? (
          <div className="table-wrap">
            <table className="table list-table">
              <thead><tr><th>Bon passager</th><th>Passager</th><th>Statut</th><th className="right">Coût</th><th className="right">Payé</th></tr></thead>
              <tbody>
                {o.carriers.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => navigate(`/bons-passager/${b.id}`)}>
                    <td><span className="gold">{b.reference}</span></td>
                    <td><Who name={b.passager_name} icon="passager" /></td>
                    <td><span className={`status-badge ${BON_STATUS[b.status].cls}`}>{BON_STATUS[b.status].label}</span></td>
                    <td className="right">{formatMoney(b.transport_fee, b.transport_currency)}</td>
                    <td className="right">{b.passager_payment != null ? formatMoney(b.passager_payment, b.transport_currency) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="passager"
            title="Personne ne la transporte encore"
            sub={o.totals.unallocated > 0 ? 'Cette marchandise attend en Chine.' : 'Rien à confier.'}
          >
            <Link to="/bons-passager/nouveau" className="btn btn-gold"><IconEl name="plus" />Créer un bon passager</Link>
          </EmptyState>
        )}
      </Section>

      <Footnote by={o.created_by_name} at={o.created_at} extra="Chine → Algérie" />

      {deliver && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeliver(null); }}>
          <div className="modal-card modal-wide" role="dialog" aria-modal="true" aria-label="Livrer au fournisseur">
            <h3 className="modal-title">Livrer à {o.fournisseur_name}</h3>
            <p className="modal-msg">
              Ce qui est arrivé au bureau et n’a pas encore été remis. Baissez une
              quantité si le fournisseur n’emporte qu’une partie — le reste
              restera disponible pour une prochaine fois.
            </p>
            <div className="table-wrap deliver-rows">
              <table className="table">
                <thead>
                  <tr><th>Désignation</th><th className="right">Au bureau</th><th className="right">À remettre</th></tr>
                </thead>
                <tbody>
                  {lines.filter((l) => Number(l.deliverable) > 0).map((l) => {
                    const u = unitOf(l);
                    const over = Number(deliver[l.line_id] || 0) > Number(l.deliverable);
                    return (
                      <tr key={l.line_id}>
                        <td>{l.designation}</td>
                        <td className="right">{formatQty(l.deliverable)} <span className="muted">{u}</span></td>
                        <td className="right">
                          <AmountInput
                            decimals={3}
                            step={l.measure === 'cbm' ? 0.1 : 1}
                            max={l.deliverable}
                            className={`mini-input ${over ? 'input-error' : ''}`}
                            value={deliver[l.line_id] ?? ''}
                            onChange={(v) => setDeliver({ ...deliver, [l.line_id]: v })}
                          />
                          <span className="muted"> {u}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDeliver(null)} disabled={busy}>
                <IconEl name="close" />Annuler
              </button>
              <button type="button" className="btn btn-gold" onClick={doDeliver} disabled={busy}>
                {busy ? '…' : 'Confirmer la remise'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmUndoDeliver}
        tone="danger"
        title="Annuler la livraison ?"
        message={`Tout ce qui a été remis au fournisseur sur ${o.reference} sera repris :`}
        bullets={[
          'La marchandise revient au stock d’Algérie',
          'Les quantités livrées repassent à zéro',
          'L’ordre redescend à « Arrivée »',
        ]}
        confirmLabel="Annuler la livraison"
        busy={busy}
        onCancel={() => setConfirmUndoDeliver(false)}
        onConfirm={undoDeliver}
      />

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title={`Supprimer le bon fournisseur ${o.reference} ?`}
        message="Tout ce que ce bon a produit sera annulé, puis il sera supprimé définitivement :"
        bullets={[
          'La réception des marchandises en Chine',
          'La facturation et la remise du fournisseur',
          'Refusé si un passager transporte déjà ces marchandises.',
        ]}
        confirmLabel="Supprimer définitivement"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </div>
  );
}
