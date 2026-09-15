import { useState } from 'react';
import { api, roleLabel } from '../api';
import { useAuth } from '../auth';
import { confirmAction } from '../ui';

export default function Profile() {
  const { user, setCurrentUser } = useAuth();
  if (!user) return null;

  return (
    <div>
      <div className="page-head">
        <h2>Профиль</h2>
      </div>

      <div className="grid grid-2">
        <div>
          <div className="card">
            <h3>Обо мне</h3>
            <table>
              <tbody>
                <tr>
                  <td className="muted">Имя</td>
                  <td>{user.name}</td>
                </tr>
                <tr>
                  <td className="muted">Роль</td>
                  <td>
                    <span className="badge">{roleLabel(user.role)}</span>
                    {user.isAdmin && <span title="Администратор"> ⭐ админ</span>}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Должность</td>
                  <td>{user.position || '—'}</td>
                </tr>
                <tr>
                  <td className="muted">Логин</td>
                  <td>{user.login || '—'}</td>
                </tr>
                <tr>
                  <td className="muted">Email</td>
                  <td>{user.email || '—'}</td>
                </tr>
                <tr>
                  <td className="muted">Telegram</td>
                  <td>
                    {user.telegramUsername ? (
                      <a href={`https://t.me/${user.telegramUsername}`} target="_blank" rel="noreferrer">
                        @{user.telegramUsername}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Telegram ID</td>
                  <td>{user.telegramUserId ? user.telegramUserId : <span className="muted">не привязан</span>}</td>
                </tr>
                <tr>
                  <td className="muted">2FA</td>
                  <td>{user.twoFactorEnabled ? '🔒 включена' : 'выключена'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <LoginBlock />
          <PasswordBlock />
        </div>

        <TwoFactorBlock onChanged={(u) => setCurrentUser(u)} />
      </div>
    </div>
  );
}

function LoginBlock() {
  const { user, setCurrentUser } = useAuth();
  const [login, setLogin] = useState(user?.login || '');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    setMsg(null);
    if (!(await confirmAction('Сохранить новый логин?', { confirmText: 'Сохранить' }))) return;
    try {
      const u = await api.auth.updateAccount({ login });
      setCurrentUser(u);
      setMsg('Логин сохранён');
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="card">
      <h3>Логин</h3>
      {err && <div className="alert">{err}</div>}
      {msg && <div className="muted">✓ {msg}</div>}
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <input value={login} onChange={(e) => setLogin(e.target.value)} />
        </div>
        <button className="primary" onClick={save}>
          Сохранить
        </button>
      </div>
    </div>
  );
}

function PasswordBlock() {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    setMsg(null);
    if (!nw) return;
    if (!(await confirmAction('Изменить пароль?', { confirmText: 'Изменить' }))) return;
    try {
      await api.auth.updateAccount({ currentPassword: cur, newPassword: nw });
      setCur('');
      setNw('');
      setMsg('Пароль изменён');
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="card">
      <h3>Смена пароля</h3>
      {err && <div className="alert">{err}</div>}
      {msg && <div className="muted">✓ {msg}</div>}
      <div className="field">
        <label>Текущий пароль</label>
        <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
      </div>
      <div className="field">
        <label>Новый пароль</label>
        <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} />
      </div>
      <button className="primary" onClick={save}>
        Изменить пароль
      </button>
    </div>
  );
}

function TwoFactorBlock({ onChanged }: { onChanged: (u: any) => void }) {
  const { user } = useAuth();
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const startSetup = async () => {
    setErr(null);
    setSetup(await api.auth.setup2fa());
  };
  const enable = async () => {
    setErr(null);
    if (!(await confirmAction('Включить двухфакторную аутентификацию?', { confirmText: 'Включить' }))) return;
    try {
      await api.auth.enable2fa(code.trim());
      onChanged(await api.auth.me());
      setSetup(null);
      setCode('');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const disable = async () => {
    setErr(null);
    if (!(await confirmAction('Отключить двухфакторную аутентификацию?', { danger: true, confirmText: 'Отключить' }))) return;
    try {
      await api.auth.disable2fa(code.trim());
      onChanged(await api.auth.me());
      setCode('');
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="card">
      <h3>🔒 Двухфакторная аутентификация</h3>
      {err && <div className="alert">{err}</div>}
      {user?.twoFactorEnabled ? (
        <>
          <p className="muted">2FA включена. Для отключения введите текущий код из приложения.</p>
          <div className="field">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="код из приложения" />
          </div>
          <button className="danger" onClick={disable}>
            Отключить 2FA
          </button>
        </>
      ) : setup ? (
        <>
          <p className="muted">
            Отсканируйте QR в Google Authenticator (или Authy) и введите код для подтверждения.
          </p>
          <img src={setup.qrDataUrl} alt="QR" style={{ width: 180, height: 180 }} />
          <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
            Ключ вручную: <b>{setup.secret}</b>
          </p>
          <div className="field">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-значный код" />
          </div>
          <button className="primary" onClick={enable}>
            Включить 2FA
          </button>
        </>
      ) : (
        <>
          <p className="muted">Защитите вход кодом из приложения-аутентификатора.</p>
          <button className="primary" onClick={startSetup}>
            Настроить 2FA
          </button>
        </>
      )}
    </div>
  );
}
