const NEXT_ACTION = { notified: ['acknowledged', 'Acknowledge'], acknowledged: ['quarantined', 'Quarantine stock'], quarantined: ['returned', 'Mark returned'] };

function InitiateRecall({ onDone, onCancel }) {
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const batches = useApi('/batches', { query: { status: 'active', q, limit: 50 } });
  const [selected, setSelected] = useState([]);
  const [reason, setReason] = useState('');
  const [klass, setKlass] = useState('Class II');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (id) => { setPreview(null); setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); };
  const doPreview = async () => {
    setBusy(true); setError(null);
    try { setPreview(await api('/recalls/preview', { method: 'POST', body: { batch_ids: selected } })); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api('/recalls', { method: 'POST', body: { batch_ids: selected, reason, recall_class: klass } });
      toast(`Recall ${r._id} initiated: ${r.affected_entities.length} entities notified`, 'ok');
      onDone(r);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="card-head"><h2>Initiate a recall</h2><span className="small muted">FR-6 · affected entities come from graph traversal</span></div>
      <div className="card-pad stack">
        <div className="form-grid">
          <label className="field full">Find {user.role === 'manufacturer' ? 'your ' : ''}active batches<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Batch id or product" /></label>
        </div>
        <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <Async state={batches} empty={(d) => !d.items.length}>
            {(d) => (
              <table><tbody>{d.items.map((b) => (
                <tr key={b._id} className="clickable" onClick={() => toggle(b._id)}>
                  <td style={{ width: 30 }}><input type="checkbox" checked={selected.includes(b._id)} readOnly aria-label={`Select ${b._id}`} /></td>
                  <td className="mono">{b._id}</td><td>{b.product_name}</td><td className="small muted">{fmt.date(b.manufacture_date)}</td>
                </tr>
              ))}</tbody></table>
            )}
          </Async>
        </div>
        <div className="form-grid">
          <label className="field">Recall class
            <select value={klass} onChange={(e) => setKlass(e.target.value)}>
              <option>Class I</option><option>Class II</option><option>Class III</option>
            </select>
          </label>
          <label className="field">Selected<input value={selected.join(', ') || 'none'} readOnly /></label>
          <label className="field full">Reason<textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sub-potent active ingredient identified in stability testing" /></label>
        </div>
        <ErrorBox error={error} />
        {preview ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="note"><b>{preview.affected.length}</b> downstream entities hold or received {selected.length === 1 ? 'this batch' : 'these batches'} (graph traversal took {preview.graph_ms} ms). They will all be notified.</div>
            <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table>
                <thead><tr><th>Entity</th><th>Type</th><th className="num">Shipments received</th><th className="num">On hand now</th></tr></thead>
                <tbody>{preview.affected.map((a) => (
                  <tr key={a.entity_id}><td><EntityTag id={a.entity_id} name={a.name} /></td><td><Badge>{fmt.label(a.entity_type)}</Badge></td><td className="num">{a.shipments}</td><td className="num">{fmt.num(a.quantity_on_hand)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
      <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy || !selected.length} onClick={doPreview}>Preview affected entities</button>
        <button className="btn danger" disabled={busy || !preview || !reason.trim()} onClick={confirm}>{busy ? <Spinner /> : null} Confirm recall</button>
      </div>
    </div>
  );
}

function RecallDetail({ id, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const s = useApi(`/recalls/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const act = async (entityId, status) => {
    setBusy(true);
    try {
      const r = await api(`/recalls/${encodeURIComponent(id)}/entities/${entityId}`, { method: 'PATCH', body: { status } });
      toast(r.status === 'completed' ? `All entities returned stock: ${id} is now completed` : `${entityId}: ${status}`, 'ok');
      s.reload(); onChanged();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <Async state={s}>
        {(r) => {
          const mine = r.affected_entities.find((a) => a.entity_id === user.entity_id);
          return (
            <>
              <div className="card-head">
                <div>
                  <div className="row"><h2 className="mono">{r._id}</h2><Badge kind={r.recall_class === 'Class I' ? 'bad' : 'warn'}>{r.recall_class}</Badge><StatusBadge status={r.status} /></div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {r.batch_ids.map((b) => <span key={b} className="mono">{b} </span>)}· initiated by <span className="mono">{r.initiated_by}</span>{r.initiated_by_name ? ` (${r.initiated_by_name})` : ''} on {fmt.date(r.initiated_at)}
                  </div>
                </div>
              </div>
              <div className="card-pad stack">
                <div><b>Reason:</b> {r.reason}</div>
                <RecallProgress progress={r.progress} />
                {mine && r.status === 'in_progress' && NEXT_ACTION[mine.status] ? (
                  <div className="note row">
                    <span>Your status: <StatusBadge status={mine.status} /></span>
                    <button className="btn primary right" disabled={busy} onClick={() => act(mine.entity_id, NEXT_ACTION[mine.status][0])}>{NEXT_ACTION[mine.status][1]}</button>
                  </div>
                ) : null}
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Affected entity</th><th>Type</th><th>Status</th><th>Updated</th>{user.role === 'admin' && r.status === 'in_progress' ? <th /> : null}</tr></thead>
                  <tbody>{r.affected_entities.map((a) => (
                    <tr key={a.entity_id}>
                      <td><EntityTag id={a.entity_id} name={a.name} /></td>
                      <td><Badge>{fmt.label(a.entity_type)}</Badge></td>
                      <td><StatusBadge status={a.status} /></td>
                      <td className="small">{fmt.dateTime(a.updated_at)}</td>
                      {user.role === 'admin' && r.status === 'in_progress' ? (
                        <td>{NEXT_ACTION[a.status] ? <button className="btn sm" disabled={busy} onClick={() => act(a.entity_id, NEXT_ACTION[a.status][0])}>{NEXT_ACTION[a.status][1]}</button> : null}</td>
                      ) : null}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          );
        }}
      </Async>
    </div>
  );
}

function Recalls({ params }) {
  const { user } = useAuth();
  const canInitiate = ['manufacturer', 'regulator', 'admin'].includes(user.role);
  const [status, setStatus] = useState('in_progress');
  const list = useApi('/recalls', { query: { status: status || undefined } });
  const selected = params.id;

  return (
    <div className="stack">
      <PageHead title="Recalls" sub="Recall initiation, notifications and per-entity progress (FR-6, FR-7)">
        <Seg value={status} onChange={setStatus} options={[['in_progress', 'In progress'], ['completed', 'Completed'], ['', 'All']]} />
        {canInitiate && !params.new ? <button className="btn danger" onClick={() => navigate('recalls', { new: 1 })}>Initiate recall</button> : null}
      </PageHead>
      {canInitiate && params.new ? <InitiateRecall onCancel={() => navigate('recalls')} onDone={(r) => { list.reload(); navigate('recalls', { id: r._id }); }} /> : null}
      <div className="grid" style={{ gridTemplateColumns: selected ? 'minmax(0, 1fr) minmax(0, 1.3fr)' : '1fr', alignItems: 'start' }}>
        <div className="card">
          <Async state={list} empty={(d) => !d.items.length}>
            {(d) => (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Recall</th><th>Class</th><th>Progress</th>{!isOversight(user) && user.role !== 'manufacturer' ? <th>You</th> : null}</tr></thead>
                  <tbody>{d.items.map((r) => (
                    <tr key={r._id} className="clickable" style={r._id === selected ? { outline: '2px solid var(--brand)', outlineOffset: -2 } : undefined}
                      onClick={() => navigate('recalls', { id: r._id })}>
                      <td><span className="mono">{r._id}</span><div className="small muted">{r.batch_ids.join(', ')} · {fmt.date(r.initiated_at)}</div></td>
                      <td><Badge kind={r.recall_class === 'Class I' ? 'bad' : 'warn'}>{r.recall_class}</Badge></td>
                      <td style={{ minWidth: 150 }}>
                        <Progress total={r.progress.total} segments={[
                          { label: 'returned', value: r.progress.by_status.returned, color: 'var(--ok)' },
                          { label: 'quarantined', value: r.progress.by_status.quarantined, color: 'var(--warn)' },
                          { label: 'acknowledged', value: r.progress.by_status.acknowledged, color: 'var(--info)' },
                          { label: 'notified', value: r.progress.by_status.notified, color: 'var(--bad)' },
                        ]} />
                        <div className="small muted">{r.progress.returned_pct}% returned of {r.progress.total}</div>
                      </td>
                      {!isOversight(user) && user.role !== 'manufacturer' ? <td><StatusBadge status={r.my_status} /></td> : null}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Async>
        </div>
        {selected ? <RecallDetail key={selected} id={selected} onChanged={list.reload} /> : null}
      </div>
    </div>
  );
}

Object.assign(window, { Recalls });
