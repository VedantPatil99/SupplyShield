// Demo accounts grouped by what you'd want to show with them.
const DEMO_GROUPS = [
  {
    title: 'Oversight',
    users: [
      { u: 'regulator1', p: 'Regulator@123', role: 'regulator', who: 'Drug regulator', hint: 'Best place to start: sees everything' },
      { u: 'admin', p: 'Admin@123', role: 'admin', who: 'System administrator', hint: 'Users and system status' },
    ],
  },
  {
    title: 'Companies in the supply chain',
    users: [
      { u: 'mfg_aarav', p: 'Mfg@12345', role: 'manufacturer', who: 'Aarav Life Sciences', hint: 'Register and ship a new batch' },
      { u: 'dist_national', p: 'Dist@12345', role: 'distributor', who: 'National Drug Distributors', hint: 'Receive and pass on stock' },
      { u: 'whs_city', p: 'Whs@12345', role: 'wholesaler', who: 'City wholesaler', hint: 'Receive and pass on stock' },
      { u: 'pharm_healthplus', p: 'Pharm@12345', role: 'pharmacy', who: 'HealthPlus Pharmacy', hint: 'Receive deliveries, check medicine' },
    ],
  },
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
        <h1>Know where every medicine came from, and stop the ones that shouldn't be sold.</h1>
        <p>Every pack of medicine passes through several companies before it reaches a patient. SupplyShield records each hand-over, so you can:</p>
        <ul className="hero-points">
          <li><b>Track any batch</b> on a map of every company it passed through.</li>
          <li><b>Check a pack is genuine</b> by following its delivery records back to the manufacturer.</li>
          <li><b>Spot suspicious activity</b>, such as stock that appears from nowhere, with automatic checks.</li>
          <li><b>Recall unsafe medicine</b>: everyone who received it is notified, and you can watch them respond.</li>
        </ul>
        <p className="small">This is a demo. All companies and records are made up, modelled on public drug-supply data. The checks use fixed rules, not AI.</p>
      </section>
      <section className="login-panel">
        <div className="login-card stack">
          <div>
            <h2 style={{ fontSize: 22 }}>Try it: pick a role</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>Each button logs you in as a different kind of user.</p>
          </div>
          {DEMO_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="small muted" style={{ marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{g.title}</div>
              <div className="demo-grid">
                {g.users.map((d) => (
                  <button key={d.u} type="button" className="btn" disabled={busy} onClick={() => { setUsername(d.u); setPassword(d.p); submit(d.u, d.p); }}>
                    <span className="row" style={{ gap: 6 }}><b>{d.who}</b></span>
                    <small>{ROLE_INFO[d.role].title} · {d.hint}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <ErrorBox error={error} />
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Sign in with a username and password instead</summary>
            <form className="stack" style={{ gap: 12, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <label className="field">Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
              <label className="field">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
              <button className="btn primary" disabled={busy} type="submit">{busy ? <Spinner /> : null} Sign in</button>
            </form>
          </details>
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
