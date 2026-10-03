import { useMemo, useRef, useState, type ReactNode } from 'react';

/*
 * Small SVG charts in the app's look: thin marks, recessive grid, one axis, a tooltip on hover,
 * text in ink colours (series colour only on the marks). Colours come from the caller (client
 * colours, chart tokens), so an entity keeps its colour everywhere.
 */

type Fmt = (n: number) => string;

/* ---------------- Horizontal bars (ranking, magnitude) ---------------- */

export type BarItem = { id: string; label: string; value: number; color: string; sub?: ReactNode; onClick?: () => void };

export function HBars({ items, format, max: maxIn }: { items: BarItem[]; format: Fmt; max?: number }) {
  const max = maxIn ?? Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="hbars">
      {items.map((it, i) => {
        const Row = it.onClick ? 'button' : 'div';
        return (
          <Row key={it.id} className={'hbar' + (it.onClick ? ' is-click' : '')} onClick={it.onClick} type={it.onClick ? 'button' : undefined}>
            <div className="hbar-top">
              <span className="hbar-label ellipsis">
                <span className="swatch" style={{ background: it.color }} />
                {it.label}
              </span>
              <span className="hbar-value">{format(it.value)}</span>
            </div>
            <div className="hbar-track">
              <span
                style={{ width: `${Math.max(it.value ? 1.5 : 0, (Math.abs(it.value) / max) * 100)}%`, background: it.color, animationDelay: `${i * 0.05}s` }}
              />
            </div>
            {it.sub && <div className="hbar-sub">{it.sub}</div>}
          </Row>
        );
      })}
    </div>
  );
}

/* ---------------- Donut (share of a whole) ---------------- */

export type Slice = { id: string; label: string; value: number; color: string };

