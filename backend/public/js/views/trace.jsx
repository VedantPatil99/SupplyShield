// Network map (visual tracking of one batch) and "Check if genuine" (backward verification).

/** Batches worth opening for this user: recalled or flagged ones first. */
function useQuickPicks(user) {
  const [picks, setPicks] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = new Map();
      const add = (id, tag, kind, product) => { if (id && !out.has(id)) out.set(id, { batch_id: id, tag, kind, product }); };
      try {
        if (isOversight(user) || user.role === 'manufacturer') {
          const [rec, an] = await Promise.all([api('/recalls', { query: { status: 'in_progress' } }), api('/anomalies', { query: { status: 'open' } })]);
          an.items.forEach((a) => add(a.batch_id, 'Suspicious', 'bad', a.product_name));
          rec.items.forEach((r) => r.batch_ids.forEach((b) => add(b, 'Recall', 'warn')));
          if (user.role === 'manufacturer') (await api('/batches', { query: { limit: 6 } })).items.forEach((b) => add(b._id, 'My batch', '', b.product_name));
        } else {
          const inv = await api('/inventory', { query: { limit: 300 } });
          inv.items.filter((i) => i.active_recall).forEach((i) => add(i.batch_id, 'Recall', 'warn', i.product_name));
          inv.items.filter((i) => i.quantity_on_hand > 0).forEach((i) => add(i.batch_id, 'In my stock', '', i.product_name));
          inv.items.forEach((i) => add(i.batch_id, 'Handled', '', i.product_name));
        }
      } catch (e) { /* quick picks are optional */ }
      if (alive) setPicks([...out.values()].slice(0, isOversight(user) ? 10 : 6));
    })();
    return () => { alive = false; };
  }, [user]);
  return picks;
}

function CompanyPanel({ m, id, onClose }) {
  const { user } = useAuth();
  const inbound = m.edges.filter((e) => e.to.entity_id === id);
  const outbound = m.edges.filter((e) => e.from.entity_id === id);
  const ent = (inbound[0] && inbound[0].to) || (outbound[0] && outbound[0].from)
    || (m.producers.find((p) => p.entity_id === id) && { entity_id: id, name: m.producers.find((p) => p.entity_id === id).name, entity_type: 'manufacturer' })
    || { entity_id: id };
  const producer = m.producers.find((p) => p.entity_id === id);
  const realMaker = m.producers.find((p) => !p.planted);
  const gaps = provenanceGapEdges(m.edges, m.producers);
  const shippedWithoutSource = outbound.some((e) => gaps.has(e.shipment_id));
  const recallStatus = m.recall && m.recall.statuses[id];
  const held = m.holdings[id];
  const problems = m.anomalies.filter((a) => a.discriminator.split(',').includes(id));
  const canVerify = ent.entity_type !== 'manufacturer' && (isOversight(user) || (user.role === 'pharmacy' && user.entity_id === id));

  return (
    <div className="card" style={{ position: 'sticky', top: 76 }}>
      <div className="card-head">
        <EntityTag id={ent.entity_id} name={ent.name} type={ent.entity_type} />
        <button className="btn ghost sm" onClick={onClose} aria-label="Close details">✕</button>
      </div>
      <div className="card-pad stack" style={{ gap: 14 }}>
        {producer && !producer.planted ? <div className="note">This company is the <b>registered maker</b> of this batch.</div> : null}
        {producer && producer.planted ? (
          <div className="error-box">⚠ <b>Claims to have made this batch</b>, but the registered maker is {realMaker ? realMaker.name : 'another company'}.</div>
        ) : null}
        {shippedWithoutSource ? <div className="error-box">⚠ <b>Shipped this batch without ever receiving it.</b> Where did this stock come from?</div> : null}
        {problems.filter((p) => p.type !== 'provenance_gap' && p.type !== 'multi_manufacturer_batch').map((p) => (
          <div key={p.type} className="error-box">⚠ <b>{CHECK_TEXT[p.type].title}.</b> {CHECK_TEXT[p.type].meaning}</div>
        ))}
        {recallStatus ? (
          <div><div className="small muted">Recall response</div><div className="row" style={{ marginTop: 2 }}><StatusBadge status={recallStatus} /></div></div>
        ) : null}
        {held !== undefined ? (
          <div><div className="small muted">Holds right now</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt.num(held)} units</div></div>
        ) : null}
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>Received this batch from</div>
          {inbound.length ? inbound.map((e) => (
            <div key={e.shipment_id} className="small" style={{ padding: '4px 0' }}>
              <b>{e.from.name || e.from.entity_id}</b> · {fmt.num(e.quantity)} units · {fmt.date(e.dispatch_timestamp)}
              {gaps.has(e.shipment_id) ? <div style={{ color: 'var(--bad)' }}>⚠ sender never received this batch</div> : null}
            </div>
          )) : <div className="small muted">{producer ? 'Nobody (it made the batch)' : 'No deliveries recorded'}</div>}
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>Sent this batch to</div>
          {outbound.length ? outbound.map((e) => (
            <div key={e.shipment_id} className="small" style={{ padding: '4px 0' }}>
              <b>{e.to.name || e.to.entity_id}</b> · {fmt.num(e.quantity)} units · {fmt.date(e.dispatch_timestamp)}
            </div>
          )) : <div className="small muted">Nobody yet</div>}
        </div>
        {canVerify ? <button className="btn" onClick={() => navigate('verify', { batch: m.batch._id, entity: id })}>Check if this stock is genuine →</button> : null}
      </div>
    </div>
  );
}

