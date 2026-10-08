const DEMO_USERS = [
  { u: 'regulator1', p: 'Regulator@123', label: 'Regulator', hint: 'all anomalies, recalls, audit' },
  { u: 'admin', p: 'Admin@123', label: 'Admin', hint: 'users, sync health' },
  { u: 'mfg_aarav', p: 'Mfg@12345', label: 'Manufacturer', hint: 'Aarav Life Sciences' },
  { u: 'dist_national', p: 'Dist@12345', label: 'Distributor', hint: 'DIST-IN-00001' },
  { u: 'whs_city', p: 'Whs@12345', label: 'Wholesaler', hint: 'WHS-IN-00001' },
  { u: 'pharm_healthplus', p: 'Pharm@12345', label: 'Pharmacy', hint: 'PHARM-IN-00001' },
  { u: 'mfg_meadow', p: 'Mfg@12345', label: 'Manufacturer', hint: 'Meadow Pharma (planted batches)' },
  { u: 'mfg_vertex', p: 'Mfg@12345', label: 'Manufacturer', hint: 'Vertex (open recall)' },
  { u: 'pharm_recall', p: 'Pharm@12345', label: 'Pharmacy', hint: 'PHARM-IN-00042 (recall to act on)' },
  { u: 'pharm_suspect', p: 'Pharm@12345', label: 'Pharmacy', hint: 'PHARM-IN-00004 (suspect stock)' },
  { u: 'mfg_sunrise', p: 'Mfg@12345', label: 'Manufacturer', hint: 'Sunrise (fan-out batch)' },
];

function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (u = username, p = password) => {
    setBusy(true); setError(null);
    try {
      await login(u, p);
      navigate('overview');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <section className="login-hero">
        <div className="brand" style={{ padding: 0 }}><ShieldIcon size={40} /><div style={{ fontSize: 26 }}>SupplyShield</div></div>
        <h1>Pharmaceutical supply chain analytics, traceability and recall management</h1>
        <p>Combines established techniques (graph traversal, pattern detection, polyglot persistence) for pharma traceability:
          MongoDB is the system of record, a change-stream sync service mirrors relationships into Neo4j, and graph queries power tracing,
          recalls and suspicious-movement detection.</p>
        <ul>
          <li>Forward and backward tracing of any batch through the network</li>
          <li>Five deterministic graph-pattern heuristics flag suspicious movement (rule-based, not machine learning)</li>
          <li>Recall initiation from graph traversal, with per-entity progress tracking</li>
        </ul>
        <p className="small">All data is synthetic, modelled on public sources (DEA ARCOS, Amico et al. 2024, openFDA recalls, FDA NDC).</p>
      </section>
      <section className="login-panel">
        <div className="login-card stack">
          <div>
            <h2 style={{ fontSize: 22 }}>Sign in</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>Use your account or a demo role below.</p>
          </div>
          <form className="stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label className="field">Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
            <label className="field">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <ErrorBox error={error} />
            <button className="btn primary" disabled={busy} type="submit">{busy ? <Spinner /> : null} Sign in</button>
          </form>
          <div>
            <div className="small muted" style={{ marginBottom: 8, fontWeight: 600 }}>DEMO QUICK LOGIN</div>
            <div className="demo-grid">
              {DEMO_USERS.map((d) => (
                <button key={d.u} type="button" className="btn" disabled={busy} onClick={() => { setUsername(d.u); setPassword(d.p); submit(d.u, d.p); }}>
                  <span>{d.label} <span className="mono small muted">{d.u}</span></span>
                  <small>{d.hint}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ShieldIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 4 7v8c0 7.5 5.1 13.4 12 15 6.9-1.6 12-7.5 12-15V7z" fill="#0f766e" />
      <path d="m11 16 4 4 7-8" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

Object.assign(window, { Login, ShieldIcon });
