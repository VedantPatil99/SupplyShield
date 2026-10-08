// App shell: role-driven navigation + hash routing.
const NAV = {
  manufacturer: [['overview', 'Home'], ['batches', 'My batches'], ['shipments', 'Send & receive'], ['map', 'Network map'], ['recalls', 'Recalls'], ['anomalies', 'Suspicious activity'], ['inventory', 'My stock']],
  distributor: [['overview', 'Home'], ['shipments', 'Send & receive'], ['inventory', 'My stock'], ['map', 'Network map'], ['recalls', 'Recalls'], ['batches', 'Batches']],
  wholesaler: [['overview', 'Home'], ['shipments', 'Send & receive'], ['inventory', 'My stock'], ['map', 'Network map'], ['recalls', 'Recalls'], ['batches', 'Batches']],
  pharmacy: [['overview', 'Home'], ['verify', 'Check if genuine'], ['map', 'Network map'], ['inventory', 'My stock'], ['shipments', 'Deliveries'], ['recalls', 'Recalls']],
  regulator: [['overview', 'Home'], ['anomalies', 'Suspicious activity'], ['map', 'Network map'], ['verify', 'Check if genuine'], ['recalls', 'Recalls'], ['batches', 'Batches'], ['shipments', 'Shipments'], ['inventory', 'Stock'], ['audit', 'Activity log']],
  admin: [['overview', 'Home'], ['sync', 'System status'], ['anomalies', 'Suspicious activity'], ['map', 'Network map'], ['verify', 'Check if genuine'], ['recalls', 'Recalls'], ['batches', 'Batches'], ['shipments', 'Shipments'], ['inventory', 'Stock'], ['users', 'Users'], ['audit', 'Activity log']],
};

const VIEWS = {
  overview: Overview, batches: Batches, shipments: Shipments, inventory: Inventory, map: NetworkMap, verify: Verify,
  anomalies: Anomalies, recalls: Recalls, sync: SyncHealth, users: Users, audit: Audit,
};
const ALIASES = { trace: 'map' }; // old links

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
  useEffect(() => { if (ALIASES[route]) navigate(ALIASES[route], params); }, [route, params]);
  useEffect(() => { document.title = `${(nav.find(([r]) => r === route) || [, 'SupplyShield'])[1]} · SupplyShield`; }, [route, nav]);

  return (
    <div className="shell">
      <nav className={`sidebar ${menu ? 'open' : ''}`} aria-label="Main">
        <div className="brand"><ShieldIcon /><div>SupplyShield<small>Medicine tracking & recalls</small></div></div>
        {nav.map(([r, label]) => (
          <a key={r} href={`#/${r}`} className={`nav-item ${route === r ? 'active' : ''}`} aria-current={route === r ? 'page' : undefined}>
            {label}{r === 'overview' && alertCount ? <span className="count">{alertCount}</span> : null}
          </a>
        ))}
        <div className="sidebar-foot">Demo with made-up data. Checks use fixed rules, not AI.</div>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn sm menu-btn" onClick={() => setMenu(!menu)} aria-label="Toggle menu">☰</button>
          <div className="spacer" />
          <div className="who">
            <Badge kind="brand"><span className="role-badge">{ROLE_INFO[user.role].title}</span></Badge>
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
