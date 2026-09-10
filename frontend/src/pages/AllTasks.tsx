import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Task, PRIORITY_LABEL, TASK_STATUS_LABEL } from '../api';
import { TASK_STATUS_COLOR, PRIORITY_COLOR } from '../ui';

export default function AllTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.tasks.list().then(setTasks);
  }, []);

  const filtered = tasks.filter(
    (t) =>
      (!status || t.status === status) &&
      (!q || t.title.toLowerCase().includes(q.toLowerCase()) || t.project?.name.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div>
      <div className="page-head">
        <h2>Все задачи ({filtered.length})</h2>
        <div className="row">
          <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
            <option value="">Все статусы</option>
            {Object.entries(TASK_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Задача</th>
              <th>Проект</th>
              <th>Статус</th>
              <th>Приоритет</th>
              <th>Исполнитель</th>
              <th>Автор</th>
              <th>Оценка / Факт</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Задач нет.
                </td>
              </tr>
            )}
            {filtered.map((t) => {
              const over = (t.spentHours || 0) > t.estimateHours && t.estimateHours > 0;
              return (
                <tr key={t.id}>
                  <td>
                    <span className="badge" title="Приоритет">
                      P{t.priorityRank}
                    </span>{' '}
                    {t.title}
                  </td>
                  <td>
                    {t.project && (
                      <Link to={`/projects/${t.projectId}`}>
                        <span className="tag" style={{ background: t.project.color }}>
                          {t.project.code}
                        </span>
                      </Link>
                    )}
                  </td>
                  <td>
                    <span className="tag" style={{ background: TASK_STATUS_COLOR[t.status] }}>
                      {TASK_STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td>
                    <span className="tag" style={{ background: PRIORITY_COLOR[t.priority] }}>
                      {PRIORITY_LABEL[t.priority]}
                    </span>
                  </td>
                  <td>{t.assignee?.name || <span className="muted">—</span>}</td>
                  <td>{t.creator?.name || <span className="muted">—</span>}</td>
                  <td style={{ color: over ? 'var(--danger)' : undefined }}>
                    {t.estimateHours} / {t.spentHours || 0} ч
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
