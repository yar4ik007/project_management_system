import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Employee, Role, ROLE_LABEL, roleLabel } from '../api';
import { Modal } from '../ui';
import { setActingAs } from '../impersonation';

const EMPTY: Partial<Employee> = {
  name: '',
  role: 'DEVELOPER',
  weeklyHours: 40,
  active: true,
  position: '',
  login: '',
  isAdmin: false,
};

export default function Employees() {
  const [list, setList] = useState<Employee[]>([]);
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const nav = useNavigate();

  const load = () => api.employees.list().then(setList);
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!edit?.name) return;
    const payload = { ...edit, weeklyHours: Number(edit.weeklyHours) };
    if (edit.id) await api.employees.update(edit.id, payload);
    else await api.employees.create(payload);
    setEdit(null);
    load();
  };

  const remove = async (id: number) => {
    if (!confirm('Удалить сотрудника? Его задачи/логи/планы тоже удалятся.')) return;
    await api.employees.remove(id);
    load();
  };

  return (
    <div>
      <div className="page-head">
        <h2>Сотрудники ({list.length})</h2>
        <button className="primary" onClick={() => setEdit({ ...EMPTY })}>
          + Сотрудник
        </button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Роль</th>
              <th>Должность</th>
              <th>Часов/нед</th>
              <th>Проекты</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>
                  {e.name} {e.isAdmin && <span title="Администратор">⭐</span>}
                  {e.login && <div className="muted" style={{ fontSize: 11 }}>@{e.login}</div>}
                  {e.telegramUsername && (
                    <div className="muted" style={{ fontSize: 11 }}>TG @{e.telegramUsername}</div>
                  )}
                </td>
                <td>
                  <span className="badge">{roleLabel(e.role)}</span>
                </td>
                <td>{e.position || '—'}</td>
                <td>{e.weeklyHours}</td>
                <td>{e.members?.map((m) => m.project.code).join(', ') || '—'}</td>
                <td>{e.active ? '✓ активен' : <span className="muted">неактивен</span>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button
                    className="icon-btn primary"
                    title="Войти и смотреть его глазами"
                    onClick={() => {
                      setActingAs(e.id);
                      nav('/me');
                    }}
                  >
                    👁
                  </button>
                  <button className="icon-btn" title="Редактировать" onClick={() => setEdit(e)}>
                    ✏️
                  </button>
                  <button className="icon-btn danger" title="Удалить" onClick={() => remove(e.id)}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.id ? 'Редактировать сотрудника' : 'Новый сотрудник'} onClose={() => setEdit(null)}>
          <div className="field">
            <label>Имя</label>
            <input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Роль</label>
              <select
                value={edit.role || ''}
                onChange={(e) => setEdit({ ...edit, role: (e.target.value || null) as Role | null })}
              >
                <option value="">⏳ без роли</option>
                {(['OPERATOR', 'MANAGER', 'DEVELOPER'] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ width: 120 }}>
              <label>Часов/нед</label>
              <input
                type="number"
                value={edit.weeklyHours ?? 40}
                onChange={(e) => setEdit({ ...edit, weeklyHours: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="field">
            <label>Должность</label>
            <input value={edit.position || ''} onChange={(e) => setEdit({ ...edit, position: e.target.value })} />
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={edit.active ?? true}
                onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
                style={{ width: 'auto', marginRight: 6 }}
              />
              Активен
            </label>
          </div>

          <div className="card" style={{ background: '#f8fafc', margin: 0, marginBottom: 12 }}>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Логин для входа</label>
                <input
                  value={edit.login || ''}
                  onChange={(e) => setEdit({ ...edit, login: e.target.value })}
                  placeholder="напр. anna"
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Пароль {edit.id ? '(пусто — не менять)' : ''}</label>
                <input
                  type="password"
                  value={edit.password || ''}
                  onChange={(e) => setEdit({ ...edit, password: e.target.value })}
                  placeholder="пароль"
                />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>
                <input
                  type="checkbox"
                  checked={edit.isAdmin ?? false}
                  onChange={(e) => setEdit({ ...edit, isAdmin: e.target.checked })}
                  style={{ width: 'auto', marginRight: 6 }}
                />
                Администратор (полный доступ, управление пользователями)
              </label>
            </div>
          </div>

          <button className="primary" onClick={save}>
            Сохранить
          </button>
        </Modal>
      )}
    </div>
  );
}
