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

  return (
    <div>
      <div className="page-head">
        <h2>Проекты ({list.length})</h2>
        <button className="primary" onClick={() => setEdit({ ...EMPTY })}>
          + Проект
        </button>
      </div>

      <div className="grid grid-3">
        {list.map((p) => {
          const st = p.stats;
          const pct = st && st.taskCount ? Math.round((st.doneCount / st.taskCount) * 100) : 0;
          return (
            <div className="card" key={p.id}>
              <div className="flex-between">
                <span className="tag" style={{ background: p.color }}>
                  {p.code}
                </span>
                <span className="badge" style={{ background: PROJECT_STATUS_COLOR[p.status], color: '#fff' }}>
                  {STATUS_LABEL[p.status]}
                </span>
              </div>
              <h3 style={{ margin: '10px 0 4px' }}>
                <Link to={`/projects/${p.id}`}>{p.name}</Link>
              </h3>
              <div className="muted" style={{ minHeight: 20 }}>
                {p.description || ''}
              </div>
              <div className="progress-wrap">
                <div className="flex-between" style={{ fontSize: 12, marginBottom: 4 }}>
                  <span>
                    Задач: {st?.doneCount}/{st?.taskCount} готово
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${pct}%`, background: p.color }} />
                </div>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                Оценка {st?.estimateHours ?? 0} ч · факт {st?.spentHours ?? 0} ч · команда{' '}
                {p.members?.length ?? 0}
              </div>
            </div>
          );
        })}
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
