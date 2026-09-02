import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/useApi.js';
import { api } from '../api/client.js';
import { Spinner, formatMoney } from '../components/ui.jsx';
import { IconEl } from '../components/icons.jsx';
import { Sparkline, TrendBadge, Donut, Pipeline, RouteMap } from '../components/charts.jsx';
import { SyncCard, relativeTime } from '../components/SyncCard.jsx';
import { useDismiss } from '../components/SettingsMenu.jsx';
import { activityLine } from '../components/activityLabels.js';
import { BON_STATUS } from '../components/bonStatus.js';
import { useAuth } from '../auth/AuthContext.jsx';

const PERIODS = [
  { key: 'jour', label: 'Aujourd’hui' },
  { key: 'semaine', label: 'Cette semaine' },
  { key: 'mois', label: 'Ce mois' },
  { key: 'trimestre', label: 'Ce trimestre' },
  { key: 'annee', label: 'Cette année' },
];
const periodLabelOf = (key) => PERIODS.find((p) => p.key === key)?.label ?? '';

// The 3-dots period picker on a stat card. Sets that card's own window; the
// financial panel keeps its separate selector.
function PeriodMenu({ period, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="pop-wrap" ref={ref}>
      <button
        className={`stat-more ${open ? 'active' : ''}`}
        aria-label="Choisir la période"
        aria-expanded={open}
        type="button"
        onClick={() => setOpen((o) => !o)}
      >
        <span /><span /><span />
      </button>
      {open && (
        <div className="pop pop-period" role="menu">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              role="menuitemradio"
              aria-checked={p.key === period}
              className={`period-item ${p.key === period ? 'active' : ''}`}
              onClick={() => { onPick(p.key); setOpen(false); }}
            >
              {p.label}
              {p.key === period && <IconEl name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ icon, accent, value, unit, label, deltaPct, series, period, onPeriod, footer }) {
  return (
    <div className="stat" style={{ '--accent': accent }}>
      <div className="stat-top">
        <div className="stat-ico"><IconEl name={icon} /></div>
        <div className="stat-label">{label}</div>
        <PeriodMenu period={period} onPick={onPeriod} />
      </div>
      <div className="stat-val">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      <div className="stat-foot">
        {footer ?? <TrendBadge deltaPct={deltaPct} suffix={periodLabelOf(period)} />}
        {series?.length > 1 && <Sparkline values={series} stroke={accent} />}
      </div>
    </div>
  );
}

// The trend sits under the value rather than beside it: side by side, the row
// wrapped to double height as soon as the column got narrow.
function FinRow({ icon, accent, label, value, currency, deltaPct, series, periodLabel }) {
  return (
    <div className="fin-row" style={{ '--accent': accent }}>
      <div className="fin-ico"><IconEl name={icon} /></div>
      <div className="fin-id">
        <div className="fin-label">{label}</div>
        <div className="fin-line">
          <span className="fin-val">
            {formatMoney(value)} <span className="fin-cur">{currency}</span>
          </span>
          <TrendBadge deltaPct={deltaPct} suffix={periodLabel} />
        </div>
      </div>
      <Sparkline values={series} stroke={accent} width={82} height={34} />
    </div>
  );
}

const CURRENCY = 'DZD';

export default function Dashboard() {
  const { admin } = useAuth();
  const [caMode, setCaMode] = useState('argent');
  // The overview loads every panel at the default window; each period-scoped
  // control (the four stat cards, the financial panel) then refetches only its
  // own slice, so they move independently.
  const { data, loading, error } = useApi(`/dashboard/overview?period=mois&currency=${CURRENCY}`);

  const [finPeriod, setFinPeriod] = useState('mois');
  const [fin, setFin] = useState(null);
  const changeFinPeriod = async (p) => {
    setFinPeriod(p);
    setFin(null);
    try { setFin(await api(`/dashboard/financial?period=${p}&currency=${CURRENCY}`)); } catch { setFin(null); }
  };

  // Per-card period + fetched override. Seeded from the overview (all 'mois').
  const [tilePeriod, setTilePeriod] = useState({ bons: 'mois', revenue: 'mois', passagers: 'mois', stock: 'mois' });
  const [tileData, setTileData] = useState({});
  const changeTile = async (key, p) => {
    setTilePeriod((tp) => ({ ...tp, [key]: p }));
    try {
      const d = await api(`/dashboard/tile/${key}?period=${p}&currency=${CURRENCY}`);
      setTileData((td) => ({ ...td, [key]: d }));
    } catch { /* keep the previous value */ }
  };

  if (loading && !data) return <Spinner />;
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return null;

  const { stats, pipeline, stockByCategory, activity, recentBons, currency } = data;
  const financial = fin ?? data.financial;
  const inTransit = pipeline.steps.find((s) => s.key === 'en_transit')?.count ?? 0;

  // Card values: the fetched per-card override, else the overview slice.
  const bonsTile = tileData.bons ?? stats.bonsActifs;
  const passagersTile = tileData.passagers ?? stats.passagers;
  const stockTile = tileData.stock ?? stats.stock;
  const revTile = tileData.revenue ?? data.revenue;
  const revPeriodLabel = periodLabelOf(tilePeriod.revenue);

  return (
    <div className="dash">
      <div className="page-head">
        <div>
          <h1>
            Bonjour, {admin?.full_name?.split(' ')[0]} ! <span className="wave">👋</span>
          </h1>
          <p className="muted">Voici un aperçu de votre activité aujourd’hui.</p>
        </div>
        <div className="page-actions">
          <Link to="/bons-fournisseur" className="btn">
            <IconEl name="plus" /> NOUVEAU BON FOURNISSEUR
          </Link>
          <Link to="/bons-passager" className="btn btn-gold">
            <IconEl name="plus" /> NOUVEAU BON PASSAGER
          </Link>
        </div>
      </div>

      {/* ── the four tiles (each with its own period picker) ── */}
      <div className="stat-grid">
        <Stat
          icon="bon" accent="var(--c-bon)" label="Bons passagers actifs"
          value={bonsTile.value}
          deltaPct={bonsTile.deltaPct} series={bonsTile.series}
          period={tilePeriod.bons} onPeriod={(p) => changeTile('bons', p)}
        />
        <Stat
          icon="coins" accent="var(--c-caisse)" label="Chiffre d’affaires"
          value={caMode === 'argent' ? formatMoney(revTile.money.value) : formatMoney(revTile.quantity.weightKg)}
          unit={caMode === 'argent' ? currency : 'kg'}
          deltaPct={caMode === 'argent' ? revTile.money.deltaPct : null}
          series={caMode === 'argent' ? revTile.money.series : null}
          period={tilePeriod.revenue} onPeriod={(p) => changeTile('revenue', p)}
          footer={
            <div className="ca-switch">
              <button className={caMode === 'argent' ? 'active' : ''} onClick={() => setCaMode('argent')} type="button">Argent</button>
              <button className={caMode === 'quantite' ? 'active' : ''} onClick={() => setCaMode('quantite')} type="button">Quantité</button>
            </div>
          }
        />
        <Stat
          icon="passager" accent="var(--c-people)" label="Passagers"
          value={passagersTile.value}
          deltaPct={passagersTile.deltaPct} series={passagersTile.series}
          period={tilePeriod.passagers} onPeriod={(p) => changeTile('passagers', p)}
        />
        <Stat
          icon="stock" accent="var(--c-stock)" label="Stock total"
          value={formatMoney(stockTile.value)}
          deltaPct={stockTile.deltaPct} series={stockTile.series}
          period={tilePeriod.stock} onPeriod={(p) => changeTile('stock', p)}
        />
      </div>

      {/* Quantity detail for the CA tile — units are never summed across
          different units of measure, so they're listed separately. Follows the
          CA card's own period. */}
      {caMode === 'quantite' && (
        <div className="panel qty-panel">
          <h2 className="panel-title">Chiffre d’affaires — quantité expédiée ({revPeriodLabel})</h2>
          <div className="qty-grid">
            <div className="qty-cell"><span className="qty-v">{formatMoney(revTile.quantity.weightKg)}</span><span className="qty-k">kg au total</span></div>
            <div className="qty-cell"><span className="qty-v">{formatMoney(revTile.quantity.cbm)}</span><span className="qty-k">CBM au total</span></div>
            <div className="qty-cell"><span className="qty-v">{revTile.quantity.bons}</span><span className="qty-k">bons expédiés</span></div>
            {revTile.quantity.byUnit.map((u) => (
              <div key={u.unit} className="qty-cell">
                <span className="qty-v">{formatMoney(u.quantity)}</span>
                <span className="qty-k">{u.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── pipeline + financial ── */}
      <div className="dash-cols">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Suivi des bons passagers — Étapes d’expédition</h2>
          </div>
          <Pipeline steps={pipeline.steps} />
          <RouteMap inTransit={inTransit} />
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">
              Résumé financier <span className="muted">({currency})</span>
            </h2>
            <select className="period-select" value={finPeriod} onChange={(e) => changeFinPeriod(e.target.value)} aria-label="Période">
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>

          <FinRow icon="arrowIn" accent="var(--c-caisse)" label="Entrées"
            value={financial.entrees.value} currency={currency}
            deltaPct={financial.entrees.deltaPct} series={financial.entrees.series} periodLabel={periodLabelOf(finPeriod)} />
          <FinRow icon="arrowOut" accent="var(--c-alert)" label="Dépenses"
            value={financial.depenses.value} currency={currency}
            deltaPct={financial.depenses.deltaPct} series={financial.depenses.series} periodLabel={periodLabelOf(finPeriod)} />
          <FinRow icon="net" accent="var(--c-dash)" label="Net (Entrées − Dépenses)"
            value={financial.net.value} currency={currency}
            deltaPct={financial.net.deltaPct} series={financial.net.series} periodLabel={periodLabelOf(finPeriod)} />
        </div>

        <SyncCard />
      </div>

      {/* ── stock / activity / recent bons ── */}
      <div className="dash-cols-3">
        <div className="panel">
          <h2 className="panel-title">Stock par catégorie</h2>
          <Donut
            slices={stockByCategory.slices}
            total={formatMoney(stockByCategory.total)}
            unit="Total"
            size={148}
            thickness={21}
          />
          <Link to="/stock" className="panel-foot-link">Voir tout le stock <IconEl name="chevronRight" /></Link>
        </div>

        <div className="panel">
          <h2 className="panel-title">Activité récente</h2>
          <ul className="feed">
            {activity.map((e) => {
              const { label, icon, sub } = activityLine(e);
              const meta = [e.admin_name && `par ${e.admin_name}`, sub].filter(Boolean).join(' · ');
              return (
                <li key={e.id} className="feed-row">
                  <span className="feed-ico"><IconEl name={icon} /></span>
                  <span className="feed-body">
                    <span className="feed-label">{label}</span>
                    {meta && <span className="feed-sub">{meta}</span>}
                  </span>
                  <span className="feed-time">{relativeTime(e.created_at)}</span>
                </li>
              );
            })}
            {!activity.length && <li className="muted pad">Aucune activité pour le moment.</li>}
          </ul>
          <Link to="/audit" className="panel-foot-link">Voir toute l’activité <IconEl name="chevronRight" /></Link>
        </div>

        {/* Four equal columns rather than stacking: a grid row is as tall as its
            tallest child, so stacking two panels made the whole row 339px when
            the others needed under 260. */}
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Bons passagers récents</h2>
            <Link to="/bons-passager" className="back-link">Voir tout</Link>
          </div>
          <div className="table-wrap">
            <table className="table table-tight">
              <thead>
                <tr><th>Référence</th><th>Fournisseur</th><th>Statut</th></tr>
              </thead>
              <tbody>
                {recentBons.map((b) => (
                  <tr key={b.id} className="clickable" onClick={() => navigate(`/bons-passager/${b.id}`)}>
                    <td><span className="gold">{b.reference}</span></td>
                    <td>{b.fournisseur_name}</td>
                    <td><span className={`status-badge ${BON_STATUS[b.status].cls}`}>{BON_STATUS[b.status].label}</span></td>
                  </tr>
                ))}
                {!recentBons.length && <tr><td colSpan="3" className="muted pad">Aucun bon pour le moment.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
