import { createContext, useContext, useEffect, useState } from 'react';
import { api, Employee, getToken, setToken } from './api';
import { setActingAs } from './impersonation';

interface AuthCtx {
  user: Employee | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<string | null>;
  verify2fa: (ticket: string, code: string) => Promise<void>;
  setCurrentUser: (u: Employee) => void;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.auth.me());
    } catch {
      setUser(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const h = () => refresh();
    window.addEventListener('auth-changed', h);
    return () => window.removeEventListener('auth-changed', h);
  }, []);

  // Возвращает ticket, если требуется 2FA (иначе логинит сразу).
  const login = async (l: string, p: string): Promise<string | null> => {
    const res = await api.auth.login(l, p);
    if (res.twoFactorRequired && res.ticket) return res.ticket;
    setToken(res.token!);
    setUser(res.user!);
    return null;
  };
  const verify2fa = async (ticket: string, code: string) => {
    const { token, user } = await api.auth.verify2fa(ticket, code);
    setToken(token);
    setUser(user);
  };
  const setCurrentUser = (u: Employee) => setUser(u);
  const logout = () => {
    setToken(null);
    setActingAs(null);
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, verify2fa, setCurrentUser, logout }}>{children}</Ctx.Provider>
  );
}

export function LoginPage() {
  const { login, verify2fa } = useAuth();
  const [l, setL] = useState('');
  const [p, setP] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (ticket) {
        await verify2fa(ticket, code.trim());
      } else {
        const t = await login(l.trim(), p);
        if (t) setTicket(t); // требуется код 2FA
      }
    } catch (e: any) {
      setErr(e.message || 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <span className="logo-badge">EOB</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Eye Of Boss</div>
            <div className="muted" style={{ fontSize: 13 }}>управление проектами</div>
          </div>
        </div>
        {err && <div className="alert">{err}</div>}
        {ticket ? (
          <>
            <div className="field">
              <label>Код из приложения (2FA)</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                inputMode="numeric"
                placeholder="6-значный код"
              />
            </div>
            <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Проверяем…' : 'Подтвердить'}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>Логин</label>
              <input value={l} onChange={(e) => setL(e.target.value)} autoFocus placeholder="логин" />
            </div>
            <div className="field">
              <label>Пароль</label>
              <input type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="пароль" />
            </div>
            <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Входим…' : 'Войти'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
