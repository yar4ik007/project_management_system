import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Settings() {
  const [token, setToken] = useState('');
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [botInfo, setBotInfo] = useState<{ username?: string | null; error?: string; loading?: boolean }>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings.get().then((s) => {
      setToken(s.adminBotToken || '');
      setSavedUsername(s.adminBotUsername);
    });
  }, []);

  // Живая проверка токена -> @username
  useEffect(() => {
    const t = token.trim();
    if (!t) {
      setBotInfo({});
      return;
    }
    setBotInfo({ loading: true });
    const h = setTimeout(async () => {
      try {
        const r = await api.projects.resolveBot(t);
        setBotInfo({ username: r.username, error: r.error });
      } catch {
        setBotInfo({ error: 'ошибка проверки' });
      }
    }, 600);
    return () => clearTimeout(h);
  }, [token]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.settings.update(token.trim() || null);
      setSavedUsername(s.adminBotUsername);
      setMsg(token.trim() ? 'Токен сохранён, бот перезапущен' : 'Токен очищен, бот остановлен');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Настройки</h2>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <h3>👑 Главный админ-бот</h3>
        <p className="muted">
          Отдельный Telegram-бот с полным управлением (дашборд, проекты, сотрудники, задачи). Доступ — только у
          администраторов по логину/паролю. Создайте бота у @BotFather и вставьте токен.
        </p>
        {savedUsername && (
          <p>
            Текущий бот:{' '}
            <a href={`https://t.me/${savedUsername}`} target="_blank" rel="noreferrer">
              🤖 @{savedUsername}
            </a>
          </p>
        )}
        <div className="field">
          <label>Токен админ-бота (BotFather)</label>
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF..." />
          {token.trim() && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {botInfo.loading ? (
                <span className="muted">проверяем токен…</span>
              ) : botInfo.username ? (
                <span style={{ color: 'var(--ok)' }}>🤖 бот: @{botInfo.username}</span>
              ) : botInfo.error ? (
                <span style={{ color: 'var(--danger)' }}>✕ {botInfo.error}</span>
              ) : null}
            </div>
          )}
        </div>
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>{' '}
        {msg && <span className="muted">✓ {msg}</span>}
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          После сохранения напишите боту <b>/start</b> и войдите своим логином/паролем администратора.
        </p>
      </div>
    </div>
  );
}
