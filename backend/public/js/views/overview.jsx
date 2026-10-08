function AlertsCard() {
  const alerts = useApi('/alerts');
  return (
    <div className="card">
      <div className="card-head"><h2>Alerts</h2><button className="btn sm" onClick={alerts.reload}>Refresh</button></div>
      <Async state={alerts} empty={(d) => !d.items.length}>
        {(d) => (
          <div>
            {d.items.map((a, i) => (
              <div key={i} className="row" style={{ padding: '12px 20px', borderTop: i ? '1px solid var(--border)' : 0, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <StatusBadge status={a.severity} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{a.title}</div>
                  {a.detail ? <div className="small muted">{a.detail}</div> : null}
                </div>
                {a.link ? <button className="btn sm" onClick={() => navigate(a.link)}>Open</button> : null}
              </div>
            ))}
          </div>
        )}
      </Async>
    </div>
  );
}

function Overview() {
  const { user } = useAuth();
  const over = isOversight(user);
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
      <PageHead title={`Welcome, ${user.display_name || user.username}`}
        sub={user.entity ? `${user.entity.name} · ${user.entity_id} · ${user.entity.city}` : over ? 'Network-wide oversight view' : ''} />
      <div className="grid cols-4">
        <Stat label={over ? 'Batches in network' : user.role === 'manufacturer' ? 'My batches' : 'Batches handled'} value={v(batches, (d) => fmt.num(d.total))} />
        <Stat label={over ? 'Shipments recorded' : 'My shipments'} value={v(shipments, (d) => fmt.num(d.total))} />
        {over || user.role === 'manufacturer'
          ? <Stat label="Open anomaly findings" value={v(anomalies, () => openAnoms.length)} kind={openAnoms.length ? 'bad' : undefined}
              hint={anomalies.data ? `${new Set(openAnoms.map((a) => a.batch_id)).size} batch(es) affected` : ''} />
          : <Stat label="Stock lines on hand" value={v(inventory, (d) => fmt.num(d.total))} />}
        {over || user.role === 'manufacturer'
          ? <Stat label="Recalls in progress" value={v(recalls, () => openRecalls.length)} kind={openRecalls.length ? 'warn' : undefined} />
          : <Stat label="Inbound awaiting receipt" value={v(inbound, (d) => d.total)} kind={inbound.data && inbound.data.total ? 'warn' : undefined} />}
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <AlertsCard />
        <QuickActions />
      </div>
    </div>
  );
}

function QuickActions() {
  const { user } = useAuth();
  const actions = {
    manufacturer: [['batches', 'Register a batch', { new: 1 }], ['shipments', 'Ship stock', { new: 1 }], ['trace', 'Forward trace a batch'], ['recalls', 'Initiate or monitor a recall']],
    distributor: [['shipments', 'Confirm inbound / create outbound shipments'], ['inventory', 'View inventory and recall flags'], ['recalls', 'Respond to recalls']],
    wholesaler: [['shipments', 'Confirm inbound / create outbound shipments'], ['inventory', 'View inventory and recall flags'], ['recalls', 'Respond to recalls']],
    pharmacy: [['verify', 'Verify a batch is authentic'], ['shipments', 'Confirm deliveries'], ['inventory', 'View stock'], ['recalls', 'Respond to recalls']],
    regulator: [['anomalies', 'Review anomaly findings'], ['trace', 'Trace any batch'], ['verify', 'Verify a batch at an entity'], ['recalls', 'Recall progress'], ['audit', 'Audit log']],
    admin: [['sync', 'Sync health'], ['anomalies', 'Run anomaly detection'], ['users', 'Manage users'], ['audit', 'Audit log']],
  }[user.role] || [];
  return (
    <div className="card">
      <div className="card-head"><h2>Quick actions</h2></div>
      <div className="card-pad stack" style={{ gap: 8 }}>
        {actions.map(([r, label, params]) => (
          <button key={label} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => navigate(r, params)}>{label}<span aria-hidden="true">→</span></button>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Overview });
