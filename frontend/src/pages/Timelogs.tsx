import { useEffect, useState } from 'react';
import { api, TimeLog } from '../api';

export default function Timelogs() {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [q, setQ] = useState('');

  const load = () => api.tasks.allLogs().then(setLogs);
  useEffect(() => {
    load();
  }, []);

  const filtered = logs.filter(
    (l) =>
      !q ||
      l.employee?.name.toLowerCase().includes(q.toLowerCase()) ||
      l.task?.title.toLowerCase().includes(q.toLowerCase()) ||
      l.task?.project?.name.toLowerCase().includes(q.toLowerCase()),
  );
  const total = filtered.reduce((s, l) => s + l.hours, 0);

  const remove = async (id: number) => {
    if (!confirm('Удалить запись таймлога?')) return;
    await api.tasks.removeLog(id);
    load();
  };

  return (
    <div>
      <div className="page-head">
        <h2>Таймлоги ({filtered.length})</h2>
        <div className="row">
          <span className="muted">Итого: {Math.round(total * 100) / 100} ч</span>
          <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сотрудник</th>
              <th>Задача</th>
              <th>Проект</th>
              <th>Часы</th>
              <th>Комментарий</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Таймлогов нет.
                </td>
              </tr>
            )}
            {filtered.map((l) => (
              <tr key={l.id}>
                <td className="muted">{new Date(l.date).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{l.employee?.name || '—'}</td>
                <td>{l.task?.title || '—'}</td>
                <td>
                  {l.task?.project && (
                    <span className="tag" style={{ background: l.task.project.color }}>
                      {l.task.project.code}
                    </span>
                  )}
                </td>
                <td>
                  <b>{l.hours}</b> ч
                </td>
                <td className="muted">{l.note || ''}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="icon-btn danger" title="Удалить" onClick={() => remove(l.id)}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
