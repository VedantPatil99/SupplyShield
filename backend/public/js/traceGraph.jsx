// Tiered SVG drawing of one batch's movement: Manufacturer -> Distributor -> Wholesaler -> Pharmacy.
// A shipment edge is drawn red when its sender neither produced the batch nor received it earlier
// (the same provenance-gap rule the server-side detector uses).

const TIERS = ['manufacturer', 'distributor', 'wholesaler', 'pharmacy'];
const TIER_TITLE = { manufacturer: 'Manufacturers', distributor: 'Distributors', wholesaler: 'Wholesalers', pharmacy: 'Pharmacies' };
const TIER_VAR = { manufacturer: '--t-mfg', distributor: '--t-dist', wholesaler: '--t-whs', pharmacy: '--t-pharm' };

function provenanceGapEdges(edges, producers) {
  const producerIds = new Set(producers.map((p) => p.entity_id));
  const gaps = new Set();
  for (const e of edges) {
    if (producerIds.has(e.from.entity_id)) continue;
    const t = Date.parse(e.dispatch_timestamp);
    const received = edges.some((p) => p.to.entity_id === e.from.entity_id && Date.parse(p.dispatch_timestamp) < t);
    if (!received) gaps.add(e.shipment_id);
  }
  return gaps;
}

function TraceGraph({ edges, producers, highlight, focus }) {
  const NODE_W = 210; const NODE_H = 42; const COL_GAP = 90; const ROW_GAP = 12; const TOP = 44; const PAD = 16;
  const gaps = useMemo(() => provenanceGapEdges(edges, producers), [edges, producers]);
  const hl = highlight || new Set();

  const layout = useMemo(() => {
    const nodes = new Map();
    const add = (ent, t) => {
      if (!ent || !ent.entity_id) return;
      const type = ent.entity_type || 'manufacturer';
      if (!nodes.has(ent.entity_id)) nodes.set(ent.entity_id, { ...ent, entity_type: type, first: t, suspicious: false, planted: false });
      const n = nodes.get(ent.entity_id);
      if (t < n.first) n.first = t;
    };
    for (const p of producers) {
      add({ entity_id: p.entity_id, name: p.name, entity_type: 'manufacturer' }, p.planted ? Infinity : -Infinity);
      if (p.planted) nodes.get(p.entity_id).planted = true;
    }
    for (const e of edges) {
      const t = Date.parse(e.dispatch_timestamp);
      add(e.from, t);
      add(e.to, t);
      if (gaps.has(e.shipment_id)) nodes.get(e.from.entity_id).suspicious = true;
    }
    const cols = TIERS.map((tier) => [...nodes.values()].filter((n) => n.entity_type === tier).sort((a, b) => a.first - b.first));
    const pos = {};
    cols.forEach((col, ci) => col.forEach((n, ri) => {
      pos[n.entity_id] = { x: PAD + ci * (NODE_W + COL_GAP), y: TOP + ri * (NODE_H + ROW_GAP), n };
    }));
    const rows = Math.max(1, ...cols.map((c) => c.length));
    return { cols, pos, width: PAD * 2 + TIERS.length * NODE_W + (TIERS.length - 1) * COL_GAP, height: TOP + rows * (NODE_H + ROW_GAP) + PAD };
  }, [edges, producers, gaps]);

  // Merge repeat shipments between the same pair into one drawn edge.
  const drawn = useMemo(() => {
    const m = new Map();
    for (const e of edges) {
      const k = `${e.from.entity_id}>${e.to.entity_id}`;
      if (!m.has(k)) m.set(k, { from: e.from.entity_id, to: e.to.entity_id, ships: [], gap: false, hl: false });
      const d = m.get(k);
      d.ships.push(e);
      d.gap = d.gap || gaps.has(e.shipment_id);
      d.hl = d.hl || hl.has(e.shipment_id);
    }
    return [...m.values()];
  }, [edges, gaps, hl]);

  const anyHl = hl.size > 0;
  return (
    <svg className="trace" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img"
      aria-label={`Supply-chain graph: ${edges.length} shipments`}>
      <defs>
        {['normal', 'gap', 'hl'].map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={k === 'gap' ? 'var(--bad)' : k === 'hl' ? 'var(--ok)' : 'var(--text-3)'} />
          </marker>
        ))}
      </defs>
      {TIERS.map((t, ci) => (
        <text key={t} x={PAD + ci * (NODE_W + COL_GAP)} y={22} fontSize="12" fontWeight="600" fill="var(--text-2)" style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {TIER_TITLE[t]} ({layout.cols[ci].length})
        </text>
      ))}
      {drawn.map((d) => {
        const a = layout.pos[d.from]; const b = layout.pos[d.to];
        if (!a || !b) return null;
        const x1 = a.x + NODE_W; const y1 = a.y + NODE_H / 2; const x2 = b.x - 2; const y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        const kind = d.gap ? 'gap' : d.hl ? 'hl' : 'normal';
        const color = d.gap ? 'var(--bad)' : d.hl ? 'var(--ok)' : 'var(--text-3)';
        const dim = anyHl && !d.hl && !d.gap;
        return (
          <path key={`${d.from}>${d.to}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={color}
            strokeWidth={d.gap || d.hl ? 2.2 : 1.3} strokeDasharray={d.gap ? '6 4' : undefined} opacity={dim ? 0.25 : 0.9} markerEnd={`url(#arrow-${kind})`}>
            <title>{d.ships.map((s) => `${s.shipment_id}: ${s.from.entity_id} → ${s.to.entity_id}, ${fmt.num(s.quantity)} units, ${fmt.dateTime(s.dispatch_timestamp)}${gaps.has(s.shipment_id) ? '  ⚠ sender never received this batch' : ''}`).join('\n')}</title>
          </path>
        );
      })}
      {Object.values(layout.pos).map(({ x, y, n }) => {
        const bad = n.suspicious || n.planted;
        const isFocus = focus && focus === n.entity_id;
        return (
          <g key={n.entity_id} transform={`translate(${x},${y})`}>
            <title>{`${n.entity_id} · ${n.name || ''}${n.planted ? '\nClaims to have produced this batch (planted second PRODUCED edge)' : ''}${n.suspicious ? '\nShipped this batch without ever receiving it' : ''}`}</title>
            <rect width={NODE_W} height={NODE_H} rx="8" fill={bad ? 'var(--bad-soft)' : 'var(--surface)'}
              stroke={isFocus ? 'var(--text)' : bad ? 'var(--bad)' : 'var(--border-strong)'} strokeWidth={isFocus ? 2.5 : bad ? 1.8 : 1}
              strokeDasharray={n.planted ? '5 3' : undefined} />
            <rect width="5" height={NODE_H} rx="2" fill={`var(${TIER_VAR[n.entity_type]})`} />
            <text x="14" y="17" fontSize="12" fontWeight="600" fill="var(--text)" style={{ fontFamily: 'var(--mono)' }}>{n.entity_id}{bad ? '  ⚠' : ''}</text>
            <text x="14" y="33" fontSize="11.5" fill="var(--text-3)">{(n.name || '').length > 28 ? `${n.name.slice(0, 27)}…` : n.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function GraphLegend() {
  return (
    <div className="graph-legend">
      {TIERS.map((t) => <span key={t}><i style={{ background: `var(${TIER_VAR[t]})` }} />{TIER_TITLE[t]}</span>)}
      <span><i style={{ background: 'var(--bad)' }} />Provenance gap (sender never received the batch)</span>
    </div>
  );
}

Object.assign(window, { TraceGraph, GraphLegend, provenanceGapEdges });
