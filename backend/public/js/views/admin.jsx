function SyncHealth() {
  const s = useApi('/admin/sync-health');
  useEffect(() => {
    const t = setInterval(s.reload, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="stack">
      <PageHead title="System status" help="sync" sub="Updates every 5 seconds.">
        <button className="btn" onClick={s.reload}>Refresh</button>
      </PageHead>
      <Async state={s}>
        {(h) => (
          <div className="stack">
            <div className="grid cols-4">
              <Stat label="Copying between databases" value={h.sync.status === 'running' ? <Badge kind="ok">Running</Badge> : <Badge kind="bad">Stopped</Badge>} hint={<>MongoDB → Neo4j · <Tech>change-stream sync</Tech></>} />
              <Stat label="Changes copied" value={fmt.num(h.sync.events_processed)} hint={h.sync.last_event_at ? `last one ${fmt.dateTime(h.sync.last_event_at)}` : 'no changes yet'} />
              <Stat label="Copy delay (last change)" value={h.sync.last_lag_ms === null ? '—' : `${h.sync.last_lag_ms} ms`}
                hint={h.sync.avg_lag_ms === null ? 'time from saving to appearing on the map' : `average ${h.sync.avg_lag_ms} ms, slowest ${h.sync.max_lag_ms} ms (goal: under 5 s)`} />
              <Stat label="Copy errors" value={h.sync.error_count} kind={h.sync.error_count ? 'bad' : undefined} hint={h.sync.last_error || 'none'} />
            </div>
            <div className="card">
              <div className="card-head"><h2>Do both databases hold the same records?</h2>{h.all_in_sync ? <Badge kind="ok">Yes, they match</Badge> : <Badge kind="bad">No: counts differ</Badge>}</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Records</th><th className="num">Main database (MongoDB)</th><th className="num">Network map (Neo4j)</th><th /></tr></thead>
                  <tbody>{h.counts.map((c) => (
                    <tr key={c.collection}><td>{{ entities: 'Companies', batches: 'Batches', shipments: 'Deliveries', recalls: 'Recalls' }[c.collection] || c.collection}</td><td className="num">{fmt.num(c.mongo)}</td><td className="num">{fmt.num(c.neo4j)}</td><td>{c.in_sync ? <Badge kind="ok">Match</Badge> : <Badge kind="bad">Differ</Badge>}</td></tr>
                  ))}
                  <tr><td>"Made by" links</td><td className="num muted">—</td><td className="num">{fmt.num(h.produced_edges.total)}</td><td className="small muted">One more than batches: the demo includes {h.produced_edges.planted} fake "made by" claim on purpose.</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="note">To see the raw network map, open Neo4j Browser at <a href="http://localhost:7474" target="_blank" rel="noreferrer">localhost:7474</a> to see the graph. Example: <code>MATCH p=(:Batch {'{'}batch_id:'BATCH-2025-A7B41D'{'}'})-[:PART_OF]-&gt;(:Shipment)-[:FROM|TO]-&gt;() RETURN p</code></div>
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
      <PageHead title="Users" help="users" sub="Who can sign in, and as which company. Passwords are stored encrypted.">
        <button className="btn primary" onClick={() => setOpen(true)}>+ New user</button>
      </PageHead>
      <div className="card">
        <Async state={list}>
          {(d) => (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Company</th><th /></tr></thead>
                <tbody>{d.items.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.username}</td><td>{u.display_name}</td><td><Badge kind="brand">{ROLE_INFO[u.role].title}</Badge></td>
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
              {Object.keys(ROLE_INFO).map((r) => <option key={r} value={r}>{ROLE_INFO[r].title}</option>)}</select></label>
            <label className="field">Company{needsEntity ? '' : ' (not needed for this role)'}
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

/** One activity-log entry as a sentence. */
function describeAction(a) {
  const [method, path = ''] = a.action.split(' ');
  const b = (a.details && a.details.body) || {};
  const p = path.replace(/^\/api\//, '');
  if (p === 'auth/login') return a.status_code < 300 ? 'Signed in' : 'Tried to sign in';
  if (p === 'batches' && method === 'POST') return <>Registered batch <span className="mono">{a.resource_id && a.resource_id.startsWith('BATCH') ? a.resource_id : ''}</span> {b.product_name ? `(${b.product_name})` : ''}</>;
  if (p === 'shipments' && method === 'POST') return <>Sent {b.quantity ? `${fmt.num(b.quantity)} units of ` : ''}<span className="mono">{b.batch_id}</span> to <span className="mono">{b.to_entity_id}</span></>;
  if (/^shipments\/[^/]+\/receive$/.test(p)) return <>Confirmed a delivery arrived (<span className="mono">{a.resource_id}</span>)</>;
  if (p === 'recalls/preview') return 'Looked up who would be affected by a recall';
  if (p === 'recalls' && method === 'POST') return <>Started a recall of <span className="mono">{(b.batch_ids || []).join(', ')}</span></>;
  if (/^recalls\/[^/]+\/entities\//.test(p)) return <>Updated a recall response to "{statusText(b.status)}"</>;
  if (p === 'anomalies/run') return 'Ran the suspicious-activity checks';
  if (/^anomalies\//.test(p)) return <>Marked a suspicious finding as "{statusText(b.status)}"</>;
  if (p === 'admin/users' && method === 'POST') return <>Created user <span className="mono">{b.username}</span></>;
  if (/^admin\/users\//.test(p)) return method === 'DELETE' ? 'Deleted a user' : 'Changed a user';
  return a.action;
}

function Audit() {
  const [skip, setSkip] = useState(0);
  const [username, setUsername] = useState('');
  const list = useApi('/admin/audit', { query: { skip, limit: 50, username: username || undefined } });
  return (
    <div className="stack">
      <PageHead title="Activity log" help="audit" sub="Newest first." />
      <div className="card">
        <div className="card-head">
          <input placeholder="Filter by username" value={username} onChange={(e) => { setSkip(0); setUsername(e.target.value.trim()); }} style={{ width: 220 }} />
          <span className="small muted">{list.data ? `${fmt.num(list.data.total)} ${list.data.total === 1 ? 'entry' : 'entries'}` : ''}</span>
        </div>
        <Async state={list} empty={(d) => !d.items.length}>
          {(d) => (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>When</th><th>Who</th><th>What they did</th><th>Result</th><th>Details</th></tr></thead>
                  <tbody>{d.items.map((a) => (
                    <tr key={a._id}>
                      <td className="small">{fmt.dateTime(a.ts)}</td>
                      <td><span className="mono small">{a.username || '—'}</span><div className="small muted">{a.role}{a.entity_id ? ` · ${a.entity_id}` : ''}</div></td>
                      <td>{describeAction(a)}<div className="tech">{a.action}</div></td>
                      <td><Badge kind={a.status_code < 300 ? 'ok' : a.status_code < 500 ? 'warn' : 'bad'}>{a.status_code < 300 ? 'Done' : a.status_code === 403 ? 'Refused: not allowed' : a.status_code === 401 ? 'Refused: not signed in' : a.status_code < 500 ? 'Rejected' : 'Error'}</Badge></td>
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
