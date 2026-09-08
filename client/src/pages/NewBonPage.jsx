// Créer un bon passager en trois questions : qui porte ? quoi ? pour combien ?
//
// Le passager se cherche au lieu de se dérouler ; la marchandise se choisit dans
// un catalogue de ce qui peut partir aujourd'hui, tous fournisseurs confondus ;
// et la dernière étape ne montre que ce qui est décidé — pas un mur de champs.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useTabTitle } from '../components/TabsContext.jsx';
import { formatMoney, errorMessage, useToast, EmptyState } from '../components/ui.jsx';
import { IconEl, initialsOf } from '../components/icons.jsx';
import { Wizard, StepHead } from '../components/Wizard.jsx';
import { EntityPicker, OptionChips, QuickPeople } from '../components/EntityPicker.jsx';
import { GoodsPicker, pickedValid, pickedTotal, pickedMargin, pickedToLine } from '../components/GoodsPicker.jsx';
import { usePriceHistory } from '../lib/usePriceHistory.js';
import { useDraft } from '../lib/draft.js';

export default function NewBonPage() {
  const toast = useToast();
  const navigate = useNavigate();
  useTabTitle('Nouveau bon passager');

  const passagers = useApi('/people?role=passager');
  const currencies = useApi('/currencies');
  const allocatable = useApi('/bons/allocatable');

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Remplir un panier prend du temps : il survit à un onglet fermé, sans que
  // rien ne soit écrit en base tant que le bon n'est pas créé.
  const [form, setForm, draft] = useDraft('sc_draft_bp',
    { passagerId: '', transportCurrency: 'DZD', notes: '', lines: [] });

  const people = passagers.data?.people ?? [];
  const chosen = people.find((p) => String(p.id) === String(form.passagerId)) || null;
  const curList = currencies.data?.currencies ?? [];
  const lots = allocatable.data?.lines ?? [];
  // Ce qu'on a payé à ce passager la dernière fois, par article.
  const history = usePriceHistory({ scope: 'passager', passagerId: form.passagerId || undefined });

  const goodsOk = form.lines.length > 0 && form.lines.every(pickedValid);
  const total = form.lines.reduce((s, l) => s + pickedTotal(l), 0);
  const margin = form.lines.reduce((s, l) => s + pickedMargin(l), 0);

  const steps = [
    { key: 'who', label: 'Passager', icon: 'passager', ok: Boolean(form.passagerId) },
    { key: 'what', label: 'Marchandises', icon: 'box', ok: goodsOk },
    { key: 'money', label: 'Récapitulatif', icon: 'coins', ok: Boolean(form.passagerId) && goodsOk },
  ];

  const createPassager = async (name) => {
    try {
      const { person } = await api('/people', {
        method: 'POST',
        body: { name, isFournisseur: false, isPassager: true, passagerType: 'regular' },
      });
      await passagers.reload();
      setForm((f) => ({ ...f, passagerId: String(person.id) }));
      toast.success(`Passager ${person.name} créé.`);
    } catch (err) { toast.error(errorMessage(err)); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { bon } = await api('/bons', {
        method: 'POST',
        body: { ...form, lines: form.lines.map(pickedToLine) },
      });
      draft.forget();
      toast.success(`Bon passager ${bon.reference} créé.`);
      navigate(`/bons-passager/${bon.id}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  // Combien de fournisseurs ce bon porte — le fait marquant d'un bon passager.
  const fournCount = new Set(form.lines.map((l) => l.fournisseurName || '—')).size;

  const summary = (
    <>
      <span className="wz-sum-k">À payer au passager</span>
      <strong className="wz-sum-v">{formatMoney(total, form.transportCurrency)}</strong>
      {chosen && <span className="wz-sum-who"><span className="avatar">{initialsOf(chosen.name)}</span>{chosen.name}</span>}
    </>
  );

  return (
    <Wizard
      icon="bon"
      accent="var(--c-bon)"
      title="Nouveau bon passager"
      steps={steps}
      step={step}
      onStep={setStep}
      onCancel={() => navigate('/bons-passager')}
      summary={summary}
      footer={
        <>
          {step > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              <IconEl name="chevronLeft" />Retour
            </button>
          )}
          {step < 2 && (
            <button type="button" className="btn btn-gold btn-next" disabled={!steps[step].ok} onClick={() => setStep(step + 1)}>
              Continuer<IconEl name="chevronRight" />
            </button>
          )}
          {step === 2 && (
            <button type="button" className="btn btn-gold btn-next" disabled={busy || !goodsOk || !form.passagerId} onClick={submit}>
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
          <StepHead icon="passager" question="Qui transporte la marchandise ?" />
          <QuickPeople people={people} value={form.passagerId} onChange={(v) => setForm({ ...form, passagerId: v })} icon="passager" />
          <EntityPicker
            size="lg"
            icon="passager"
            value={form.passagerId}
            onChange={(v) => setForm({ ...form, passagerId: v })}
            options={people}
            loading={passagers.loading}
            placeholder="Chercher un passager"
            searchPlaceholder="Nom ou téléphone…"
            subOf={(p) => p.phone || null}
            tagsOf={(p) => (p.passager_type === 'auto' ? ['Auto-entrepreneur'] : [])}
            searchOf={(p) => `${p.name} ${p.phone || ''}`}
            emptyText="Aucun passager de ce nom."
            onCreate={createPassager}
            createLabel="Créer le passager"
          />
        </>
      )}

      {step === 1 && (
        <>
          <StepHead
            icon="box"
            question="Que met-il dans sa valise ?"
            hint="Cherchez un lot, cliquez pour l'ajouter. Un bon peut porter la marchandise de plusieurs fournisseurs."
          />
          {!allocatable.loading && !lots.length ? (
            <EmptyState
              icon="box"
              title="Rien à confier pour l'instant"
              sub="Toute la marchandise arrivée est déjà partie. Créez un bon fournisseur pour en recevoir."
            />
          ) : (
            <GoodsPicker
              options={lots}
              picked={form.lines}
              currency={form.transportCurrency}
              loading={allocatable.loading}
              suggestFor={(o) => history.lookup(o.item_id, o.designation)}
              onChange={(lines) => setForm((f) => ({ ...f, lines }))}
            />
          )}
        </>
      )}

      {step === 2 && (
        <>
          <StepHead icon="coins" question="Dans quelle devise payez-vous le passager ?" />
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
            <label className="field field-grow">
              <span>Note (optionnel)</span>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ex. vol du 12" />
            </label>
          </div>

          <div className="wz-recap">
            <div className="wz-recap-row">
              <span className="wz-recap-ico"><IconEl name="passager" /></span>
              <span className="wz-recap-k">Passager</span>
              <strong>{chosen?.name || '—'}</strong>
            </div>
            <div className="wz-recap-row">
              <span className="wz-recap-ico"><IconEl name="box" /></span>
              <span className="wz-recap-k">Marchandises</span>
              <strong>{form.lines.length} {form.lines.length > 1 ? 'lots' : 'lot'} · {fournCount} {fournCount > 1 ? 'fournisseurs' : 'fournisseur'}</strong>
            </div>
            <div className="wz-recap-row">
              <span className="wz-recap-ico"><IconEl name="trend" /></span>
              <span className="wz-recap-k">Marge estimée</span>
              <strong className={margin < 0 ? 'neg' : 'pos'}>{formatMoney(margin, form.transportCurrency)}</strong>
            </div>
            <div className="wz-recap-row total">
              <span className="wz-recap-ico"><IconEl name="arrowOut" /></span>
              <span className="wz-recap-k">À payer au passager</span>
              <strong className="gold">{formatMoney(total, form.transportCurrency)}</strong>
            </div>
          </div>
        </>
      )}
    </Wizard>
  );
}