function MapSummary({ m }) {
  const gaps = provenanceGapEdges(m.edges, m.producers);
  const companies = new Set(m.edges.flatMap((e) => [e.from.entity_id, e.to.entity_id]));
  const realMakers = m.producers.filter((p) => !p.planted);
  const warnings = [];
  if (m.producers.length > 1) warnings.push(<><b>Two makers claim this batch</b> ({m.producers.map((p) => p.name).join(' and ')}). Each batch number should belong to one maker.</>);
  if (gaps.size) warnings.push(<><b>{gaps.size} {gaps.size === 1 ? 'delivery came' : 'deliveries came'} from a company that never received this batch</b> (red dashed lines). That stock has no traceable source.</>);
  if (m.batch.is_expired) warnings.push(<><b>This batch is past its expiry date</b> ({fmt.date(m.batch.expiry_date)}).</>);
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10 }}>
        <h2 style={{ fontSize: 20 }}>{m.batch.product_name}</h2>
        <span className="id-code" style={{ fontSize: 13 }}>{m.batch._id}</span>
        <StatusBadge status={m.batch.status} />
      </div>
      <p className="big-answer" style={{ margin: 0 }}>
        Made by <b>{realMakers.map((p) => p.name).join(', ') || 'an unknown maker'}</b> on {fmt.date(m.batch.manufacture_date)}.{' '}
        {m.view === 'full'
          ? <>It passed through <b>{companies.size} companies</b> in <b>{m.edges.length} deliveries</b>.</>
          : <>You are seeing <b>your part</b> of its journey: where your stock came from and where you sent it.</>}
      </p>
      {m.recall && m.recall.status === 'in_progress' ? (
        <div className="note" style={{ background: 'var(--warn-soft)', borderColor: 'color-mix(in srgb, var(--warn) 30%, transparent)' }}>
          <b>Recall in progress</b> ({m.recall.recall_class}): {m.recall.reason}. <b>{m.recall.returned} of {m.recall.total}</b> companies have returned their stock.
          The coloured dot on each company shows how it has responded.
        </div>
      ) : null}
      {warnings.length ? (
        <div className="error-box"><ul style={{ margin: 0, paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      ) : (
        <div className="note" style={{ background: 'var(--ok-soft)', borderColor: 'color-mix(in srgb, var(--ok) 30%, transparent)' }}>
          ✓ No problems found: every delivery on this map traces back to the registered maker.
        </div>
      )}
    </div>
  );
}

