// Shared presentational components.

function Badge({ kind = '', children, title }) {
  return <span className={`badge ${kind}`} title={title}>{children}</span>;
}

const STATUS_KIND = {
  active: 'ok', delivered: 'ok', returned: 'ok', completed: 'ok', reviewed: 'info', verified: 'ok',
  dispatched: 'info', in_transit: 'info', acknowledged: 'info', in_progress: 'warn',
  quarantined: 'warn', notified: 'bad', recalled: 'bad', expired: 'bad', open: 'bad', dismissed: '', cancelled: '',
  high: 'bad', medium: 'warn', low: 'info',
};
function StatusBadge({ status }) {
  return <Badge kind={STATUS_KIND[status] || ''}>{fmt.type(status)}</Badge>;
}

const TIER_KIND = { manufacturer: 'brand', distributor: 'info', wholesaler: '', pharmacy: 'warn' };
function EntityTag({ id, name, type }) {
  return (
    <span title={name || id}>
      <span className="mono">{id}</span>
      {name ? <span className="muted small"> · {name}</span> : null}
      {type ? <> <Badge kind={TIER_KIND[type] || ''}>{type}</Badge></> : null}
    </span>
  );
}

function Spinner() { return <span className="spinner" aria-label="Loading" />; }
function Loading({ label = 'Loading…' }) { return <div className="loading"><Spinner /> <span style={{ marginLeft: 8 }}>{label}</span></div>; }
function Empty({ children = 'Nothing to show.' }) { return <div className="empty">{children}</div>; }
function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error-box" role="alert">{error.message || String(error)}</div>;
}

/** Renders loading / error / empty states around a data block. */
function Async({ state, empty, children }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <div className="card-pad"><ErrorBox error={state.error} /></div>;
  if (!state.data) return null;
  const out = children(state.data);
  if (empty && empty(state.data)) return <Empty />;
  return out;
}

function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>
      {children ? <div className="row">{children}</div> : null}
    </div>
  );
}

function Stat({ label, value, hint, kind }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={kind ? { color: `var(--${kind})` } : undefined}>{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/** Stacked progress bar: segments [{value, color, label}] out of total. */
function Progress({ segments, total }) {
  return (
    <div className="progress" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}>
      {segments.map((s) => (
        <span key={s.label} title={`${s.label}: ${s.value}`} style={{ width: `${total ? (s.value / total) * 100 : 0}%`, background: s.color }} />
      ))}
    </div>
  );
}

function RecallProgress({ progress }) {
  const b = progress.by_status;
  return (
    <div>
      <Progress total={progress.total} segments={[
        { label: 'returned', value: b.returned, color: 'var(--ok)' },
        { label: 'quarantined', value: b.quarantined, color: 'var(--warn)' },
        { label: 'acknowledged', value: b.acknowledged, color: 'var(--info)' },
        { label: 'notified', value: b.notified, color: 'var(--bad)' },
      ]} />
      <div className="row small muted" style={{ marginTop: 6, gap: 14 }}>
        <span><b style={{ color: 'var(--ok)' }}>{b.returned}</b> returned</span>
        <span><b style={{ color: 'var(--warn)' }}>{b.quarantined}</b> quarantined</span>
        <span><b style={{ color: 'var(--info)' }}>{b.acknowledged}</b> acknowledged</span>
        <span><b style={{ color: 'var(--bad)' }}>{b.notified}</b> not yet responded</span>
        <span className="right">{progress.returned_pct}% returned</span>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="card-pad">{children}</div>
        {footer ? <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

function Pager({ total, limit, skip, onChange }) {
  if (!total || total <= limit) return null;
  return (
    <div className="row small muted" style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
      <span>{skip + 1}–{Math.min(skip + limit, total)} of {fmt.num(total)}</span>
      <span className="right" />
      <button className="btn sm" disabled={skip === 0} onClick={() => onChange(Math.max(0, skip - limit))}>Previous</button>
      <button className="btn sm" disabled={skip + limit >= total} onClick={() => onChange(skip + limit)}>Next</button>
    </div>
  );
}

function Seg({ value, options, onChange }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

/** Entity picker backed by /api/entities (cached per type). type=false skips the fetch. */
const entityCache = {};
function useEntities(type) {
  const [items, setItems] = useState(entityCache[type || 'all'] || null);
  useEffect(() => {
    const key = type || 'all';
    if (type === false || entityCache[key]) return;
    api('/entities', { query: { type } }).then((d) => { entityCache[key] = d.items; setItems(d.items); }).catch(() => setItems([]));
  }, [type]);
  return items;
}

Object.assign(window, {
  Badge, StatusBadge, EntityTag, Spinner, Loading, Empty, ErrorBox, Async, PageHead, Stat, Progress, RecallProgress, Modal, Pager, Seg, useEntities,
});
