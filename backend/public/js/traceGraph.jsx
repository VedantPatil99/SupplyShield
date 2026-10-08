// Visual map of one batch's journey: Manufacturer -> Distributor -> Wholesaler -> Pharmacy.
// A delivery line is red and dashed when the sender never made or received the batch itself
// (the same rule the server-side "Stock from an unknown source" check uses).

const TIERS = ['manufacturer', 'distributor', 'wholesaler', 'pharmacy'];
const TIER_VAR = { manufacturer: '--t-mfg', distributor: '--t-dist', wholesaler: '--t-whs', pharmacy: '--t-pharm' };
const RECALL_COLOR = { notified: 'var(--bad)', acknowledged: 'var(--info)', quarantined: 'var(--warn)', returned: 'var(--ok)' };

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

/** Shipments upstream and downstream of one company (its path through the batch). */
function pathOf(edges, entityId) {
  const keep = new Set();
  const walk = (near, far) => {
    const seen = new Set([entityId]);
    const queue = [entityId];
    while (queue.length) {
      const cur = queue.shift();
      for (const e of edges) {
        if (near(e) !== cur) continue;
        keep.add(e.shipment_id);
        if (!seen.has(far(e))) { seen.add(far(e)); queue.push(far(e)); }
      }
    }
  };
  walk((e) => e.to.entity_id, (e) => e.from.entity_id);
  walk((e) => e.from.entity_id, (e) => e.to.entity_id);
  return keep;
}

