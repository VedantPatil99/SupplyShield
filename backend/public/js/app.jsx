// App shell: role-driven navigation + hash routing.
const NAV = {
  manufacturer: [['overview', 'Overview'], ['batches', 'My batches'], ['shipments', 'Shipments'], ['trace', 'Forward trace'], ['recalls', 'Recalls'], ['anomalies', 'Anomaly alerts'], ['inventory', 'Inventory']],
  distributor: [['overview', 'Overview'], ['shipments', 'Shipments'], ['inventory', 'Inventory'], ['recalls', 'Recalls'], ['batches', 'Batches']],
  wholesaler: [['overview', 'Overview'], ['shipments', 'Shipments'], ['inventory', 'Inventory'], ['recalls', 'Recalls'], ['batches', 'Batches']],
  pharmacy: [['overview', 'Overview'], ['verify', 'Verify authenticity'], ['inventory', 'Stock'], ['shipments', 'Deliveries'], ['recalls', 'Recalls']],
  regulator: [['overview', 'Overview'], ['anomalies', 'Anomalies'], ['trace', 'Forward trace'], ['verify', 'Verify authenticity'], ['recalls', 'Recalls'], ['batches', 'Batches'], ['shipments', 'Shipments'], ['inventory', 'Inventory'], ['audit', 'Audit log']],
  admin: [['overview', 'Overview'], ['sync', 'Sync health'], ['anomalies', 'Anomalies'], ['trace', 'Forward trace'], ['verify', 'Verify authenticity'], ['recalls', 'Recalls'], ['batches', 'Batches'], ['shipments', 'Shipments'], ['inventory', 'Inventory'], ['users', 'Users'], ['audit', 'Audit log']],
};

const VIEWS = {
  overview: Overview, batches: Batches, shipments: Shipments, inventory: Inventory, trace: Trace, verify: Verify,
  anomalies: Anomalies, recalls: Recalls, sync: SyncHealth, users: Users, audit: Audit,
};

function Shell() {
  const { user, logout } = useAuth();
  const { route, params } = useRoute();
  const [menu, setMenu] = useState(false);
  const alerts = useApi('/alerts', null, [route]);
  const nav = NAV[user.role] || [];
  const allowed = nav.some(([r]) => r === route);
  const View = allowed ? VIEWS[route] : null;
  const alertCount = alerts.data ? alerts.data.items.length : 0;
  useEffect(() => setMenu(false), [route]);
  useEffect(() => { document.title = `${(nav.find(([r]) => r === route) || [, 'SupplyShield'])[1]} · SupplyShield`; }, [route, nav]);

  return (
    <div className="shell">
      <nav className={`sidebar ${menu ? 'open' : ''}`} aria-label="Main">
        <div className="brand"><ShieldIcon /><div>SupplyShield<small>Supply chain analytics</small></div></div>
        {nav.map(([r, label]) => (
          <a key={r} href={`#/${r}`} className={`nav-item ${route === r ? 'active' : ''}`} aria-current={route === r ? 'page' : undefined}>
            {label}{r === 'overview' && alertCount ? <span className="count">{alertCount}</span> : null}
          </a>
        ))}
        <div className="sidebar-foot">Synthetic demo data · rule-based detection (not ML)</div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn sm menu-btn" onClick={() => setMenu(!menu)} aria-label="Toggle menu">☰</button>
          <div className="spacer" />
          <div className="who">
            <Badge kind="brand"><span className="role-badge">{ROLE_LABEL[user.role]}</span></Badge>
            <div>
              <div className="name">{user.display_name || user.username}</div>
              <div className="entity">{user.entity ? `${user.entity_id} · ${user.entity.name}` : user.username}</div>
            </div>
          </div>
          <button className="btn sm" onClick={() => { logout(); navigate('login'); }}>Sign out</button>
        </header>
        <main className="content">
          {View ? <View key={route} params={params} /> : (
            <div className="card"><Empty>{route === 'login' ? 'Redirecting…' : 'This page is not available for your role.'} <a href="#/overview">Go to overview</a></Empty></div>
          )}
        </main>
      </div>
    </div>
  );
}

function Root() {
  const { user, ready } = useAuth();
  const { route } = useRoute();
  useEffect(() => { if (ready && user && route === 'login') navigate('overview'); }, [ready, user, route]);
  if (!ready) return <div className="boot">Loading SupplyShield…</div>;
  return user ? <Shell /> : <Login />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ToastProvider><AuthProvider><Root /></AuthProvider></ToastProvider>,
);
