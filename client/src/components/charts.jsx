// Hand-rolled inline SVG charts. No charting dependency — the client stays on
// react + react-dom + react-router-dom, and every colour comes from a theme
// token so the four themes carry through automatically.
import { useId } from 'react';
import { useNavigate } from 'react-router-dom';

// ── Sparkline ────────────────────────────────────────────────────────
// Values arrive as decimal STRINGS (money never became a float on the server);
// they're only converted to numbers here, for pixel geometry.
export function Sparkline({ values = [], stroke = 'var(--accent, var(--brand))', fill = true, height = 34, width = 92 }) {
  const gradId = useId();
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < 2) return <svg className="spark" width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const stepX = width / (nums.length - 1);
  // 2px padding top and bottom so the stroke is never clipped.
  const y = (v) => height - 2 - ((v - min) / span) * (height - 4);
  const pts = nums.map((v, i) => [i * stepX, y(v)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {fill && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradId})`} />
        </>
      )}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Trend badge ──────────────────────────────────────────────────────
// deltaPct is null when there is no previous period to compare against — we show
// a dash rather than inventing a percentage.
export function TrendBadge({ deltaPct, suffix = '' }) {
  if (deltaPct === null || deltaPct === undefined) {
    return <span className="trend trend-flat">— {suffix}</span>;
  }
  const up = deltaPct >= 0;
  return (
    <span className={`trend ${up ? 'trend-up' : 'trend-down'}`}>
      <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
        <path
          d={up ? 'M2 8.5 6 4l4 4.5' : 'M2 3.5 6 8l4-4.5'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {up ? '+' : ''}
      {deltaPct}% {suffix}
    </span>
  );
}

// ── Donut ────────────────────────────────────────────────────────────
const SLICE_VARS = ['--c-dash', '--c-caisse', '--c-bon', '--c-people', '--c-stock', '--c-audit'];

export function Donut({ slices = [], total, unit = '', size = 190, thickness = 26 }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const withPct = slices.filter((s) => s.pct > 0);

  let offset = 0;
  return (
    <div className="donut-row">
      <div className="donut-wrap" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Répartition du stock">
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="var(--surface-3)" strokeWidth={thickness}
          />
          {withPct.map((s, i) => {
            const len = (s.pct / 100) * c;
            const dash = `${len} ${c - len}`;
            const el = (
              <circle
                key={s.name}
                cx={size / 2} cy={size / 2} r={r}
                fill="none"
                stroke={`var(${SLICE_VARS[i % SLICE_VARS.length]})`}
                strokeWidth={thickness}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="donut-center">
          <div className="donut-total">{total}</div>
          <div className="donut-total-label">{unit || 'Total'}</div>
        </div>
      </div>

      <div className="donut-legend">
        {slices.map((s, i) => (
          <div key={s.name} className="dl-item">
            <span className="dl-dot" style={{ background: `var(${SLICE_VARS[i % SLICE_VARS.length]})` }} />
            <span className="dl-name">{s.name}</span>
            <span className="dl-pct">{s.pct}%</span>
          </div>
        ))}
        {!slices.length && <span className="muted">Aucun article en stock.</span>}
      </div>
    </div>
  );
}

// ── Pipeline (the four real bon statuses) ────────────────────────────
// cree → en_transit → arrive → regle. Nodes are numbered 1–4; there is no
// synthetic "done" step.
const STEP_STATUS = { en_attente: 'cree', en_transit: 'en_transit', arrive: 'arrive', regle: 'regle' };

export function Pipeline({ steps = [] }) {
  const navigate = useNavigate();
  // The "current" step is the last one that still has bons waiting in it.
  const currentIdx = steps.reduce((acc, s, i) => (s.count > 0 ? i : acc), 0);

  return (
    <ol className="pipe">
      {steps.map((s, i) => (
        <li
          key={s.key}
          className={`pipe-step clickable ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`}
          onClick={() => navigate(`/bons-passager?status=${STEP_STATUS[s.key] || ''}`)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/bons-passager?status=${STEP_STATUS[s.key] || ''}`); }}
          title={`Voir les bons passagers « ${s.label} »`}
        >
          <div className="pipe-track" aria-hidden="true" />
          <div className="pipe-node">{i + 1}</div>
          <div className="pipe-label">{s.label}</div>
          <div className="pipe-count">{s.count || '—'}</div>
          <div className="pipe-pct">{s.count ? `${s.pct}%` : ''}</div>
        </li>
      ))}
    </ol>
  );
}

// ── Route map : Chine → Algérie ──────────────────────────────────────
// A courier route, not a shipping lane — the goods travel with passagers on
// flights, so the marker is a plane.
export function RouteMap({ inTransit = 0 }) {
  return (
    <div className="routemap">
      <svg viewBox="0 30 720 130" className="routemap-svg" role="img" aria-label="Route Chine — Algérie">
        <defs>
          <pattern id="rm-dots" x="0" y="0" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="1.6" cy="1.6" r="1.15" fill="var(--border-strong)" />
          </pattern>
        </defs>

        {/* Stylised land masses, filled with a dot grid — decorative backdrop. */}
        <g fill="url(#rm-dots)">
          <path d="M60 66c26-16 62-22 96-14 22 5 40 2 58-6 22-10 44-8 60 6 12 10 10 24-4 32-20 12-46 16-74 14-30-2-56 6-80 18-22 11-46 8-58-8-10-14-6-32 2-42Z" />
          <path d="M300 52c30-14 70-16 104-4 26 9 52 8 78-2 30-12 62-6 82 14 16 16 12 36-8 46-26 13-58 18-92 16-38-3-70 6-100 20-26 12-54 8-70-10-14-16-10-38 6-50 0 0 0 0 0 0Z" />
          <path d="M120 138c40-10 84-8 122 6 16 6 34 6 50 0" opacity="0.5" />
        </g>

        {/* The route itself. */}
        <path
          id="rm-route"
          d="M188 122 C 300 44, 470 44, 566 106"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2"
          strokeDasharray="7 6"
          opacity="0.85"
        />

        <circle cx="188" cy="122" r="5.5" fill="var(--brand)" />
        <circle cx="188" cy="122" r="10" fill="none" stroke="var(--brand)" strokeWidth="1.2" opacity="0.45" />
        <circle cx="566" cy="106" r="5.5" fill="var(--brand)" />
        <circle cx="566" cy="106" r="10" fill="none" stroke="var(--brand)" strokeWidth="1.2" opacity="0.45" />

        {/* Plane riding the route — the goods are hand-carried by passagers. */}
        <g className="rm-plane rotate-80">
          <animateMotion dur="9s" repeatCount="indefinite" rotate="auto">
            <mpath href="#rm-route" />
          </animateMotion>
          <g transform="translate(-11,-11) scale(0.92)">
            <path
              d="M10.5 19.5 12 22l1.5-2.5V15l7 2.5v-2L13.5 10V4.2a1.5 1.5 0 0 0-3 0V10L3.5 15.5v2L10.5 15v4.5Z"
              fill="var(--brand-fill-1)"
              stroke="var(--brand-deep)"
              strokeWidth="0.8"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </svg>

      <div className="routemap-ends">
        <div className="rm-end">
          <span className="rm-flag" aria-hidden="true">CN</span>
          <span>CHINE</span>
        </div>
        {inTransit > 0 && (
          <div className="rm-transit">
            {inTransit} bon{inTransit > 1 ? 's' : ''} en transit
          </div>
        )}
        <div className="rm-end">
          <span className="rm-flag" aria-hidden="true">DZ</span>
          <span>ALGÉRIE</span>
        </div>
      </div>
    </div>
  );
}