function TraceGraph({ edges, producers, highlight, focus, nodeStatus, selected, onSelect }) {
  const hasStatus = nodeStatus && Object.keys(nodeStatus).length > 0;
  const NODE_W = 214; const NODE_H = hasStatus ? 62 : 48; const COL_GAP = 84; const ROW_GAP = 12; const TOP = 48; const PAD = 16;
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
    // Only tiers that have companies get a column (a pharmacy's own view may skip some).
    const tiers = TIERS.filter((tier) => [...nodes.values()].some((n) => n.entity_type === tier));
    const cols = tiers.map((tier) => [...nodes.values()].filter((n) => n.entity_type === tier).sort((a, b) => a.first - b.first));
    const pos = {};
    cols.forEach((col, ci) => col.forEach((n, ri) => {
      pos[n.entity_id] = { x: PAD + ci * (NODE_W + COL_GAP), y: TOP + ri * (NODE_H + ROW_GAP), n };
    }));
    const rows = Math.max(1, ...cols.map((c) => c.length));
    return { tiers, cols, pos, width: PAD * 2 + tiers.length * NODE_W + Math.max(0, tiers.length - 1) * COL_GAP, height: TOP + rows * (NODE_H + ROW_GAP) + PAD };
  }, [edges, producers, gaps, NODE_H]);

  // Merge repeat deliveries between the same two companies into one drawn line.
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
  const trunc = (s, n) => ((s || '').length > n ? `${s.slice(0, n - 1)}…` : s || '');
  return (
    <svg className="trace" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img"
      aria-label={`Map of ${edges.length} deliveries between ${Object.keys(layout.pos).length} companies`}>
      <defs>
        {['normal', 'gap', 'hl'].map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={k === 'gap' ? 'var(--bad)' : k === 'hl' ? 'var(--brand)' : 'var(--text-3)'} />
          </marker>
        ))}
      </defs>
      {layout.tiers.map((t, ci) => (
        <g key={t}>
          <text x={PAD + ci * (NODE_W + COL_GAP)} y={20} fontSize="13" fontWeight="600" fill="var(--text)">{TIER_TEXT[t].plural} ({layout.cols[ci].length})</text>
          <text x={PAD + ci * (NODE_W + COL_GAP)} y={36} fontSize="11.5" fill="var(--text-3)">{TIER_TEXT[t].does}</text>
        </g>
      ))}
      {drawn.map((d) => {
        const a = layout.pos[d.from]; const b = layout.pos[d.to];
        if (!a || !b) return null;
        const x1 = a.x + NODE_W; const y1 = a.y + NODE_H / 2; const x2 = b.x - 2; const y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        const kind = d.gap ? 'gap' : d.hl ? 'hl' : 'normal';
        const color = d.gap ? 'var(--bad)' : d.hl ? 'var(--brand)' : 'var(--text-3)';
        const dim = anyHl && !d.hl;
        return (
          <path key={`${d.from}>${d.to}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={color}
            strokeWidth={d.gap || d.hl ? 2.4 : 1.4} strokeDasharray={d.gap ? '6 4' : undefined} opacity={dim ? 0.15 : 0.9} markerEnd={`url(#arrow-${kind})`}>
            <title>{d.ships.map((s) => `${s.from.name || s.from.entity_id} → ${s.to.name || s.to.entity_id}: ${fmt.num(s.quantity)} units on ${fmt.date(s.dispatch_timestamp)}${gaps.has(s.shipment_id) ? '\n⚠ The sender never received this batch itself' : ''}`).join('\n')}</title>
          </path>
        );
      })}
      {Object.values(layout.pos).map(({ x, y, n }) => {
        const bad = n.suspicious || n.planted;
        const isSel = selected === n.entity_id;
        const isFocus = focus === n.entity_id;
        const st = nodeStatus && nodeStatus[n.entity_id];
        const dim = anyHl && selected && !isSel && !drawn.some((d) => d.hl && (d.from === n.entity_id || d.to === n.entity_id));
        return (
          <g key={n.entity_id} transform={`translate(${x},${y})`} opacity={dim ? 0.35 : 1}
            style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={onSelect ? () => onSelect(n.entity_id) : undefined}
            tabIndex={onSelect ? 0 : undefined} role={onSelect ? 'button' : undefined}
            aria-label={onSelect ? `${n.name || n.entity_id}: show details` : undefined}
            onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.entity_id); } } : undefined}>
            <title>{`${n.name || n.entity_id} (${n.entity_id})${n.planted ? '\n⚠ Claims to have made this batch, but is not the registered maker' : ''}${n.suspicious ? '\n⚠ Shipped this batch without ever receiving it' : ''}${st ? `\nRecall: ${statusText(st)}` : ''}\nClick for details`}</title>
            <rect width={NODE_W} height={NODE_H} rx="9" fill={bad ? 'var(--bad-soft)' : 'var(--surface)'}
              stroke={isSel || isFocus ? 'var(--brand)' : bad ? 'var(--bad)' : 'var(--border-strong)'} strokeWidth={isSel || isFocus ? 3 : bad ? 1.8 : 1}
              strokeDasharray={n.planted ? '5 3' : undefined} />
            <rect width="5" height={NODE_H} rx="2" fill={`var(${TIER_VAR[n.entity_type]})`} />
            <text x="15" y="19" fontSize="13" fontWeight="600" fill="var(--text)">{trunc(n.name || n.entity_id, 24)}{bad ? ' ⚠' : ''}</text>
            <text x="15" y="36" fontSize="11" fill="var(--text-3)" style={{ fontFamily: 'var(--mono)' }}>{n.entity_id}</text>
            {st ? (
              <g transform="translate(15, 47)">
                <circle cx="4" cy="4" r="4.5" fill={RECALL_COLOR[st] || 'var(--text-3)'} />
                <text x="14" y="8" fontSize="11.5" fontWeight="600" fill={RECALL_COLOR[st] || 'var(--text-3)'}>{statusText(st)}</text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function GraphLegend({ withRecall }) {
  return (
    <div className="graph-legend">
      <span><svg width="26" height="10" aria-hidden="true"><path d="M1,5 H25" stroke="var(--text-3)" strokeWidth="1.6" /></svg> Delivery</span>
      <span><svg width="26" height="10" aria-hidden="true"><path d="M1,5 H25" stroke="var(--bad)" strokeWidth="2.2" strokeDasharray="5 3" /></svg> Delivery from a company that never received this batch</span>
      <span><i style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad)' }} />Company flagged as a problem</span>
      {withRecall ? (
        <>
          <span><i style={{ background: 'var(--bad)', borderRadius: 99 }} />Not yet responded</span>
          <span><i style={{ background: 'var(--info)', borderRadius: 99 }} />Seen</span>
          <span><i style={{ background: 'var(--warn)', borderRadius: 99 }} />Set aside</span>
          <span><i style={{ background: 'var(--ok)', borderRadius: 99 }} />Returned</span>
        </>
      ) : null}
    </div>
  );
}

Object.assign(window, { TraceGraph, GraphLegend, provenanceGapEdges, pathOf });
