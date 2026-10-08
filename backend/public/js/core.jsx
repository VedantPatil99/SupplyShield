// Core: API wrapper, auth + toast contexts, hash router, formatting helpers. Everything is exported on window.
const { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } = React;

// ---------- storage (sessionStorage may be unavailable: wrap every access) ----------
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
};

// ---------- API ----------
let authToken = store.get('ss_token');
let onUnauthorized = () => {};

class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

async function api(path, { method = 'GET', body, query } = {}) {
  let url = `/api${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError(0, 'Cannot reach the SupplyShield server');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data);
  return data;
}

// ---------- auth ----------
const AuthContext = createContext(null);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    authToken = null;
    store.del('ss_token');
    setUser(null);
  }, []);

  useEffect(() => {
    onUnauthorized = logout;
    if (!authToken) { setReady(true); return; }
    api('/auth/me').then((d) => setUser(d.user)).catch(() => logout()).finally(() => setReady(true));
  }, [logout]);

  const login = useCallback(async (username, password) => {
    const d = await api('/auth/login', { method: 'POST', body: { username, password } });
    authToken = d.token;
    store.set('ss_token', d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout }), [user, ready, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
const useAuth = () => useContext(AuthContext);

// ---------- toasts ----------
const ToastContext = createContext(() => {});
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = '') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'bad' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastContext.Provider>
  );
}
const useToast = () => useContext(ToastContext);

// ---------- hash router: #/route?key=value ----------
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [route, qs] = h.split('?');
  return { route: route || 'overview', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function navigate(route, params) {
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString() : '';
  window.location.hash = `#/${route}${qs ? `?${qs}` : ''}`;
}
function useRoute() {
  const [r, setR] = useState(parseHash());
  useEffect(() => {
    const on = () => setR(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

// ---------- data hook ----------
function useApi(path, opts, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path, opts).then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, JSON.stringify(opts || {}), ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// ---------- formatting ----------
const fmt = {
  date(d) { if (!d) return '—'; const x = new Date(d); return Number.isNaN(+x) ? String(d) : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); },
  dateTime(d) { if (!d) return '—'; const x = new Date(d); return Number.isNaN(+x) ? String(d) : `${x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })} ${x.toISOString().slice(11, 16)} UTC`; },
  num(n) { return n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN'); },
  ms(n) { return n === null || n === undefined ? '—' : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} ms`; },
  type(t) { return t ? t.replace(/_/g, ' ') : '—'; },
  label(arr) { const a = Array.isArray(arr) ? arr : [arr]; return (a[0] || '').toString().toLowerCase(); },
};

const ROLE_LABEL = { manufacturer: 'Manufacturer', distributor: 'Distributor', wholesaler: 'Wholesaler', pharmacy: 'Pharmacy', regulator: 'Regulator', admin: 'Admin' };
const isOversight = (u) => u && (u.role === 'admin' || u.role === 'regulator');

// Hooks are exported too, so the other .jsx files can use them without redeclaring (shared global scope).
Object.assign(window, {
  createContext, useContext, useState, useEffect, useCallback, useMemo, useRef,
  api, ApiError, AuthProvider, useAuth, ToastProvider, useToast, navigate, useRoute, useApi, fmt, ROLE_LABEL, isOversight, store,
});
