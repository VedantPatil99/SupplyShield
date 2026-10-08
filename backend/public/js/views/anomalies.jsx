function Evidence({ a }) {
  const d = a.details || {};
  const rows = d.shipments || (d.pairs ? d.pairs.flatMap((p) => p.shipments.map((s, i) => ({ shipment_id: s, sender: p.senders[i], dispatch_timestamp: p.timestamps[i] }))) : null);
  return (
    <details className="evidence">
      <summary>Show the evidence{rows ? ` (${rows.length} ${rows.length === 1 ? 'delivery' : 'deliveries'})` : ''}</summary>
      {a.type === 'abnormal_fanout' ? (
        <div className="small" style={{ marginTop: 6 }}>
          {d.distinct_receivers} different buyers between {fmt.dateTime(d.window_start)} and {fmt.dateTime(d.window_end)}.
          A typical company ships to {Number(d.baseline_per_sender_day).toFixed(1)} buyers a day; this check flags anything above {Number(d.threshold).toFixed(0)} in {d.window_hours} hours.
        </div>
      ) : null}
      {a.type === 'multi_manufacturer_batch' ? (
        <ul className="small" style={{ margin: '6px 0 0' }}>
          {d.manufacturers.map((m) => <li key={m.entity_id}><b>{m.name}</b> <span className="id-code">{m.entity_id}</span>{m.planted ? ': not the registered maker' : ': registered maker'}</li>)}
        </ul>
      ) : null}
      {rows ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Delivery</th><th>From</th><th>To</th><th>Date</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.shipment_id} className={s.provenance_gap ? 'flag' : ''}>
                <td className="mono small">{s.shipment_id}</td>
                <td className="mono small">{s.sender || d.sender || '—'}</td>
                <td className="mono small">{s.receiver || d.receiver || '—'}</td>
                <td className="small">{fmt.dateTime(s.dispatch_timestamp)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      <div className="small muted" style={{ marginTop: 6 }}>Technical name: <Tech>{CHECK_TEXT[a.type].tech}</Tech></div>
    </details>
  );
}

function Anomalies() {
  const { user } = useAuth();
  const toast = useToast();
  const over = isOversight(user);
  const [status, setStatus] = useState('open');
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const list = useApi('/anomalies', { query: { status: status || undefined } });

  const run = async () => {
    setRunning(true);
    try {
      const s = await api('/anomalies/run', { method: 'POST' });
      setLastRun(s);
      toast(`Checks finished in ${(s.duration_ms / 1000).toFixed(1)} s: ${s.findings} finding(s), ${s.new_findings} new`, 'ok');
      list.reload();
    } catch (e) { toast(e.message, 'bad'); } finally { setRunning(false); }
  };
  const review = async (a, newStatus) => {
    try {
      await api(`/anomalies/${encodeURIComponent(a._id)}`, { method: 'PATCH', body: { status: newStatus } });
      toast(`"${CHECK_TEXT[a.type].title}" marked as ${statusText(newStatus).toLowerCase()}`, 'ok');
      list.reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const groups = useMemo(() => {
    if (!list.data) return [];
    const m = new Map();
    for (const a of list.data.items) {
      if (!m.has(a.batch_id)) m.set(a.batch_id, { batch_id: a.batch_id, product_name: a.product_name, manufacturer_id: a.manufacturer_id, items: [] });
      m.get(a.batch_id).items.push(a);
    }
    const sev = { high: 0, medium: 1, low: 2 };
    return [...m.values()].sort((x, y) => Math.min(...x.items.map((i) => sev[i.severity])) - Math.min(...y.items.map((i) => sev[i.severity])) || y.items.length - x.items.length);
  }, [list.data]);

  return (
    <div className="stack">
      <PageHead title="Suspicious activity" help="anomalies"
        sub={over ? 'Batches where the delivery records look wrong, grouped by batch.' : 'Warnings about batches you made.'}>
        <Seg value={status} onChange={setStatus} options={[['open', 'Needs review'], ['reviewed', 'Reviewed'], ['dismissed', 'Dismissed'], ['', 'All']]} />
        {over ? <button className="btn primary" onClick={run} disabled={running}>{running ? <Spinner /> : null} Run the checks now</button> : null}
      </PageHead>
      {lastRun ? (
        <div className="note">
          Checked all delivery records in {(lastRun.duration_ms / 1000).toFixed(1)} s and found <b>{lastRun.findings}</b> {lastRun.findings === 1 ? 'problem' : 'problems'}
          {lastRun.new_findings ? <> (<b>{lastRun.new_findings} new</b>)</> : ' (nothing new)'}.
        </div>
      ) : null}
      {list.data && groups.length ? (
        <div className="small muted">{groups.length} {groups.length === 1 ? 'batch' : 'batches'} with findings. Each finding is a warning to investigate, not proof of wrongdoing.</div>
      ) : null}
      <Async state={list}>
        {() => groups.map((g) => (
          <div key={g.batch_id} className="card anom-group">
            <div className="card-head">
              <div>
                <div className="row"><h2>{g.product_name}</h2><span className="id-code" style={{ fontSize: 13 }}>{g.batch_id}</span></div>
                <div className="small muted" style={{ marginTop: 2 }}>{g.items.length} {g.items.length === 1 ? 'finding' : 'findings'} on this batch</div>
              </div>
              <button className="btn sm" onClick={() => navigate('map', { batch: g.batch_id })}>See it on the network map →</button>
            </div>
            {g.items.map((a) => {
              const t = CHECK_TEXT[a.type];
              return (
                <div key={a._id} className={`anom-item ${a.status !== 'open' ? 'dimmed' : ''}`}>
                  <div>
                    <div className="row"><StatusBadge status={a.severity} /><b style={{ fontSize: 15.5 }}>{t.title}</b>{a.status !== 'open' ? <StatusBadge status={a.status} /> : null}</div>
                    <div style={{ marginTop: 4 }}>{a.summary}.</div>
                    <div className="small muted" style={{ marginTop: 2 }}><b>Why it matters:</b> {t.why}</div>
                    {a.reviewed_by ? <div className="small muted">{statusText(a.status)} by {a.reviewed_by} on {fmt.date(a.reviewed_at)}.</div> : null}
                    <Evidence a={a} />
                  </div>
                  {over ? (
                    <div className="row" style={{ alignSelf: 'start' }}>
                      {a.status !== 'reviewed' ? <button className="btn sm" onClick={() => review(a, 'reviewed')} title="You looked into it">Mark reviewed</button> : null}
                      {a.status !== 'dismissed' ? <button className="btn sm" onClick={() => review(a, 'dismissed')} title="You checked and it is fine">Not a problem</button> : null}
                      {a.status !== 'open' ? <button className="btn sm" onClick={() => review(a, 'open')}>Reopen</button> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </Async>
      {list.data && !list.data.items.length ? (
        <div className="card"><Empty>✓ Nothing {status === 'open' ? 'needs review' : `marked ${statusText(status).toLowerCase()}`}.{over && status === 'open' ? ' Press "Run the checks now" to scan again.' : ''}</Empty></div>
      ) : null}
    </div>
  );
}

Object.assign(window, { Anomalies });
