const NEXT_TIER = { manufacturer: 'distributor', distributor: 'wholesaler', wholesaler: 'pharmacy' };

function CreateShipment({ onDone, onCancel, presetBatch }) {
  const { user } = useAuth();
  const toast = useToast();
  const nextType = NEXT_TIER[user.role];
  const receivers = useEntities(nextType);
  const stock = useApi('/inventory', { query: { in_stock: 'true', limit: 500 } });
  const [f, setF] = useState({ batch_id: presetBatch || '', to_entity_id: '', quantity: '', transport_mode: 'road' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const lines = stock.data ? stock.data.items.filter((i) => i.recall_status === 'none' && i.batch_status === 'active' && !i.is_expired) : [];
  const sel = lines.find((i) => i.batch_id === f.batch_id);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const s = await api('/shipments', { method: 'POST', body: { ...f, quantity: Number(f.quantity) } });
      toast(`Sent ${fmt.num(s.quantity)} units to ${s.to_entity.entity_id}. They need to confirm when it arrives.`, 'ok');
      onDone(s);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head"><h2>Send stock</h2><span className="small muted">The units leave your stock now and reach the receiver when they confirm it arrived.</span></div>
      <div className="card-pad form-grid">
        <label className="field full">Which batch?
          <select value={f.batch_id} onChange={set('batch_id')} required>
            <option value="">{stock.loading ? 'Loading stock…' : lines.length ? 'Select…' : 'You have no stock you can send (recalled or expired stock cannot be sent)'}</option>
            {lines.map((i) => <option key={i._id} value={i.batch_id}>{i.batch_id} · {i.product_name} · {fmt.num(i.quantity_on_hand)} on hand</option>)}
          </select>
        </label>
        <label className="field">Send to which {nextType ? TIER_TEXT[nextType].name.toLowerCase() : 'company'}?
          <select value={f.to_entity_id} onChange={set('to_entity_id')} required>
            <option value="">Select…</option>
            {(receivers || []).map((r) => <option key={r._id} value={r._id}>{r._id} · {r.name} · {r.city}</option>)}
          </select>
        </label>
        <label className="field">How many units?{sel ? ` (you have ${fmt.num(sel.quantity_on_hand)})` : ''}
          <input type="number" min="1" max={sel ? sel.quantity_on_hand : undefined} value={f.quantity} onChange={set('quantity')} required />
        </label>
        <label className="field">Transport by
          <select value={f.transport_mode} onChange={set('transport_mode')}>{['road', 'air', 'rail', 'sea'].map((m) => <option key={m}>{m}</option>)}</select>
        </label>
        {error ? <div className="full"><ErrorBox error={error} /></div> : null}
      </div>
      <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : null} Send</button>
      </div>
    </form>
  );
}

function Shipments({ params }) {
  const { user } = useAuth();
  const toast = useToast();
  const over = isOversight(user);
  const canSend = ['manufacturer', 'distributor', 'wholesaler'].includes(user.role);
  const canReceive = ['distributor', 'wholesaler', 'pharmacy'].includes(user.role);
  const [dir, setDir] = useState(user.role === 'manufacturer' ? 'outbound' : canReceive ? 'inbound' : 'all');
  const [status, setStatus] = useState('');
  const [batch, setBatch] = useState(params.batch || '');
  const [skip, setSkip] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const list = useApi('/shipments', { query: { direction: over ? undefined : dir, status, batch_id: batch || undefined, skip, limit: 25 } });

  const receive = async (s) => {
    setBusyId(s._id);
    try {
      await api(`/shipments/${s._id}/receive`, { method: 'PATCH' });
      toast(`Confirmed: ${fmt.num(s.quantity)} units of ${s.product_name || s.batch_id} added to your stock`, 'ok');
      list.reload();
    } catch (err) { toast(err.message, 'bad'); } finally { setBusyId(null); }
  };

  return (
    <div className="stack">
      <PageHead title={over ? 'Shipments' : user.role === 'pharmacy' ? 'Deliveries' : 'Send & receive'} help="shipments" sub={over ? 'Every delivery recorded between companies.' : 'Stock arriving at you, and stock you have sent.'}>
        {canSend && !params.new ? <button className="btn primary" onClick={() => navigate('shipments', { new: 1 })}>+ Send stock</button> : null}
      </PageHead>
      {canSend && params.new ? <CreateShipment presetBatch={params.batch} onCancel={() => navigate('shipments')} onDone={() => { navigate('shipments'); setDir('outbound'); list.reload(); }} /> : null}
      <div className="card">
        <div className="card-head">
          <div className="row">
            {!over ? <Seg value={dir} onChange={(v) => { setSkip(0); setDir(v); }} options={[['inbound', 'Arriving at me'], ['outbound', 'Sent by me'], ['all', 'All']]} /> : null}
            <select value={status} onChange={(e) => { setSkip(0); setStatus(e.target.value); }}>
              <option value="">Any status</option><option value="dispatched">On the way</option><option value="delivered">Delivered</option>
            </select>
            <input placeholder="Filter by batch number" value={batch} onChange={(e) => { setSkip(0); setBatch(e.target.value.trim().toUpperCase()); }} style={{ width: 200 }} />
          </div>
          <span className="small muted">{list.data ? `${fmt.num(list.data.total)} ${list.data.total === 1 ? 'delivery' : 'deliveries'}` : ''}</span>
        </div>
        <Async state={list} empty={(d) => !d.items.length}>
          {(d) => (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Medicine</th><th>From</th><th>To</th><th className="num">Units</th><th>Sent on</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {d.items.map((s) => (
                      <tr key={s._id}>
                        <td><b>{s.product_name}</b><div className="id-code">{s.batch_id} · by {s.transport_mode}</div></td>
                        <td><EntityTag id={s.from_entity.entity_id} name={s.from_entity.name} /></td>
                        <td><EntityTag id={s.to_entity.entity_id} name={s.to_entity.name} /></td>
                        <td className="num">{fmt.num(s.quantity)}</td>
                        <td className="small">{fmt.date(s.dispatch_timestamp)}{s.actual_arrival ? <div className="muted">arrived {fmt.date(s.actual_arrival)}</div> : null}</td>
                        <td><StatusBadge status={s.status} /></td>
                        <td>{canReceive && s.status !== 'delivered' && s.to_entity.entity_id === user.entity_id
                          ? <button className="btn sm primary" disabled={busyId === s._id} onClick={() => receive(s)}>Confirm received</button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager total={d.total} limit={d.limit} skip={d.skip} onChange={setSkip} />
            </>
          )}
        </Async>
      </div>
    </div>
  );
}

Object.assign(window, { Shipments });
