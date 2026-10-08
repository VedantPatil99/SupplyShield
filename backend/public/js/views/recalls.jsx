// The next step a notified company takes, as a button label people understand.
const NEXT_ACTION = {
  notified: ['acknowledged', "I've seen this recall"],
  acknowledged: ['quarantined', "I've set the stock aside"],
  quarantined: ['returned', "I've returned the stock"],
};
const CLASS_TEXT = {
  'Class I': 'Most serious: could cause serious harm or death',
  'Class II': 'Could cause temporary or minor harm',
  'Class III': 'Unlikely to cause harm, but breaks the rules',
};

function RecallSteps({ status }) {
  const order = ['notified', 'acknowledged', 'quarantined', 'returned'];
  const at = order.indexOf(status);
  const labels = ['Notified', 'Seen', 'Set aside', 'Returned'];
  return (
    <div className="row small" style={{ gap: 4 }} aria-label={`Recall step: ${statusText(status)}`}>
      {labels.map((l, i) => (
        <React.Fragment key={l}>
          <Badge kind={i <= at ? (i === 3 ? 'ok' : 'info') : ''}>{i <= at ? '✓ ' : ''}{l}</Badge>
          {i < 3 ? <span className="muted">→</span> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

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
      toast(`Recall started: ${r.affected_entities.length} companies have been notified`, 'ok');
      onDone(r);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="card-head"><h2>Start a recall</h2><span className="small muted">Three steps: choose the batch, see who will be told, confirm.</span></div>
      <div className="card-pad stack">
        <div><b>1. Which batch is unsafe?</b></div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={user.role === 'manufacturer' ? 'Search your batches by name or number' : 'Search batches by name or number'} />
        <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <Async state={batches} empty={(d) => !d.items.length}>
            {(d) => (
              <table><tbody>{d.items.map((b) => (
                <tr key={b._id} className="clickable" onClick={() => toggle(b._id)}>
                  <td style={{ width: 30 }}><input type="checkbox" checked={selected.includes(b._id)} readOnly aria-label={`Select ${b._id}`} /></td>
                  <td><b>{b.product_name}</b><div className="id-code">{b._id}</div></td><td className="small muted">made {fmt.date(b.manufacture_date)}</td>
                </tr>
              ))}</tbody></table>
            )}
          </Async>
        </div>
        <div className="form-grid">
          <label className="field">How serious is it?
            <select value={klass} onChange={(e) => setKlass(e.target.value)}>
              {Object.entries(CLASS_TEXT).map(([k, v]) => <option key={k} value={k}>{k}: {v}</option>)}
            </select>
          </label>
          <label className="field">Reason (shown to every company)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tablets failed a strength test" />
          </label>
        </div>
        <div><b>2. Who will be told?</b> <button className="btn sm" style={{ marginLeft: 8 }} disabled={busy || !selected.length} onClick={doPreview}>Find every company that received it</button></div>
        <ErrorBox error={error} />
        {preview ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="note"><b>{preview.affected.length} companies</b> received {selected.length === 1 ? 'this batch' : 'these batches'}. All of them will be notified when you confirm.</div>
            <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table>
                <thead><tr><th>Company</th><th className="num">Still holds</th></tr></thead>
                <tbody>{preview.affected.map((a) => (
                  <tr key={a.entity_id}><td><EntityTag id={a.entity_id} name={a.name} type={a.entity_type} /></td><td className="num">{fmt.num(a.quantity_on_hand)} units</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ) : <div className="small muted">Select a batch, then press the button to see who received it.</div>}
        <div><b>3. Confirm</b></div>
      </div>
      <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn danger" disabled={busy || !preview || !reason.trim()} onClick={confirm}
          title={!preview ? 'First find who received it' : !reason.trim() ? 'Enter a reason' : ''}>{busy ? <Spinner /> : null} Start recall and notify everyone</button>
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
      toast(r.status === 'completed' ? 'Every company has returned its stock. The recall is complete.' : `Updated: ${statusText(status)}`, 'ok');
      s.reload(); onChanged();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <Async state={s}>
        {(r) => {
          const mine = r.affected_entities.find((a) => a.entity_id === user.entity_id);
          const company = !isOversight(user) && user.role !== 'manufacturer';
          return (
            <>
              <div className="card-head">
                <div>
                  <div className="row"><h2>Recall of {r.batch_ids.join(', ')}</h2><StatusBadge status={r.status} /></div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    Started by {r.initiated_by_name || r.initiated_by} on {fmt.date(r.initiated_at)} · <span className="id-code">{r._id}</span>
                  </div>
                </div>
                <button className="btn sm" onClick={() => navigate('map', { batch: r.batch_ids[0] })}>See it on the network map →</button>
              </div>
              <div className="card-pad stack">
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <Badge kind={r.recall_class === 'Class I' ? 'bad' : 'warn'}>{r.recall_class}</Badge>
                  <div><b>{CLASS_TEXT[r.recall_class]}.</b> Reason: {r.reason}</div>
                </div>
                {mine ? (
                  <div className="note stack" style={{ gap: 8 }}>
                    <div><b>Your part:</b> {mine.status === 'returned' ? 'you have returned your stock. Nothing more to do.' : 'stop selling or shipping this batch, then complete each step below.'}</div>
                    <RecallSteps status={mine.status} />
                    {r.status === 'in_progress' && NEXT_ACTION[mine.status] ? (
                      <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => act(mine.entity_id, NEXT_ACTION[mine.status][0])}>{NEXT_ACTION[mine.status][1]}</button>
                    ) : null}
                  </div>
                ) : null}
                {!company ? <RecallProgress progress={r.progress} /> : null}
              </div>
              {!company ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Company</th><th>Response</th><th>Last update</th>{user.role === 'admin' && r.status === 'in_progress' ? <th /> : null}</tr></thead>
                    <tbody>{r.affected_entities.map((a) => (
                      <tr key={a.entity_id}>
                        <td><EntityTag id={a.entity_id} name={a.name} type={a.entity_type} /></td>
                        <td><StatusBadge status={a.status} /></td>
                        <td className="small">{fmt.date(a.updated_at)}</td>
                        {user.role === 'admin' && r.status === 'in_progress' ? (
                          <td>{NEXT_ACTION[a.status] ? <button className="btn sm" disabled={busy} onClick={() => act(a.entity_id, NEXT_ACTION[a.status][0])} title="Record this on the company's behalf">{statusText(NEXT_ACTION[a.status][0])}</button> : null}</td>
                        ) : null}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : null}
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
  const company = !isOversight(user) && user.role !== 'manufacturer';
  const [status, setStatus] = useState('in_progress');
  const list = useApi('/recalls', { query: { status: status || undefined } });
  const selected = params.id;

  return (
    <div className="stack">
      <PageHead title="Recalls" help="recalls"
        sub={company ? 'Recalls of medicine you received. Each one tells you what to do next.' : 'Unsafe batches being taken out of circulation, and who has responded.'}>
        <Seg value={status} onChange={setStatus} options={[['in_progress', 'In progress'], ['completed', 'Completed'], ['', 'All']]} />
        {canInitiate && !params.new ? <button className="btn danger" onClick={() => navigate('recalls', { new: 1 })}>Start a recall</button> : null}
      </PageHead>
      {canInitiate && params.new ? <InitiateRecall onCancel={() => navigate('recalls')} onDone={(r) => { list.reload(); navigate('recalls', { id: r._id }); }} /> : null}
      <div className={`split-layout ${selected ? 'has-panel' : ''}`}>
        <div className="card">
          <Async state={list} empty={(d) => !d.items.length}>
            {(d) => (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Recalled batch</th><th>{company ? 'Your response' : 'Companies returned'}</th></tr></thead>
                  <tbody>{d.items.map((r) => (
                    <tr key={r._id} className="clickable" style={r._id === selected ? { outline: '2px solid var(--brand)', outlineOffset: -2 } : undefined}
                      onClick={() => navigate('recalls', { id: r._id })}>
                      <td>
                        <span className="mono">{r.batch_ids.join(', ')}</span> <Badge kind={r.recall_class === 'Class I' ? 'bad' : 'warn'}>{r.recall_class}</Badge>
                        <div className="small muted">{r.reason}</div>
                      </td>
                      <td style={{ minWidth: 160 }}>
                        {company ? <StatusBadge status={r.my_status} /> : (
                          <>
                            <Progress total={r.progress.total} segments={recallSegments(r.progress.by_status)} />
                            <div className="small muted">{r.progress.by_status.returned} of {r.progress.total} returned</div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Async>
          {!selected && list.data && list.data.items.length ? <div className="small muted" style={{ padding: '10px 14px' }}>Click a recall to see details{company ? ' and respond' : ''}.</div> : null}
        </div>
        {selected ? <RecallDetail key={selected} id={selected} onChanged={list.reload} /> : null}
      </div>
    </div>
  );
}

Object.assign(window, { Recalls });