export function Donut({ slices, format, center, size = 168 }: { slices: Slice[]; format: Fmt; center?: ReactNode; size?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 1.2 : 0; // surface gap between segments
  const shown = slices.filter((s) => s.value > 0);
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((a, x) => a + (x.value / total) * c, 0));
  const arcs = shown.map((s, i) => ({ ...s, dash: Math.max(0, (s.value / total) * c - gap), offset: -starts[i] }));
  const active = arcs.find((a) => a.id === hover);
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Share chart">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--track)" strokeWidth="11" />
        {arcs.map((a) => (
          <circle
            key={a.id}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === a.id ? 13 : 11}
            strokeDasharray={`${a.dash} ${c}`}
            strokeDashoffset={a.offset}
            transform="rotate(-90 50 50)"
            className="donut-arc"
            style={{ opacity: hover && hover !== a.id ? 0.35 : 1 }}
            onMouseEnter={() => setHover(a.id)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${a.label}: ${format(a.value)} (${Math.round((a.value / total) * 100)}%)`}</title>
          </circle>
        ))}
      </svg>
      <div className="donut-center">
        {active ? (
          <>
            <b>{Math.round((active.value / total) * 100)}%</b>
            <span className="ellipsis">{active.label}</span>
          </>
        ) : (
          center
        )}
      </div>
      <div className="donut-legend">
        {slices.map((s) => (
          <div
            key={s.id}
            className={'legend-row' + (hover === s.id ? ' is-hover' : '')}
            onMouseEnter={() => setHover(s.id)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="swatch" style={{ background: s.color }} />
            <span className="ellipsis">{s.label}</span>
            <b>{format(s.value)}</b>
            <span className="legend-pct">{total ? Math.round((Math.max(0, s.value) / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Stacked monthly bars ---------------- */

export type Series = { id: string; label: string; color: string; values: number[] };

export function StackedBars({ labels, series, format, height = 200 }: { labels: string[]; series: Series[]; format: Fmt; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  return (
    <div className="sbars" style={{ height }}>
      <div className="sbars-grid">
        {ticks.map((t) => (
          <div key={t} className="sbars-tick" style={{ bottom: `${(t / top) * 100}%` }}>
            <span>{format(t)}</span>
          </div>
        ))}
      </div>
      <div className="sbars-cols">
        {labels.map((l, i) => (
          <div
            key={l + i}
            className={'sbars-col' + (hover === i ? ' is-hover' : '')}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <div className="sbars-stack" style={{ height: `${(totals[i] / top) * 100}%`, animationDelay: `${i * 0.03}s` }}>
              {series.map((s) =>
                (s.values[i] ?? 0) > 0 ? (
                  <span key={s.id} style={{ flexGrow: s.values[i], background: s.color }} />
                ) : null,
              )}
            </div>
            <span className="sbars-label">{l}</span>
            {hover === i && totals[i] > 0 && (
              <div className={'chart-tip' + (i > labels.length / 2 ? ' left' : '')}>
                <div className="chart-tip-title">{l} · {format(totals[i])}</div>
                {series
                  .filter((s) => (s.values[i] ?? 0) > 0)
                  .sort((a, b) => b.values[i] - a.values[i])
                  .map((s) => (
                    <div key={s.id} className="chart-tip-row">
                      <span className="swatch" style={{ background: s.color }} />
                      <span className="ellipsis">{s.label}</span>
                      <b>{format(s.values[i])}</b>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Lines over time (value vs invested) ---------------- */

export type LinePoint = { t: string; values: number[] };

export function LineChart({ points, lines, format, formatT, height = 220 }: {
  points: LinePoint[];
  lines: { label: string; color: string; dashed?: boolean; area?: boolean }[];
  format: Fmt;
  formatT: (t: string) => string;
  height?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 200;
  const pad = { l: 4, r: 4, t: 10, b: 4 };
  const { min, max, ticks } = useMemo(() => {
    const all = points.flatMap((p) => p.values).filter((v) => Number.isFinite(v));
    const hi = Math.max(1, ...all);
    const lo = Math.min(0, ...all);
    const t = niceTicks(hi);
    return { min: lo, max: t[t.length - 1], ticks: t };
  }, [points]);
  if (points.length < 2) return <div className="chart-empty">Not enough history yet</div>;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const path = (k: number) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.values[k]).toFixed(1)}`).join(' ');
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const rel = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
  };
  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="line-wrap" style={{ height }}>
      <div className="sbars-grid">
        {ticks.map((t) => (
          <div key={t} className="sbars-tick" style={{ bottom: `${((t - min) / (max - min || 1)) * 100 * ((H - pad.t - pad.b) / H) + (pad.b / H) * 100}%` }}>
            <span>{format(t)}</span>
          </div>
        ))}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="line-svg" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {lines.map((l, k) =>
          l.area ? (
            <path key={'a' + k} d={`${path(k)} L${x(points.length - 1)},${y(min)} L${x(0)},${y(min)} Z`} fill={l.color} opacity="0.08" />
          ) : null,
        )}
        {lines.map((l, k) => (
          <path key={k} d={path(k)} fill="none" stroke={l.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray={l.dashed ? '5 4' : undefined} className="line-path" />
        ))}
        {hp && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {lines.map((l, k) => (
              <circle key={k} cx={x(hover)} cy={y(hp.values[k])} r="4" fill={l.color} stroke="var(--surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            ))}
          </>
        )}
      </svg>
      <div className="line-axis">
        <span>{formatT(points[0].t)}</span>
        <span>{formatT(points[Math.floor(points.length / 2)].t)}</span>
        <span>{formatT(points[points.length - 1].t)}</span>
      </div>
      {hp && hover !== null && (
        <div className={'chart-tip' + (hover > points.length / 2 ? ' left' : '')} style={{ left: `${(hover / (points.length - 1)) * 100}%`, top: 0 }}>
          <div className="chart-tip-title">{formatT(hp.t)}</div>
          {lines.map((l, k) => (
            <div key={k} className="chart-tip-row">
              <span className="swatch" style={{ background: l.color }} />
              <span>{l.label}</span>
              <b>{format(hp.values[k])}</b>
            </div>
          ))}
        </div>
      )}
      <div className="line-legend">
        {lines.map((l) => (
          <span key={l.label}><span className={'line-key' + (l.dashed ? ' dashed' : '')} style={{ borderColor: l.color }} />{l.label}</span>
        ))}
      </div>
    </div>
  );
}

/** 3 to 5 round grid values from 0 up to just above `max`. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Compact money for axes: €12k, €1.2M. */
export function compactMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

/** Categorical palette for things with no colour of their own (asset kinds, accounts). Fixed order. */
export const CAT = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
