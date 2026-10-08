// Home: who you are, where you sit in the supply chain, what needs attention, and what you can do.

const TASKS = {
  manufacturer: [
    ['batches', { new: 1 }, 'Register a new batch', 'Record a production run so it can be tracked from day one.'],
    ['shipments', { new: 1 }, 'Send stock to a distributor', 'The distributor confirms when it arrives.'],
    ['map', null, 'See where your batches went', 'A map of every company that received them.'],
    ['recalls', null, 'Recall a batch', 'Everyone who received it is notified automatically.'],
  ],
  distributor: [
    ['shipments', null, 'Confirm deliveries you received', 'Stock is added to your inventory when you confirm.'],
    ['shipments', { new: 1 }, 'Send stock to a wholesaler', ''],
    ['recalls', null, 'Respond to recalls', 'Mark recalled stock as seen, set aside, then returned.'],
    ['map', null, 'Trace a batch you handled', 'See where your stock came from and where it went.'],
  ],
  wholesaler: [
    ['shipments', null, 'Confirm deliveries you received', 'Stock is added to your inventory when you confirm.'],
    ['shipments', { new: 1 }, 'Send stock to a pharmacy', ''],
    ['recalls', null, 'Respond to recalls', 'Mark recalled stock as seen, set aside, then returned.'],
    ['map', null, 'Trace a batch you handled', 'See where your stock came from and where it went.'],
  ],
  pharmacy: [
    ['verify', null, 'Check a pack is genuine', 'Type the batch number from the box.'],
    ['shipments', null, 'Confirm deliveries you received', ''],
    ['recalls', null, 'Respond to recalls', 'Take unsafe stock off the shelf and return it.'],
    ['map', null, 'See where your stock came from', ''],
  ],
  regulator: [
    ['anomalies', null, 'Review suspicious activity', 'Findings from the automatic checks, grouped by batch.'],
    ['map', null, 'Open the network map for any batch', 'See every company it passed through.'],
    ['verify', null, 'Check a pack is genuine', 'At any pharmacy or company.'],
    ['recalls', null, 'Follow recalls', 'See which companies have not responded yet.'],
    ['audit', null, 'Read the activity log', 'Who changed what, and when.'],
  ],
  admin: [
    ['sync', null, 'Check the system is healthy', 'Both databases in step, copy speed.'],
    ['anomalies', null, 'Run the suspicious-activity checks', ''],
    ['users', null, 'Manage user accounts', ''],
    ['audit', null, 'Read the activity log', ''],
  ],
};

function ChainStrip({ you }) {
  return (
    <div className="chain-strip" aria-label="The supply chain">
      {Object.entries(TIER_TEXT).map(([k, t]) => (
        <div key={k} className={`tier ${k === you ? 'you' : ''}`}>
          {k === you ? <span className="you-tag">YOU</span> : null}
          <b>{t.name}</b>
          <span className="small">{t.does}</span>
        </div>
      ))}
    </div>
  );
}

function AlertsCard() {
  const alerts = useApi('/alerts');
  return (
    <div className="card">
      <div className="card-head"><h2>Needs your attention</h2><button className="btn sm ghost" onClick={alerts.reload}>Refresh</button></div>
      <Async state={alerts}>
        {(d) => (d.items.length ? (
          <div>
            {d.items.map((a, i) => (
              <div key={i} className="row" style={{ padding: '12px 20px', borderTop: i ? '1px solid var(--border)' : 0, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <StatusBadge status={a.severity} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{a.title}</div>
                  {a.detail ? <div className="small muted">{a.detail}</div> : null}
                </div>
                {a.link ? <button className="btn sm" onClick={() => navigate(a.link, a.recall_id ? { id: a.recall_id } : undefined)}>Open</button> : null}
              </div>
            ))}
          </div>
        ) : <Empty>✓ Nothing needs your attention right now.</Empty>)}
      </Async>
    </div>
  );
}

function Overview() {
  const { user } = useAuth();
  const over = isOversight(user);
  const info = ROLE_INFO[user.role];
  const batches = useApi('/batches', { query: { limit: 1 } });
  const shipments = useApi('/shipments', { query: { limit: 1 } });
  const recalls = useApi('/recalls');
  const anomalies = useApi(over || user.role === 'manufacturer' ? '/anomalies' : null);
  const inventory = useApi(over ? null : '/inventory', { query: { in_stock: 'true', limit: 1 } });
  const inbound = useApi(over || user.role === 'manufacturer' ? null : '/shipments', { query: { direction: 'inbound', status: 'dispatched', limit: 1 } });

  const openAnoms = anomalies.data ? anomalies.data.items.filter((a) => a.status === 'open') : [];
  const openRecalls = recalls.data ? recalls.data.items.filter((r) => r.status === 'in_progress') : [];
  const v = (s, f) => (s.data ? f(s.data) : s.loading ? '…' : '—');

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Welcome, {user.entity ? user.entity.name : user.display_name || info.title}</h1>
        <p className="lead">You are signed in as a <b>{info.title.toLowerCase()}</b>. {info.blurb}</p>
      </div>
      {!over ? <ChainStrip you={user.role} /> : null}
      <div className="grid cols-4">
        <Stat label={over ? 'Batches being tracked' : user.role === 'manufacturer' ? 'Batches you made' : 'Batches you handled'} value={v(batches, (d) => fmt.num(d.total))} />
        <Stat label={over ? 'Deliveries recorded' : 'Your deliveries'} value={v(shipments, (d) => fmt.num(d.total))} />
        {over || user.role === 'manufacturer'
          ? <Stat label="Suspicious findings to review" value={v(anomalies, () => openAnoms.length)} kind={openAnoms.length ? 'bad' : undefined}
              hint={anomalies.data ? `on ${new Set(openAnoms.map((a) => a.batch_id)).size} batch(es)` : ''} />
          : <Stat label="Batches in your stock" value={v(inventory, (d) => fmt.num(d.total))} />}
        {over || user.role === 'manufacturer'
          ? <Stat label="Recalls in progress" value={v(recalls, () => openRecalls.length)} kind={openRecalls.length ? 'warn' : undefined} />
          : <Stat label="Deliveries waiting for you" value={v(inbound, (d) => d.total)} kind={inbound.data && inbound.data.total ? 'warn' : undefined}
              hint="press Confirm received when they arrive" />}
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <AlertsCard />
        <div className="card">
          <div className="card-head"><h2>What you can do here</h2></div>
          <ol className="steps">
            {(TASKS[user.role] || []).map(([route, params, label, hint], i) => (
              <li key={label}>
                <span className="n">{i + 1}</span>
                <div className="txt"><b>{label}</b>{hint ? <div>{hint}</div> : null}</div>
                <button className="btn sm" onClick={() => navigate(route, params || undefined)}>Go →</button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Overview });
