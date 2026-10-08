function RegisterBatch({ onDone, onCancel }) {
  const { user } = useAuth();
  const toast = useToast();
  const mfgs = useEntities(user.role === 'admin' ? 'manufacturer' : null);
  const [f, setF] = useState({
    product_name: '', product_code: '', manufacture_date: '2026-08-20', expiry_date: '2028-08-20', quantity_produced: 100000,
    tmin: 15, tmax: 25, cold: false, approval: '', manufacturer_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const b = await api('/batches', {
        method: 'POST',
        body: {
          product_name: f.product_name, product_code: f.product_code, manufacture_date: f.manufacture_date, expiry_date: f.expiry_date,
          quantity_produced: Number(f.quantity_produced),
          storage_conditions: { temperature_range_c: [Number(f.tmin), Number(f.tmax)], requires_cold_chain: f.cold },
          regulatory: { approval_number: f.approval || undefined },
          ...(user.role === 'admin' ? { manufacturer_id: f.manufacturer_id } : {}),
        },
      });
      toast(`Registered: batch number ${b._id}, ${fmt.num(b.quantity_produced)} units added to your stock`, 'ok');
      onDone(b);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head"><h2>Register a new batch</h2><span className="small muted">Records a new production run. The units are added to your stock, ready to send.</span></div>
      <div className="card-pad form-grid">
        {user.role === 'admin' ? (
          <label className="field full">Manufacturer
            <select value={f.manufacturer_id} onChange={set('manufacturer_id')} required>
              <option value="">Select…</option>
              {(mfgs || []).map((m) => <option key={m._id} value={m._id}>{m._id} · {m.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="field">Medicine name<input value={f.product_name} onChange={set('product_name')} placeholder="Paracetamol 500mg Tablets" required /></label>
        <label className="field">Product code (letters, numbers, dashes)<input value={f.product_code} onChange={set('product_code')} placeholder="PARA500-TAB" required pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" /></label>
        <label className="field">Manufacture date<input type="date" value={f.manufacture_date} onChange={set('manufacture_date')} required /></label>
        <label className="field">Expiry date<input type="date" value={f.expiry_date} onChange={set('expiry_date')} required /></label>
        <label className="field">How many units were made?<input type="number" min="1" value={f.quantity_produced} onChange={set('quantity_produced')} required /></label>
        <label className="field">Approval number (optional)<input value={f.approval} onChange={set('approval')} placeholder="CDSCO-2026-…" /></label>
        <label className="field">Store at minimum (°C)<input type="number" value={f.tmin} onChange={set('tmin')} /></label>
        <label className="field">Store at maximum (°C)<input type="number" value={f.tmax} onChange={set('tmax')} /></label>
        <label className="row small full" style={{ gap: 8 }}><input type="checkbox" checked={f.cold} onChange={set('cold')} /> Must be kept refrigerated (cold chain)</label>
        {error ? <div className="full"><ErrorBox error={error} /></div> : null}
      </div>
      <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : null} Register batch</button>
      </div>
    </form>
  );
}

function BatchDetail({ id, onClose }) {
  const { user } = useAuth();
  const s = useApi(`/batches/${id}`);
  const canTrace = isOversight(user) || (s.data && s.data.manufacturer_id === user.entity_id);
  return (
    <Modal title={id} onClose={onClose} footer={canTrace ? <button className="btn primary" onClick={() => navigate('map', { batch: id })}>See it on the network map</button> : null}>
      <Async state={s}>
        {(b) => (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row"><h3>{b.product_name}</h3><StatusBadge status={b.status} />{b.is_expired ? <Badge kind="bad">Expired</Badge> : null}</div>
            <table><tbody>
              <tr><th>Made by</th><td><EntityTag id={b.manufacturer_id} name={b.manufacturer_name} /></td></tr>
              <tr><th>Product code</th><td className="mono">{b.product_code}</td></tr>
              <tr><th>Made on</th><td>{fmt.date(b.manufacture_date)}</td></tr>
              <tr><th>Expires</th><td>{fmt.date(b.expiry_date)}</td></tr>
              <tr><th>Quantity</th><td>{fmt.num(b.quantity_produced)} {b.unit}</td></tr>
              <tr><th>Storage</th><td>{(b.storage_conditions && b.storage_conditions.temperature_range_c || []).join('–')} °C{b.storage_conditions && b.storage_conditions.requires_cold_chain ? ' · cold chain' : ''}</td></tr>
              <tr><th>Quality check</th><td>{b.quality_control && b.quality_control.qc_passed ? <Badge kind="ok">Passed</Badge> : <Badge kind="bad">Not passed</Badge>} <span className="mono small">{b.quality_control && b.quality_control.qc_certificate_id}</span></td></tr>
              <tr><th>Recalls</th><td>{b.recalls.length ? b.recalls.map((r) => <span key={r._id} className="row"><span className="mono">{r._id}</span><StatusBadge status={r.status} /></span>) : 'None'}</td></tr>
              {b.anomalies ? <tr><th>Suspicious activity</th><td>{b.anomalies.length ? b.anomalies.map((a) => <div key={a._id}><StatusBadge status={a.severity} /> {CHECK_TEXT[a.type].title}</div>) : 'None'}</td></tr> : null}
              {b.holders ? <tr><th>Who holds it now</th><td>{b.holders.length ? b.holders.map((h) => <div key={h._id}><span className="mono">{h.entity_id}</span>: {fmt.num(h.quantity_on_hand)}</div>) : 'None'}</td></tr> : null}
            </tbody></table>
          </div>
        )}
      </Async>
    </Modal>
  );
}

function Batches({ params }) {
  const { user } = useAuth();
  const canRegister = user.role === 'manufacturer' || user.role === 'admin';
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const [detail, setDetail] = useState(null);
  const showForm = canRegister && params.new;
  const list = useApi('/batches', { query: { q: query, status, skip, limit: 25 } });

  return (
    <div className="stack">
      <PageHead title={user.role === 'manufacturer' ? 'My batches' : 'Batches'}
        help="batches" sub={isOversight(user) ? 'Every batch being tracked.' : user.role === 'manufacturer' ? 'Batches your company has made.' : 'Batches you hold or have sent.'}>
        {canRegister && !showForm ? <button className="btn primary" onClick={() => navigate('batches', { new: 1 })}>+ Register batch</button> : null}
      </PageHead>
      {showForm ? <RegisterBatch onCancel={() => navigate('batches')} onDone={(b) => { navigate('batches'); list.reload(); setDetail(b._id); }} /> : null}
      <div className="card">
        <div className="card-head">
          <form className="row" onSubmit={(e) => { e.preventDefault(); setSkip(0); setQuery(q); }}>
            <input placeholder="Search by medicine name or batch number" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
            <select value={status} onChange={(e) => { setSkip(0); setStatus(e.target.value); }}>
              <option value="">All statuses</option>
              {['active', 'recalled', 'quarantined', 'expired'].map((s) => <option key={s} value={s}>{statusText(s)}</option>)}
            </select>
            <button className="btn">Search</button>
          </form>
          <span className="small muted">{list.data ? `${fmt.num(list.data.total)} ${list.data.total === 1 ? 'batch' : 'batches'}` : ''}</span>
        </div>
        <Async state={list} empty={(d) => !d.items.length}>
          {(d) => (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Medicine</th><th>Made by</th><th>Made on</th><th>Expires</th><th className="num">Units made</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.items.map((b) => (
                      <tr key={b._id} className="clickable" onClick={() => setDetail(b._id)}>
                        <td><b>{b.product_name}</b><div className="id-code">{b._id}</div></td>
                        <td><EntityTag id={b.manufacturer_id} name={b.manufacturer_name} /></td>
                        <td>{fmt.date(b.manufacture_date)}</td>
                        <td>{fmt.date(b.expiry_date)} {b.is_expired ? <Badge kind="bad">Expired</Badge> : null}</td>
                        <td className="num">{fmt.num(b.quantity_produced)}</td>
                        <td><StatusBadge status={b.status} /></td>
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
      {detail ? <BatchDetail id={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

Object.assign(window, { Batches, BatchDetail });
