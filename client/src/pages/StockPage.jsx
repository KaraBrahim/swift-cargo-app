// What is ACTUALLY held at an office. Articles with nothing on hand are not
// stock — they are catalogue entries, and live on the Articles page (reachable
// from the KPI cards here), so this table only ever shows real goods.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { Spinner, PageHeader, EmptyState, errorMessage, useToast } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { fuzzyRank } from '../lib/fuzzy.js';
import AmountInput from '../components/AmountInput.jsx';
import { formatQty } from '../lib/format.js';

const ACCENT = 'var(--c-stock)';
// Deux bureaux, et l'entre-deux : parti de Chine, pas encore arrivé en Algérie.
const OFFICES = [{ key: 'china', label: 'Chine' }, { key: 'algeria', label: 'Algérie' }];
const TRANSIT = 'transit';
const held = (it) => Number(it.quantity) > 0 || Number(it.weight_kg) > 0 || Number(it.cbm) > 0;

export default function StockPage() {
  const toast = useToast();
  const [office, setOffice] = useState('china');
  const transit = office === TRANSIT;
  const levels = useApi(transit ? '/stock/in-transit' : `/stock/levels?office=${office}`);
  // Le nombre d'articles en route, toujours visible sur l'onglet : c'est ce
  // qui dit d'un coup d'œil qu'un avion est en l'air.
  const transitCount = useApi('/stock/in-transit');
  const nbTransit = transitCount.data?.items?.length ?? 0;
  const items = useApi('/stock/items');
  const cats = useApi('/stock/categories');
  const [search, setSearch] = useState('');
  const [lvl, setLvl] = useState(null);
  const [busy, setBusy] = useState(false);

  const saveLevel = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/stock/items/${lvl.id}/level`, {
        method: 'POST',
        body: { office, quantity: lvl.quantity, weight_kg: lvl.weight_kg, cbm: lvl.cbm, note: lvl.note },
      });
      toast.success(`Stock ${OFFICES.find((o) => o.key === office).label} mis à jour.`);
      setLvl(null);
      levels.reload();
      items.reload();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };

  if (levels.loading) return <Spinner />;
  const officeLabel = transit ? 'en transit' : OFFICES.find((o) => o.key === office).label;
  const all = levels.data?.items ?? [];
  const inStock = all.filter(held);                     // the real stock
  const registeredOnly = all.length - inStock.length;   // catalogue-only articles
  const rows = fuzzyRank(search, inStock, (it) => `${it.name} ${it.category_name || ''}`, 500);

  return (
    <div style={{ '--accent': ACCENT }}>
      <PageHeader
        icon="stock" accent={ACCENT} title="Stock"
        subtitle={transit ? 'Marchandises parties de Chine et pas encore arrivées en Algérie.' : `Marchandises réellement présentes au bureau ${officeLabel}.`}
      >
        {/* Chine → en l'air → Algérie : l'ordre des onglets est celui du voyage. */}
        <div className="seg seg-route">
          <button type="button" className={office === 'china' ? 'active' : ''} onClick={() => { setOffice('china'); setLvl(null); }}>
            <IconEl name="stock" />Chine
          </button>
          <button type="button" className={`seg-transit ${transit ? 'active' : ''}`} onClick={() => { setOffice(TRANSIT); setLvl(null); }}>
            <IconEl name="plane" />En transit{nbTransit > 0 && <span className="seg-count">{nbTransit}</span>}
          </button>
          <button type="button" className={office === 'algeria' ? 'active' : ''} onClick={() => { setOffice('algeria'); setLvl(null); }}>
            <IconEl name="stock" />Algérie
          </button>
        </div>
        {!transit && (
        <button className="btn btn-gold" onClick={() => setLvl(lvl ? null : { id: '', name: '', quantity: '0', weight_kg: '0', cbm: '0', note: '' })}>
          <IconEl name={lvl ? 'close' : 'plus'} />{lvl ? 'Fermer' : 'Entrer du stock'}
        </button>
        )}
      </PageHeader>

      {/* Catalogue KPIs double as the way in to managing it. */}
      <div className="kpi-row">
        <Link to="/articles" className="kpi-card">
          <div className="kpi-ico"><IconEl name="box" /></div>
          <div>
            <div className="kpi-val">{items.data?.items?.length ?? '—'}</div>
            <div className="kpi-label">Articles au catalogue</div>
            {registeredOnly > 0 && <div className="kpi-sub">dont {registeredOnly} sans stock ici</div>}
          </div>
          <IconEl name="chevronRight" />
        </Link>

        <Link to="/categories" className="kpi-card">
          <div className="kpi-ico"><IconEl name="tag" /></div>
          <div>
            <div className="kpi-val">{cats.data?.categories?.length ?? '—'}</div>
            <div className="kpi-label">Catégories</div>
            <div className="kpi-sub">Classement des articles</div>
          </div>
          <IconEl name="chevronRight" />
        </Link>

        <div className="kpi-card kpi-static">
          <div className="kpi-ico"><IconEl name="stock" /></div>
          <div>
            <div className="kpi-val">{inStock.length}</div>
            <div className="kpi-label">Références en stock — {officeLabel}</div>
            <div className="kpi-sub">Quantité supérieure à zéro</div>
          </div>
        </div>
      </div>

      {lvl && (
        <form className="panel panel-accent op-form" onSubmit={saveLevel}>
          {lvl.id ? (
            <div className="field field-grow"><span>Ajuster — {lvl.name} · stock {officeLabel}</span>
              <span className="muted">Saisissez les quantités réelles constatées à ce bureau.</span></div>
          ) : (
            <label className="field field-grow"><span>Article à entrer en stock {officeLabel}</span>
              <select value={lvl.id} onChange={(e) => setLvl({ ...lvl, id: e.target.value })}>
                <option value="">— choisir un article du catalogue —</option>
                {(items.data?.items ?? []).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select></label>
          )}
          <label className="field"><span>Quantité</span>
            <AmountInput decimals={3} step={1} autoFocus value={lvl.quantity} onChange={(v) => setLvl({ ...lvl, quantity: v })} /></label>
          <label className="field"><span>Poids (kg)</span>
            <AmountInput decimals={3} step={1} value={lvl.weight_kg} onChange={(v) => setLvl({ ...lvl, weight_kg: v })} /></label>
          <label className="field"><span>CBM</span>
            <AmountInput decimals={3} step={0.1} value={lvl.cbm} onChange={(v) => setLvl({ ...lvl, cbm: v })} /></label>
          <button className="btn btn-gold" disabled={busy || !lvl.id}>Confirmer</button>
          <button type="button" className="btn btn-ghost" onClick={() => setLvl(null)}><IconEl name="close" />Annuler</button>
        </form>
      )}

      <div className="filter-bar">
        <label className="field" style={{ minWidth: 280 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher dans le stock…" />
        </label>
      </div>

      <div className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Article</th><th>Catégorie</th>
                  <th className="right">Quantité</th><th className="right">Poids (kg)</th><th className="right">CBM</th>
                  <th className="right">{transit ? 'Bons' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name}</td>
                    <td>{it.category_name || '—'}</td>
                    <td className="right">{formatQty(it.quantity)}</td>
                    <td className="right">{formatQty(it.weight_kg)}</td>
                    <td className="right">{formatQty(it.cbm)}</td>
                    <td className="right nowrap">
                      {transit ? it.bons : (
                        <button className="icon-btn" title="Ajuster la quantité" aria-label="Ajuster"
                          onClick={() => setLvl({ id: it.id, name: it.name, quantity: it.quantity, weight_kg: it.weight_kg, cbm: it.cbm, note: '' })}>
                          <IconEl name="swap" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="stock"
            title={search ? 'Aucun résultat' : transit ? 'Rien en transit' : `Rien en stock à ${officeLabel}`}
            sub={search ? 'Aucun article ne correspond à cette recherche.'
              : transit ? 'Les articles apparaissent ici dès qu’un bon passager part de Chine, jusqu’à son arrivée.'
                : 'Les marchandises apparaissent ici dès qu’un bon fournisseur est réceptionné.'}
          />
        )}
      </div>
    </div>
  );
}
