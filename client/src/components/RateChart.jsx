import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ── Exchange rate over a period ──────────────────────────────────────
// Recharts rather than hand-drawn SVG: axis domains, tick placement, responsive
// sizing and hit-testing are exactly the things that look fine until they are
// wrong, and this is a chart about money.
//
// One series, so no legend — the panel beside it already names the pair.
//
// `stepAfter`, not a smooth line: a rate holds its value until someone changes
// it. A curve between two points would draw a drift that never happened.

const fmtRate = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const decimals = Math.abs(n) < 1 ? 4 : 2;
  return n.toFixed(decimals);
};

const fmtDay = (t) =>
  new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

function RateTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rc-tip">
      <strong>{fmtRate(p.rate)}</strong>
      <span>{new Date(p.t).toLocaleString('fr-FR')}</span>
    </div>
  );
}

export default function RateChart({ points = [], height = 190 }) {
  const data = points
    .map((p) => ({ t: new Date(p.date).getTime(), rate: Number(p.rate) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.rate))
    .sort((a, b) => a.t - b.t);

  if (data.length < 2) return null;

  return (
    <div className="rate-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={fmtDay}
            tick={{ fill: 'var(--muted)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            // The domain follows the data, including a value that is only there
            // because someone mistyped it: a chart that quietly crops history is
            // worse than one that shows an awkward spike.
            domain={['auto', 'auto']}
            tickFormatter={fmtRate}
            tick={{ fill: 'var(--muted)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip content={<RateTooltip />} cursor={{ stroke: 'var(--brand-deep)', strokeDasharray: '3 4' }} />

          <Area
            type="stepAfter"
            dataKey="rate"
            stroke="var(--brand)"
            strokeWidth={2}
            fill="url(#rateFill)"
            dot={false}
            activeDot={{ r: 4, fill: 'var(--brand-text)', stroke: 'var(--rate-plate-2)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