function NetworkMap({ params }) {
  const { user } = useAuth();
  const [input, setInput] = useState(params.batch || '');
  const batch = params.batch || '';
  const picks = useQuickPicks(user);
  const res = useApi(batch ? `/trace/map/${encodeURIComponent(batch)}` : null);
  const [selected, setSelected] = useState(null);
  useEffect(() => { if (params.batch) setInput(params.batch); setSelected(null); }, [params.batch]);
  useEffect(() => {
    // Companies start focused on themselves.
    if (res.data && !selected && user.entity_id && res.data.edges.some((e) => e.to.entity_id === user.entity_id || e.from.entity_id === user.entity_id)) {
      setSelected(user.entity_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.data]);
  const go = (b) => navigate('map', { batch: b.trim().toUpperCase() });
  const m = res.data;
  const highlight = useMemo(() => (m && selected ? pathOf(m.edges, selected) : new Set()), [m, selected]);

  return (
    <div className="stack">
      <PageHead title="Network map" help="map"
        sub="See every company a batch passed through, who still holds it, and where something looks wrong." />
      <div className="card card-pad stack" style={{ gap: 12 }}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (input.trim()) go(input); }}>
          <label className="field" style={{ flex: '0 1 320px' }}>Batch number (printed on the pack)
            <input className="mono" placeholder="e.g. BATCH-2025-0B0618" value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }}>Show map</button>
        </form>
        {picks && picks.length ? (
          <div className="row small" style={{ gap: 6 }}>
            <span className="muted">Worth a look:</span>
            {picks.map((p) => (
              <button key={p.batch_id} type="button" className="btn sm" onClick={() => go(p.batch_id)} title={p.product || p.batch_id}>
                {p.product ? `${p.product.split(' ').slice(0, 2).join(' ')} · ` : ''}<span className="mono">{p.batch_id.slice(6)}</span>
                {p.kind ? <Badge kind={p.kind}>{p.tag}</Badge> : <span className="muted">{p.tag}</span>}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {batch ? (
        <Async state={res}>
          {() => (
            <div className="stack">
              <MapSummary m={m} />
              <div className={`map-layout ${selected ? 'has-panel' : ''}`}>
                <div className="card">
                  <div className="card-head">
                    <span className="small muted">Click a company to see its part in this batch's journey.{selected ? ' Its path is highlighted.' : ''}</span>
                    <GraphLegend withRecall={!!(m.recall && m.recall.status === 'in_progress')} />
                  </div>
                  <div className="graph-wrap">
                    <TraceGraph edges={m.edges} producers={m.producers} highlight={highlight} selected={selected}
                      focus={user.entity_id} onSelect={(id) => setSelected(id === selected ? null : id)}
                      nodeStatus={m.recall && m.recall.status === 'in_progress' ? m.recall.statuses : null} />
                  </div>
                </div>
                {selected ? <CompanyPanel m={m} id={selected} onClose={() => setSelected(null)} /> : null}
              </div>
            </div>
          )}
        </Async>
      ) : (
        <div className="card"><Empty>Enter a batch number above, or pick one of the suggestions, to see its map.</Empty></div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function ChainView({ chain }) {
  return (
    <div className="chain">
      {chain.path.map((e, i) => (
        <React.Fragment key={e.shipment_id}>
          {i === 0 ? (
            <div className={`hop ${chain.verified ? '' : 'broken'}`}>
              <b style={{ fontFamily: 'inherit', fontSize: 13 }}>{e.from.name || e.from.entity_id}</b>
              <span className="id-code">{e.from.entity_id}</span>
              {!chain.verified ? <div className="small" style={{ color: 'var(--bad)' }}>never received it</div> : <div className="small" style={{ color: 'var(--ok)' }}>made it</div>}
            </div>
          ) : null}
          <div className="arrow">→<div>{fmt.date(e.dispatch_timestamp)}</div></div>
          <div className="hop"><b style={{ fontFamily: 'inherit', fontSize: 13 }}>{e.to.name || e.to.entity_id}</b><span className="id-code">{e.to.entity_id}</span></div>
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
  const maker = d && d.producers.find((p) => !p.planted);
  const goodChain = d && d.chains.find((c) => c.verified && c.path.length);

  return (
    <div className="stack">
      <PageHead title="Check if genuine" help="verify" sub="Enter the batch number from a pack to confirm it really came from its manufacturer." />
      <div className="card card-pad">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (batchIn.trim()) go(batchIn, entityIn); }}>
          <label className="field">Batch number<input className="mono" placeholder="e.g. BATCH-2025-0B0618" value={batchIn} onChange={(e) => setBatchIn(e.target.value)} style={{ width: 240 }} /></label>
          <label className="field">{pharmacy ? 'Stock held by (you)' : 'Stock held by (company ID)'}{pharmacy
            ? <input className="mono" value={user.entity_id} disabled style={{ width: 180 }} />
            : <input className="mono" value={entityIn} onChange={(e) => setEntityIn(e.target.value)} style={{ width: 180 }} />}</label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }}>Check</button>
        </form>
        {!pharmacy ? (
          <div className="row small muted" style={{ marginTop: 10 }}>Examples:
            <button className="btn sm" onClick={() => go('BATCH-2025-0B0618', 'PHARM-IN-00023')}>Genuine stock</button>
            <button className="btn sm" onClick={() => go('BATCH-2025-0B0618', 'PHARM-IN-00004')}>Same batch, suspicious stock</button>
            <button className="btn sm" onClick={() => go('BATCH-2026-DEAD00', entityIn || 'PHARM-IN-00023')}>Made-up batch number</button>
          </div>
        ) : null}
      </div>
      {state.loading ? <Loading label="Following the delivery records back to the manufacturer…" /> : null}
      <ErrorBox error={state.error} />
      {verdict ? (
        <div className={`verdict ${verdict.verified ? 'ok' : 'bad'}`}>
          <div className="icon" aria-hidden="true">{verdict.verified ? '✓' : '!'}</div>
          <div className="big-answer">
            <h2>{verdict.verified ? 'Genuine' : state.notFound ? 'Unknown batch number' : 'Could not confirm this stock is genuine'}</h2>
            {verdict.verified && goodChain ? (
              <div>This stock traces back to <b>{maker ? maker.name : 'its manufacturer'}</b> in <b>{goodChain.hops} {goodChain.hops === 1 ? 'step' : 'steps'}</b>, with every delivery on record.</div>
            ) : null}
            {verdict.verified && !goodChain ? <div>This company is the registered maker of the batch.</div> : null}
            {state.notFound ? <div>No manufacturer has ever registered <b className="mono">{batch}</b>. Packs with this number may be counterfeit: do not sell them, and report them.</div> : null}
            {d && !d.verified ? (
              <>
                <div>Do not sell this stock until it has been investigated. What we found:</div>
                <ul>{d.reasons.map((r) => <li key={r}>{plainReason(r, d)}</li>)}</ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {d && d.chains.length && d.chains[0].path.length ? (
        <div className="card">
          <div className="card-head"><h2>How this stock got here</h2><span className="small muted">Each box is a company; arrows are deliveries with their dates.</span></div>
          <div className="card-pad stack">
            {d.chains.map((c) => (
              <div key={c.shipment_id || 'self'}>
                <div className="row" style={{ marginBottom: 8 }}>
                  {c.verified ? <Badge kind="ok">Complete path to the maker</Badge> : <Badge kind="bad">Path breaks: source unknown</Badge>}
                </div>
                <ChainView chain={c} />
              </div>
            ))}
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('map', { batch })}>See this batch on the network map →</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Turn the server's technical reasons into plain sentences. */
function plainReason(r, d) {
  const m = r.match(/breaks at (\S+) \(([^)]*)\)/);
  if (m) return <>One delivery came from <b>{m[2] || m[1]}</b>, which never received this batch itself, so we can't tell where that stock came from.</>;
  if (/manufacturers claim/.test(r)) return <><b>{d.producers.length} different manufacturers</b> claim to have made this batch ({d.producers.map((p) => p.name).join(' and ')}). A batch number should belong to one maker.</>;
  if (/no recorded inbound shipment/.test(r)) return <>There is no record of this batch ever being delivered to <b>{d.entity_id}</b>.</>;
  if (/No manufacturer is recorded/.test(r)) return <>No manufacturer is recorded for this batch.</>;
  return r;
}

Object.assign(window, { NetworkMap, Verify });
