const DEMO_BATCHES = ['BATCH-2025-0B0618', 'BATCH-2025-A7B41D', 'BATCH-2026-F14542', 'BATCH-2026-B64675', 'BATCH-2026-00A6CD'];

function Trace({ params }) {
  const { user } = useAuth();
  const [input, setInput] = useState(params.batch || '');
  const batch = params.batch || '';
  const [view, setView] = useState('graph');
  useEffect(() => { if (params.batch) setInput(params.batch); }, [params.batch]);
  const res = useApi(batch ? `/trace/forward/${encodeURIComponent(batch)}` : null);
  const go = (b) => navigate('trace', { batch: b.trim().toUpperCase() });

  return (
    <div className="stack">
      <PageHead title="Forward trace" sub="Where did this batch go? Every shipment, read from the Neo4j graph (FR-4)" />
      <div className="card card-pad">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (input.trim()) go(input); }}>
          <input placeholder="BATCH-2025-0B0618" value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 260 }} className="mono" />
          <button className="btn primary">Trace</button>
          {isOversight(user) || user.entity_id === 'MFG-IN-00015' ? (
            <span className="row small muted">Planted examples:
              {DEMO_BATCHES.map((b) => <button key={b} type="button" className="btn sm" onClick={() => { setInput(b); go(b); }}>{b.slice(6)}</button>)}
            </span>
          ) : null}
        </form>
      </div>
      {batch ? (
        <Async state={res}>
          {(t) => {
            const gaps = provenanceGapEdges(t.edges, t.producers);
            return (
              <div className="stack">
                <div className="grid cols-4">
                  <Stat label="Product" value={<span style={{ fontSize: 17 }}>{t.batch.product_name}</span>} hint={<span className="mono">{t.batch.batch_id}</span>} />
                  <Stat label="Shipments" value={t.edges.length} hint={`${t.recipients.length} distinct recipients`} />
                  <Stat label="Producers" value={t.producers.length} kind={t.producers.length > 1 ? 'bad' : undefined}
                    hint={t.producers.map((p) => p.entity_id + (p.planted ? ' (planted)' : '')).join(', ')} />
                  <Stat label="Graph query time" value={fmt.ms(t.query_ms)} hint={`max depth ${t.hops} hop(s); measured server-side`} />
                </div>
                {gaps.size || t.producers.length > 1 ? (
                  <div className="error-box">
                    {t.producers.length > 1 ? <div><b>Conflicting producers:</b> {t.producers.length} manufacturers claim this batch.</div> : null}
                    {gaps.size ? <div><b>{gaps.size} shipment(s) with a provenance gap</b>: their sender never received this batch (red dashed edges).</div> : null}
                  </div>
                ) : null}
                <div className="card">
                  <div className="card-head">
                    <Seg value={view} onChange={setView} options={[['graph', 'Graph'], ['table', 'Shipments'], ['recipients', 'Recipients']]} />
                    <GraphLegend />
                  </div>
                  {view === 'graph' ? (
                    <div className="graph-wrap"><TraceGraph edges={t.edges} producers={t.producers} /></div>
                  ) : view === 'table' ? (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Dispatched</th><th>Shipment</th><th>From</th><th>To</th><th className="num">Qty</th><th /></tr></thead>
                        <tbody>{t.edges.map((e) => (
                          <tr key={e.shipment_id} className={gaps.has(e.shipment_id) ? 'flag' : ''}>
                            <td className="small">{fmt.dateTime(e.dispatch_timestamp)}</td>
                            <td className="mono">{e.shipment_id}</td>
                            <td><EntityTag id={e.from.entity_id} name={e.from.name} /></td>
                            <td><EntityTag id={e.to.entity_id} name={e.to.name} /></td>
                            <td className="num">{fmt.num(e.quantity)}</td>
                            <td>{gaps.has(e.shipment_id) ? <Badge kind="bad">provenance gap</Badge> : null}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Recipient</th><th>Type</th><th>First received</th><th className="num">Shipments</th><th className="num">Units</th></tr></thead>
                        <tbody>{t.recipients.map((r) => (
                          <tr key={r.entity_id}>
                            <td><EntityTag id={r.entity_id} name={r.name} /></td><td><Badge>{r.entity_type}</Badge></td>
                            <td className="small">{fmt.dateTime(r.first_received)}</td><td className="num">{r.shipments}</td><td className="num">{fmt.num(r.quantity)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        </Async>
      ) : <div className="card"><Empty>Enter a batch id to see every entity it reached.</Empty></div>}
    </div>
  );
}

function ChainView({ chain }) {
  return (
    <div className="chain">
      {chain.path.map((e, i) => (
        <React.Fragment key={e.shipment_id}>
          {i === 0 ? (
            <div className={`hop ${chain.verified ? '' : 'broken'}`}><b>{e.from.entity_id}</b>{e.from.name}{!chain.verified ? <div className="small" style={{ color: 'var(--bad)' }}>never received it</div> : null}</div>
          ) : null}
          <div className="arrow"><div className="mono">{e.shipment_id}</div>→ {fmt.date(e.dispatch_timestamp)}</div>
          <div className="hop"><b>{e.to.entity_id}</b>{e.to.name}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

function Verify({ params }) {
  const { user } = useAuth();
  const pharmacy = user.role === 'pharmacy';
  const [batchIn, setBatchIn] = useState(params.batch || '');
  const [entityIn, setEntityIn] = useState(params.entity || (pharmacy ? user.entity_id : 'PHARM-IN-00023'));
  const batch = params.batch || '';
  const entity = pharmacy ? user.entity_id : params.entity || '';
  const [state, setState] = useState({ loading: false, data: null, error: null, notFound: null });
  useEffect(() => { if (params.batch) setBatchIn(params.batch); if (params.entity && !pharmacy) setEntityIn(params.entity); }, [params.batch, params.entity, pharmacy]);

  useEffect(() => {
    if (!batch || !entity) { setState({ loading: false, data: null, error: null, notFound: null }); return; }
    setState({ loading: true, data: null, error: null, notFound: null });
    api(`/trace/backward/${encodeURIComponent(batch)}`, { query: { entity_id: pharmacy ? undefined : entity } })
      .then((data) => setState({ loading: false, data, error: null, notFound: null }))
      .catch((e) => (e.status === 404 && e.body && e.body.verified === false
        ? setState({ loading: false, data: null, error: null, notFound: e.body })
        : setState({ loading: false, data: null, error: e, notFound: null })));
  }, [batch, entity, pharmacy]);

  const go = (b, e) => navigate('verify', { batch: b.trim().toUpperCase(), entity: pharmacy ? undefined : (e || '').trim().toUpperCase() });
  const d = state.data;
  const verdict = d || state.notFound;

  return (
    <div className="stack">
      <PageHead title="Verify authenticity" sub="Backward trace: does this stock chain back, hop by hop, to the manufacturer that produced it? (FR-4)" />
      <div className="card card-pad">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (batchIn.trim()) go(batchIn, entityIn); }}>
          <label className="field">Batch id<input className="mono" placeholder="BATCH-2025-0B0618" value={batchIn} onChange={(e) => setBatchIn(e.target.value)} style={{ width: 230 }} /></label>
          <label className="field">Held by{pharmacy
            ? <input className="mono" value={user.entity_id} disabled style={{ width: 170 }} />
            : <input className="mono" value={entityIn} onChange={(e) => setEntityIn(e.target.value)} style={{ width: 170 }} />}</label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }}>Verify</button>
        </form>
        {!pharmacy ? (
          <div className="row small muted" style={{ marginTop: 10 }}>Try:
            <button className="btn sm" onClick={() => { setBatchIn('BATCH-2025-0B0618'); setEntityIn('PHARM-IN-00023'); go('BATCH-2025-0B0618', 'PHARM-IN-00023'); }}>0B0618 @ PHARM-IN-00023</button>
            <button className="btn sm" onClick={() => { setBatchIn('BATCH-2025-0B0618'); setEntityIn('PHARM-IN-00004'); go('BATCH-2025-0B0618', 'PHARM-IN-00004'); }}>0B0618 @ PHARM-IN-00004</button>
            <button className="btn sm" onClick={() => { setBatchIn('BATCH-2026-DEAD00'); go('BATCH-2026-DEAD00', entityIn); }}>fabricated id</button>
          </div>
        ) : null}
      </div>
      {state.loading ? <Loading label="Walking the graph backwards…" /> : null}
      <ErrorBox error={state.error} />
      {verdict ? (
        <div className={`verdict ${verdict.verified ? 'ok' : 'bad'}`}>
          <div className="icon" aria-hidden="true">{verdict.verified ? '✓' : '✕'}</div>
          <div>
            <h2>{verdict.verified ? 'Verified: complete chain back to the manufacturer' : 'Not verified'}</h2>
            <div className="small muted">{batch} held by <span className="mono">{verdict.entity_id || entity}</span>{d ? ` · graph query ${fmt.ms(d.query_ms)}` : ''}</div>
            {verdict.reasons && verdict.reasons.length ? <ul>{verdict.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
          </div>
        </div>
      ) : null}
      {d && d.chains.length ? (
        <div className="card">
          <div className="card-head"><h2>Inbound chains</h2><span className="small muted">Producers: {d.producers.map((p) => `${p.entity_id}${p.planted ? ' (planted)' : ''}`).join(', ') || 'none'}</span></div>
          <div className="card-pad stack">
            {d.chains.map((c) => (
              <div key={c.shipment_id || 'self'}>
                <div className="row" style={{ marginBottom: 8 }}>
                  {c.verified ? <Badge kind="ok">complete chain</Badge> : <Badge kind="bad">broken chain</Badge>}
                  {c.shipment_id ? <span className="small muted">via <span className="mono">{c.shipment_id}</span>{c.hops ? ` · ${c.hops} hop(s)` : ''}</span> : <span className="small muted">{c.note}</span>}
                </div>
                {c.path.length ? <ChainView chain={c} /> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

Object.assign(window, { Trace, Verify });
