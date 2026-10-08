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
  return <Badge kind={STATUS_KIND[status] || ''}>{statusText(status)}</Badge>;
}

const TIER_KIND = { manufacturer: 'brand', distributor: 'info', wholesaler: '', pharmacy: 'warn' };
function TierBadge({ type }) {
  const t = tierOf(type);
  return t ? <Badge kind={TIER_KIND[t]}>{TIER_TEXT[t].name}</Badge> : null;
}

/** A company: name first (what people recognise), ID code small underneath. */
function EntityTag({ id, name, type }) {
  return (
    <span className="entity-tag">
      <span className="row" style={{ gap: 6 }}>
        <span style={{ fontWeight: 500 }}>{name || id}</span>
        {type ? <TierBadge type={type} /> : null}
      </span>
      {name ? <span className="id-code">{id}</span> : null}
    </span>
  );
}

/** "What is this page?" box. Can be hidden; remembered per page in this browser. */
function PageHelp({ page }) {
  const help = PAGE_HELP[page];
  const key = `ss_help_hidden_${page}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } });
  if (!help) return null;
  const set = (v) => { setHidden(v); try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) { /* ignore */ } };
  if (hidden) {
    return <button className="btn ghost sm help-show" onClick={() => set(false)}>ⓘ What is this page?</button>;
  }
  return (
    <div className="help-box" role="note">
      <div className="help-icon" aria-hidden="true">i</div>
      <div style={{ flex: 1 }}>
        <div className="help-title">{help.title}</div>
        <div>{help.body}</div>
      </div>
      <button className="btn ghost sm" onClick={() => set(true)} aria-label="Hide this explanation">Hide</button>
    </div>
  );
}

/** Small grey technical name, for people who want the term used in the report. */
function Tech({ children }) {
  return <span className="tech" title="Technical term">{children}</span>;
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

function PageHead({ title, sub, help, children }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>
        {children ? <div className="row">{children}</div> : null}
      </div>
      {help ? <PageHelp page={help} /> : null}
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

const recallSegments = (b) => [
  { label: 'returned', value: b.returned, color: 'var(--ok)' },
  { label: 'set aside', value: b.quarantined, color: 'var(--warn)' },
  { label: 'seen', value: b.acknowledged, color: 'var(--info)' },
  { label: 'not yet responded', value: b.notified, color: 'var(--bad)' },
];

function RecallProgress({ progress }) {
  const b = progress.by_status;
  return (
    <div>
      <Progress total={progress.total} segments={recallSegments(b)} />
      <div className="row small muted" style={{ marginTop: 6, gap: 14 }}>
        <span><b style={{ color: 'var(--ok)' }}>{b.returned}</b> returned</span>
        <span><b style={{ color: 'var(--warn)' }}>{b.quarantined}</b> set aside</span>
        <span><b style={{ color: 'var(--info)' }}>{b.acknowledged}</b> seen</span>
        <span><b style={{ color: 'var(--bad)' }}>{b.notified}</b> not yet responded</span>
        <span className="right"><b>{b.returned} of {progress.total}</b> companies have returned their stock</span>
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
  TierBadge, PageHelp, Tech, recallSegments,
  Badge, StatusBadge, EntityTag, Spinner, Loading, Empty, ErrorBox, Async, PageHead, Stat, Progress, RecallProgress, Modal, Pager, Seg, useEntities,
});
