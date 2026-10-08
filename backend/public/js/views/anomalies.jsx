const TYPE_INFO = {
  multi_manufacturer_batch: 'More than one manufacturer claims to have produced the same batch id (cloned identifier).',
  duplicate_batch_fanin: 'The same batch reached one receiver from different senders within a short window.',
  abnormal_fanout: 'One sender shipped to far more distinct receivers in a rolling window than the network baseline.',
  reentrant_distribution: 'A receiver got the same batch repeatedly, including stock with no provenance.',
  provenance_gap: 'A sender shipped a batch it never produced or received: stock appearing from nowhere.',
};

function Evidence({ a }) {
  const d = a.details || {};
  const rows = d.shipments || (d.pairs ? d.pairs.flatMap((p) => p.shipments.map((s, i) => ({ shipment_id: s, sender: p.senders[i], dispatch_timestamp: p.timestamps[i] }))) : null);
  return (
    <details className="evidence">
      <summary>Evidence{rows ? ` (${rows.length} shipment${rows.length === 1 ? '' : 's'})` : ''}</summary>
      {a.type === 'abnormal_fanout' ? (
        <div className="small" style={{ marginTop: 6 }}>
          {d.distinct_receivers} distinct receivers between {fmt.dateTime(d.window_start)} and {fmt.dateTime(d.window_end)};
          baseline {Number(d.baseline_per_sender_day).toFixed(2)} receivers/sender/day × {d.multiplier} → threshold {Number(d.threshold).toFixed(2)}.
        </div>
      ) : null}
      {a.type === 'multi_manufacturer_batch' ? (
        <ul className="small" style={{ margin: '6px 0 0' }}>
          {d.manufacturers.map((m) => <li key={m.entity_id}><span className="mono">{m.entity_id}</span> {m.name}{m.planted ? ` — planted edge (source ${m.source})` : ''}</li>)}
        </ul>
      ) : null}
      {rows ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Shipment</th><th>Sender</th><th>Receiver</th><th>Dispatched</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.shipment_id} className={s.provenance_gap ? 'flag' : ''}>
                <td className="mono">{s.shipment_id}</td>
                <td className="mono small">{s.sender || d.sender || '—'}</td>
                <td className="mono small">{s.receiver || d.receiver || '—'}</td>
                <td className="small">{fmt.dateTime(s.dispatch_timestamp)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
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
      toast(`Detection finished in ${s.duration_ms} ms: ${s.findings} finding(s), ${s.new_findings} new`, 'ok');
      list.reload();
    } catch (e) { toast(e.message, 'bad'); } finally { setRunning(false); }
  };
  const review = async (a, newStatus) => {
    try {
      await api(`/anomalies/${encodeURIComponent(a._id)}`, { method: 'PATCH', body: { status: newStatus } });
      toast(`Marked ${fmt.type(a.type)} on ${a.batch_id} as ${newStatus}`, 'ok');
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
      <PageHead title="Anomaly findings"
        sub="Five deterministic graph-pattern heuristics run over Neo4j (rule-based, not machine learning). Findings are grouped by batch.">
        <Seg value={status} onChange={setStatus} options={[['open', 'Open'], ['reviewed', 'Reviewed'], ['dismissed', 'Dismissed'], ['', 'All']]} />
        {over ? <button className="btn primary" onClick={run} disabled={running}>{running ? <Spinner /> : null} Run detection</button> : null}
      </PageHead>
      {lastRun ? (
        <div className="note">
          Last run: <b>{lastRun.findings}</b> finding(s) in {lastRun.duration_ms} ms ·{' '}
          {Object.entries(lastRun.detector_ms).map(([k, v]) => `${fmt.type(k)} ${v} ms`).join(' · ')} · fan-out threshold {lastRun.fanout.threshold.toFixed(2)}
          {' '}(baseline {lastRun.fanout.baseline_per_sender_day.toFixed(2)}/sender/day; next-highest sender reached {lastRun.fanout.next_highest_sender_fanout}).
        </div>
      ) : null}
      <Async state={list} empty={(d) => !d.items.length}>
        {() => groups.map((g) => (
          <div key={g.batch_id} className="card anom-group">
            <div className="card-head">
              <div>
                <div className="row"><h2 className="mono">{g.batch_id}</h2><span className="muted">{g.product_name}</span></div>
                <div className="row small" style={{ marginTop: 4 }}>
                  {[...new Set(g.items.map((i) => i.type))].map((t) => <Badge key={t} kind="bad">{fmt.type(t)} ×{g.items.filter((i) => i.type === t).length}</Badge>)}
                  {g.manufacturer_id ? <span className="muted">registered by <span className="mono">{g.manufacturer_id}</span></span> : null}
                </div>
              </div>
              {over || user.entity_id === g.manufacturer_id ? <button className="btn sm" onClick={() => navigate('trace', { batch: g.batch_id })}>View trace graph</button> : null}
            </div>
            {g.items.map((a) => (
              <div key={a._id} className={`anom-item ${a.status !== 'open' ? 'dimmed' : ''}`}>
                <div>
                  <div className="row"><StatusBadge status={a.severity} /><b>{fmt.type(a.type)}</b><span className="mono small muted">{a.discriminator}</span><StatusBadge status={a.status} /></div>
                  <div style={{ marginTop: 4 }}>{a.summary}</div>
                  <div className="small muted">{TYPE_INFO[a.type]} First detected {fmt.dateTime(a.detected_at)}.{a.reviewed_by ? ` ${a.status} by ${a.reviewed_by}.` : ''}</div>
                  <Evidence a={a} />
                </div>
                {over ? (
                  <div className="row" style={{ alignSelf: 'start' }}>
                    {a.status !== 'reviewed' ? <button className="btn sm" onClick={() => review(a, 'reviewed')}>Mark reviewed</button> : null}
                    {a.status !== 'dismissed' ? <button className="btn sm" onClick={() => review(a, 'dismissed')}>Dismiss</button> : null}
                    {a.status !== 'open' ? <button className="btn sm" onClick={() => review(a, 'open')}>Reopen</button> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </Async>
      {list.data && !list.data.items.length ? <div className="card"><Empty>No {status || ''} findings.{over && status === 'open' ? ' Run detection to scan the graph.' : ''}</Empty></div> : null}
    </div>
  );
}

Object.assign(window, { Anomalies });
