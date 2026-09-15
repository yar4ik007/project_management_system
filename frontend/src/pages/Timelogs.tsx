import { useEffect, useState } from 'react';
import { api, TimeLog } from '../api';
import { confirmAction } from '../ui';

export default function Timelogs() {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [q, setQ] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [eHours, setEHours] = useState('');
  const [eNote, setENote] = useState('');

  const load = () => api.tasks.allLogs().then(setLogs);
  useEffect(() => {
    load();
  }, []);

  const startEdit = (l: TimeLog) => {
    setEditId(l.id);
    setEHours(String(l.hours));
    setENote(l.note || '');
  };
  const saveEdit = async () => {
    if (editId == null) return;
    if (!(await confirmAction('Сохранить изменения записи таймлога?', { confirmText: 'Сохранить' }))) return;
    await api.tasks.updateLog(editId, { hours: Number(eHours), note: eNote });
    setEditId(null);
    load();
  };

  const filtered = logs.filter(
    (l) =>
      !q ||
      l.employee?.name.toLowerCase().includes(q.toLowerCase()) ||
      l.task?.title.toLowerCase().includes(q.toLowerCase()) ||
      l.task?.project?.name.toLowerCase().includes(q.toLowerCase()),
  );
  const total = filtered.reduce((s, l) => s + l.hours, 0);

  const remove = async (id: number) => {
    if (!(await confirmAction('Удалить запись таймлога?', { danger: true, confirmText: 'Удалить' }))) return;
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
                  {editId === l.id ? (
                    <input
                      type="number"
                      step="0.01"
                      value={eHours}
                      onChange={(e) => setEHours(e.target.value)}
                      style={{ width: 80 }}
                    />
                  ) : (
                    <>
                      <b>{l.hours}</b> ч
                      {l.editedAt && (
                        <div
                          className="muted"
                          style={{ fontSize: 11 }}
                          title={`Изменил: ${l.editor?.name || '—'} · ${new Date(l.editedAt).toLocaleString('ru-RU')}${
                            l.originalHours != null ? ` · было ${l.originalHours} ч` : ''
                          }`}
                        >
                          ✏️ изменено{l.originalHours != null ? ` (было ${l.originalHours}ч)` : ''}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="muted">
                  {editId === l.id ? (
                    <input value={eNote} onChange={(e) => setENote(e.target.value)} style={{ width: '100%' }} />
                  ) : (
                    l.note || ''
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {editId === l.id ? (
                    <>
                      <button className="icon-btn primary" title="Сохранить" onClick={saveEdit}>
                        ✓
                      </button>
                      <button className="icon-btn" title="Отмена" onClick={() => setEditId(null)}>
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="icon-btn" title="Редактировать" onClick={() => startEdit(l)}>
                        ✏️
                      </button>
                      <button className="icon-btn danger" title="Удалить" onClick={() => remove(l.id)}>
                        🗑
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
