import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Project, ProjectStatus, STATUS_LABEL } from '../api';
import { Modal, PROJECT_STATUS_COLOR } from '../ui';

const EMPTY: Partial<Project> = { name: '', code: '', status: 'PLANNED', color: '#3b82f6', description: '' };

export default function Projects() {
  const [list, setList] = useState<Project[]>([]);
  const [edit, setEdit] = useState<Partial<Project> | null>(null);

  const load = () => api.projects.list().then(setList);
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!edit?.name || !edit.code) return;
    if (edit.id) await api.projects.update(edit.id, edit);
    else await api.projects.create(edit);
    setEdit(null);
    load();
  };

  const remove = async (p: Project) => {
    if (!confirm(`Удалить проект «${p.name}»? Его задачи, планы и таймлоги тоже удалятся.`)) return;
    await api.projects.remove(p.id);
    load();
  };

  return (
    <div>
      <div className="page-head">
        <h2>Проекты ({list.length})</h2>
        <button className="primary" onClick={() => setEdit({ ...EMPTY })}>
          + Проект
        </button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Код</th>
              <th>Проект</th>
              <th>Статус</th>
              <th style={{ width: 160 }}>Задачи</th>
              <th>Оценка / Факт</th>
              <th>Команда</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Проектов пока нет.
                </td>
              </tr>
            )}
            {list.map((p) => {
              const st = p.stats;
              const pct = st && st.taskCount ? Math.round((st.doneCount / st.taskCount) * 100) : 0;
              return (
                <tr key={p.id}>
                  <td>
                    <span className="tag" style={{ background: p.color }}>
                      {p.code}
                    </span>
                  </td>
                  <td>
                    <Link to={`/projects/${p.id}`}>{p.name}</Link>
                    {p.description && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {p.description}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="badge" style={{ background: PROJECT_STATUS_COLOR[p.status], color: '#fff' }}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                  <td>
                    <div className="bar">
                      <span style={{ width: `${pct}%`, background: p.color }} />
                    </div>
                    <small className="muted">
                      {st?.doneCount ?? 0}/{st?.taskCount ?? 0} · {pct}%
                    </small>
                  </td>
                  <td>
                    {st?.estimateHours ?? 0} / {st?.spentHours ?? 0} ч
                  </td>
                  <td>{p.members?.length ?? 0}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link to={`/projects/${p.id}`} className="icon-btn" title="Открыть">
                      ↗
                    </Link>
                    <button className="icon-btn" title="Редактировать" onClick={() => setEdit(p)}>
                      ✏️
                    </button>
                    <button className="icon-btn danger" title="Удалить" onClick={() => remove(p)}>
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.id ? 'Редактировать проект' : 'Новый проект'} onClose={() => setEdit(null)}>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Название</label>
              <input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="field" style={{ width: 110 }}>
              <label>Код</label>
              <input value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <div className="field">
            <label>Описание</label>
            <textarea
              value={edit.description || ''}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Статус</label>
              <select
                value={edit.status}
                onChange={(e) => setEdit({ ...edit, status: e.target.value as ProjectStatus })}
              >
                {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ width: 80 }}>
              <label>Цвет</label>
              <input
                type="color"
                value={edit.color || '#3b82f6'}
                onChange={(e) => setEdit({ ...edit, color: e.target.value })}
                style={{ padding: 2, height: 38 }}
              />
            </div>
          </div>
          <div className="field">
            <label>Telegram-бот: токен (BotFather)</label>
            <input
              value={edit.botToken || ''}
              placeholder="123456:ABC-DEF..."
              onChange={(e) => setEdit({ ...edit, botToken: e.target.value })}
            />
            <small className="muted">
              Бот подхватит задачи и участников проекта; исполнители смогут трекать время из Telegram.
            </small>
          </div>
          <button className="primary" onClick={save}>
            Сохранить
          </button>
        </Modal>
      )}
    </div>
  );
}
