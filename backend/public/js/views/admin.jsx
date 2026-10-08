function SyncHealth() {
  const s = useApi('/admin/sync-health');
  useEffect(() => {
    const t = setInterval(s.reload, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="stack">
      <PageHead title="Sync health" sub="MongoDB change stream → Neo4j projection (refreshes every 5 s)">
        <button className="btn" onClick={s.reload}>Refresh</button>
      </PageHead>
      <Async state={s}>
        {(h) => (
          <div className="stack">
            <div className="grid cols-4">
              <Stat label="Sync service" value={<StatusBadge status={h.sync.status === 'running' ? 'active' : 'open'} />} hint={`${h.sync.status}; started in "${h.sync.mode}" mode`} />
              <Stat label="Events projected" value={fmt.num(h.sync.events_processed)} hint={h.sync.last_event_at ? `last change ${fmt.dateTime(h.sync.last_event_at)}` : 'no changes since start'} />
              <Stat label="Projection lag (last / avg / max)" value={h.sync.last_lag_ms === null ? '—' : `${h.sync.last_lag_ms} ms`}
                hint={h.sync.avg_lag_ms === null ? 'measured per change: Mongo commit → Neo4j write' : `avg ${h.sync.avg_lag_ms} ms · max ${h.sync.max_lag_ms} ms (target < 5000 ms)`} />
              <Stat label="Errors" value={h.sync.error_count} kind={h.sync.error_count ? 'bad' : undefined} hint={h.sync.last_error || 'none'} />
            </div>
            <div className="card">
              <div className="card-head"><h2>MongoDB vs Neo4j counts</h2>{h.all_in_sync ? <Badge kind="ok">in sync</Badge> : <Badge kind="bad">mismatch</Badge>}</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Collection / label</th><th className="num">MongoDB</th><th className="num">Neo4j</th><th /></tr></thead>
                  <tbody>{h.counts.map((c) => (
                    <tr key={c.collection}><td>{c.collection}</td><td className="num">{fmt.num(c.mongo)}</td><td className="num">{fmt.num(c.neo4j)}</td><td>{c.in_sync ? <Badge kind="ok">match</Badge> : <Badge kind="bad">differs</Badge>}</td></tr>
                  ))}
                  <tr><td>PRODUCED edges</td><td className="num muted">—</td><td className="num">{fmt.num(h.produced_edges.total)}</td><td className="small muted">{h.produced_edges.planted} planted · {h.produced_edges.note}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="note">Open Neo4j Browser at <a href="http://localhost:7474" target="_blank" rel="noreferrer">localhost:7474</a> to see the graph. Example: <code>MATCH p=(:Batch {'{'}batch_id:'BATCH-2025-A7B41D'{'}'})-[:PART_OF]-&gt;(:Shipment)-[:FROM|TO]-&gt;() RETURN p</code></div>
          </div>
        )}
      </Async>
    </div>
  );
}

function Users() {
  const toast = useToast();
  const { user: me } = useAuth();
  const list = useApi('/admin/users');
  const entities = useEntities(null);
  const [f, setF] = useState({ username: '', password: '', role: 'pharmacy', entity_id: '', display_name: '' });
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const needsEntity = !['admin', 'regulator'].includes(f.role);

  const create = async (e) => {
    e.preventDefault(); setError(null);
    try {
      await api('/admin/users', { method: 'POST', body: { ...f, entity_id: needsEntity ? f.entity_id : undefined } });
      toast(`Created user ${f.username}`, 'ok');
      setF({ username: '', password: '', role: 'pharmacy', entity_id: '', display_name: '' }); setOpen(false); list.reload();
    } catch (err) { setError(err); }
  };
  const remove = async (u) => {
    if (!window.confirm(`Delete user ${u.username}?`)) return;
    try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); toast(`Deleted ${u.username}`, 'ok'); list.reload(); } catch (err) { toast(err.message, 'bad'); }
  };

  return (
    <div className="stack">
      <PageHead title="Users" sub="Accounts and their role / entity binding (passwords are bcrypt-hashed)">
        <button className="btn primary" onClick={() => setOpen(true)}>+ New user</button>
      </PageHead>
      <div className="card">
        <Async state={list}>
          {(d) => (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Username</th><th>Display name</th><th>Role</th><th>Entity</th><th /></tr></thead>
                <tbody>{d.items.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.username}</td><td>{u.display_name}</td><td><Badge kind="brand">{u.role}</Badge></td>
                    <td className="mono small">{u.entity_id || '—'}</td>
                    <td>{u.id !== me.id ? <button className="btn sm" onClick={() => remove(u)}>Delete</button> : <span className="small muted">you</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Async>
      </div>
      {open ? (
        <Modal title="New user" onClose={() => setOpen(false)}>
          <form className="form-grid" onSubmit={create}>
            <label className="field">Username<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></label>
            <label className="field">Password (min 8)<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} /></label>
            <label className="field">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, entity_id: '' })}>
              {Object.keys(ROLE_LABEL).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
            <label className="field">Entity{needsEntity ? '' : ' (n/a)'}
              <select value={f.entity_id} disabled={!needsEntity} onChange={(e) => setF({ ...f, entity_id: e.target.value })} required={needsEntity}>
                <option value="">Select…</option>
                {(entities || []).filter((x) => x.entity_type === f.role).map((x) => <option key={x._id} value={x._id}>{x._id} · {x.name}</option>)}
              </select></label>
            <label className="field full">Display name<input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
            {error ? <div className="full"><ErrorBox error={error} /></div> : null}
            <div className="full row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary">Create</button></div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function Audit() {
  const [skip, setSkip] = useState(0);
  const [username, setUsername] = useState('');
  const list = useApi('/admin/audit', { query: { skip, limit: 50, username: username || undefined } });
  return (
    <div className="stack">
      <PageHead title="Audit log" sub="Append-only record of every mutating request, including rejected ones (FR-10). There is no API to edit or delete it." />
      <div className="card">
        <div className="card-head">
          <input placeholder="Filter by username" value={username} onChange={(e) => { setSkip(0); setUsername(e.target.value.trim()); }} style={{ width: 220 }} />
          <span className="small muted">{list.data ? `${fmt.num(list.data.total)} entr${list.data.total === 1 ? 'y' : 'ies'}` : ''}</span>
        </div>
        <Async state={list} empty={(d) => !d.items.length}>
          {(d) => (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Resource</th><th>Result</th><th>Details</th></tr></thead>
                  <tbody>{d.items.map((a) => (
                    <tr key={a._id}>
                      <td className="small">{fmt.dateTime(a.ts)}</td>
                      <td><span className="mono small">{a.username || '—'}</span><div className="small muted">{a.role}{a.entity_id ? ` · ${a.entity_id}` : ''}</div></td>
                      <td className="mono small">{a.action}</td>
                      <td className="mono small">{a.resource_id || '—'}</td>
                      <td><Badge kind={a.status_code < 300 ? 'ok' : a.status_code < 500 ? 'warn' : 'bad'}>{a.status_code}</Badge></td>
                      <td className="small mono muted" style={{ maxWidth: 320, wordBreak: 'break-word' }}>{a.details && a.details.body ? JSON.stringify(a.details.body).slice(0, 140) : ''}</td>
                    </tr>
                  ))}</tbody>
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

Object.assign(window, { SyncHealth, Users, Audit });
