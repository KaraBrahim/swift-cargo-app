// Créer un bon fournisseur en trois questions : de qui ? quoi ? pour quelle
// commission ?
//
// L'ancien écran posait tout d'un coup — un select de fournisseurs, une devise,
// une remise, des lignes de marchandise — et il fallait deviner l'ordre. Ici on
// répond dans l'ordre du travail : les lignes portent le PRIX DE REVIENT du
// transport, et la marge se décide à la fin, en un seul montant, une fois tous
// les détails connus. Le total à facturer reste affiché en bas pendant la saisie.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useTabTitle } from '../components/TabsContext.jsx';
import { formatMoney, errorMessage, useToast } from '../components/ui.jsx';
import { IconEl, initialsOf } from '../components/icons.jsx';
import { Wizard, StepHead } from '../components/Wizard.jsx';
import { EntityPicker, OptionChips, QuickPeople } from '../components/EntityPicker.jsx';
import { LineEditor, emptyLine, lineValid, lineTotal } from '../components/LineEditor.jsx';
import AmountInput from '../components/AmountInput.jsx';
import { usePriceHistory } from '../lib/usePriceHistory.js';
import { useDraft } from '../lib/draft.js';

export default function NewOrderPage() {
  const toast = useToast();
  const navigate = useNavigate();
  useTabTitle('Nouveau bon fournisseur');

  const fournisseurs = useApi('/people?role=fournisseur');
  const currencies = useApi('/currencies');
  const stockItems = useApi('/stock/items');
  const cats = useApi('/stock/categories');

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Ce qu'on a commencé à saisir survit à un onglet fermé — rien n'est écrit en
  // base pour autant : le bon n'existe qu'au clic sur « Créer ».
  const [form, setForm, draft] = useDraft('sc_draft_bf', {
    fournisseurId: '', notes: '', transportCurrency: 'DZD', commission: '', lines: [emptyLine()],
  });

  const people = fournisseurs.data?.people ?? [];
  const chosen = people.find((p) => String(p.id) === String(form.fournisseurId)) || null;
  const curList = currencies.data?.currencies ?? [];
  // Les prix et la commission de la dernière fois avec ce fournisseur.
  const history = usePriceHistory({ scope: 'fournisseur', fournisseurId: form.fournisseurId || undefined });

  const setLine = (li, next) => setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === li ? next : l)) }));
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (li) => setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== li) }));

  const total = form.lines.reduce((s, l) => s + lineTotal(l), 0);
  const billed = total + Number(form.commission || 0);
  const goodsOk = form.lines.length > 0 && form.lines.every(lineValid);

  const steps = [
    { key: 'who', label: 'Fournisseur', icon: 'fournisseur', ok: Boolean(form.fournisseurId) },
    { key: 'what', label: 'Marchandises', icon: 'box', ok: goodsOk },
    { key: 'money', label: 'Commission', icon: 'coins', ok: Boolean(form.fournisseurId) && goodsOk },
  ];

  // Créer le fournisseur sans quitter le formulaire : on tape un nom qui n'existe
  // pas, on clique « Créer », il est choisi dans la foulée.
  const createFournisseur = async (name) => {
    try {
      const { person } = await api('/people', { method: 'POST', body: { name, isFournisseur: true, isPassager: false } });
      await fournisseurs.reload();
      setForm((f) => ({ ...f, fournisseurId: String(person.id) }));
      toast.success(`Fournisseur ${person.name} créé.`);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { order } = await api('/orders', {
        method: 'POST',
        body: {
          fournisseurId: form.fournisseurId,
          notes: form.notes,
          bons: [{ transportCurrency: form.transportCurrency, commission: form.commission || '0', lines: form.lines }],
        },
      });
      draft.forget();
      toast.success(`Bon fournisseur ${order.reference} créé.`);
      navigate(`/bons-fournisseur/${order.id}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  const summary = (
    <>
      <span className="wz-sum-k">{step === 2 ? 'À facturer au fournisseur' : 'Total marchandises'}</span>
      <strong className="wz-sum-v">{formatMoney(step === 2 ? billed : total, form.transportCurrency)}</strong>
      {chosen && <span className="wz-sum-who"><span className="avatar">{initialsOf(chosen.name)}</span>{chosen.name}</span>}
    </>
  );

  const next = (
    <button type="button" className="btn btn-gold btn-next" disabled={!steps[step].ok} onClick={() => setStep(step + 1)}>
      Continuer<IconEl name="chevronRight" />
    </button>
  );
  const back = (
    <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
      <IconEl name="chevronLeft" />Retour
    </button>
  );

  return (
    <Wizard
      icon="order"
      accent="var(--c-order)"
      title="Nouveau bon fournisseur"
      steps={steps}
      step={step}
      onStep={setStep}
      onCancel={() => navigate('/bons-fournisseur')}
      summary={summary}
      footer={
        <>
          {step > 0 && back}
          {step < 2 && next}
          {step === 2 && (
            <button type="button" className="btn btn-gold btn-next" disabled={busy || !goodsOk || !form.fournisseurId} onClick={submit}>
              <IconEl name="check" />{busy ? 'Création…' : 'Créer le bon'}
            </button>
          )}
        </>
      }
    >
      {draft.restored && (
        <div className="wz-draft">
          <IconEl name="note" />
          <span>Panier restauré — vous aviez commencé ce bon.</span>
          <button type="button" onClick={() => { draft.reset(); setStep(0); }}>Repartir de zéro</button>
        </div>
      )}

      {step === 0 && (
        <>
          <StepHead icon="fournisseur" question="De quel fournisseur vient la marchandise ?" />
          <QuickPeople people={people} value={form.fournisseurId} onChange={(v) => setForm({ ...form, fournisseurId: v })} icon="fournisseur" />
          <EntityPicker
            size="lg"
            icon="fournisseur"
            value={form.fournisseurId}
            onChange={(v) => setForm({ ...form, fournisseurId: v })}
            options={people}
            loading={fournisseurs.loading}
            placeholder="Chercher un fournisseur"
            searchPlaceholder="Nom ou téléphone…"
            subOf={(p) => p.phone || null}
            searchOf={(p) => `${p.name} ${p.phone || ''}`}
            emptyText="Aucun fournisseur de ce nom."
            onCreate={createFournisseur}
            createLabel="Créer le fournisseur"
          />
        </>
      )}

      {step === 1 && (
        <>
          <StepHead
            icon="box"
            question="Qu'avez-vous reçu ?"
            hint="Le prix saisi est le prix de revient : ce que coûte le transport de ce lot. La commission vient après."
          />
          <div className="wz-lines">
            {form.lines.map((l, li) => (
              <LineEditor
                key={li}
                line={l}
                suggestion={history.lookup(l.itemId, l.designation)}
                items={stockItems.data?.items ?? []}
                categories={cats.data?.categories ?? []}
                onPatch={(nl) => setLine(li, nl)}
                onRemove={() => removeLine(li)}
                removable={form.lines.length > 1}
                autoFocus={li === form.lines.length - 1}
              />
            ))}
          </div>
          <button type="button" className="wz-add" onClick={addLine}>
            <IconEl name="plus" />Ajouter une marchandise
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <StepHead
            icon="coins"
            question="Quelle commission ajoutez-vous ?"
            hint="Les lignes portent le prix de revient ; la commission est votre marge."
          />

          <div className="wz-money">
            <div className="field">
              <span>Devise</span>
              <OptionChips
                ariaLabel="Devise"
                value={form.transportCurrency}
                onChange={(v) => setForm({ ...form, transportCurrency: v })}
                options={curList.map((c) => ({ value: c.code, label: c.code }))}
              />
            </div>
            <label className="field wz-amount">
              <span>Commission</span>
              <AmountInput value={form.commission} onChange={(v) => setForm({ ...form, commission: v })} />
            </label>
            <label className="field field-grow">
              <span>Note (optionnel)</span>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ex. livraison partielle" />
            </label>
          </div>

          {/* Ce qui a été demandé la dernière fois à ce fournisseur : un clic le reprend. */}
          {history.commission && (
            <button
              type="button"
              className="wz-sugg"
              onClick={() => setForm({ ...form, commission: String(history.commission.commission) })}
            >
              <IconEl name="trend" />
              Dernière commission : <strong>{formatMoney(history.commission.commission, history.commission.currency)}</strong>
              <em>{history.commission.reference}</em>
            </button>
          )}

          <Recap chosen={chosen} lines={form.lines} total={total} commission={Number(form.commission || 0)} billed={billed} cur={form.transportCurrency} />
        </>
      )}
    </Wizard>
  );
}

// Ce qu'on s'apprête à créer, en quatre lignes : qui, combien d'articles, ce que
// ça fait, ce qui reste à facturer. Rien d'autre.
function Recap({ chosen, lines, total, commission, billed, cur }) {
  const count = useMemo(() => lines.filter(lineValid).length, [lines]);
  return (
    <div className="wz-recap">
      <div className="wz-recap-row">
        <span className="wz-recap-ico"><IconEl name="fournisseur" /></span>
        <span className="wz-recap-k">Fournisseur</span>
        <strong>{chosen?.name || '—'}</strong>
      </div>
      <div className="wz-recap-row">
        <span className="wz-recap-ico"><IconEl name="box" /></span>
        <span className="wz-recap-k">Marchandises</span>
        <strong>{count} {count > 1 ? 'articles' : 'article'} · {formatMoney(total, cur)}</strong>
      </div>
      {commission > 0 && (
        <div className="wz-recap-row">
          <span className="wz-recap-ico"><IconEl name="trend" /></span>
          <span className="wz-recap-k">Commission</span>
          <strong>{formatMoney(commission, cur)}</strong>
        </div>
      )}
      <div className="wz-recap-row total">
        <span className="wz-recap-ico"><IconEl name="coins" /></span>
        <span className="wz-recap-k">À facturer</span>
        <strong className="gold">{formatMoney(billed, cur)}</strong>
      </div>
    </div>
  );
}
