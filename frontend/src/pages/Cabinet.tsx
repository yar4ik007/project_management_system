import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Assignment, Employee, Note, Task, Tracking, roleLabel, TASK_STATUS_LABEL } from '../api';
import { useActingAs } from '../impersonation';
import { useAuth } from '../auth';
import { TASK_STATUS_COLOR, fmtTime } from '../ui';

export default function Cabinet() {
  const actingAs = useActingAs();
  const { user } = useAuth();
  const effectiveId = actingAs ?? user?.id ?? null;
  const [emp, setEmp] = useState<Employee | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [trackings, setTrackings] = useState<Tracking[]>([]);
  const [plan, setPlan] = useState<Assignment[]>([]);

  const load = async () => {
    if (!effectiveId) return;
    // Админ смотрит чужой кабинет (actingAs) — тянем сотрудника; сам себя — берём из профиля.
    const e = actingAs ? await api.employees.get(actingAs) : user!;
    setEmp(e);
    setTasks((await api.tasks.list()).filter((t) => t.assigneeId === effectiveId));
    setTrackings((await api.tracking.active()).filter((t) => t.employeeId === effectiveId));
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 14 * 864e5);
    setPlan(await api.assignments.list(from.toISOString(), to.toISOString(), effectiveId));
  };

  useEffect(() => {
    load();
  }, [effectiveId]);

  if (!effectiveId || !emp)
    return (
      <div className="card">
        <h3>Кабинет сотрудника</h3>
        <p className="muted">
          Откройте <Link to="/employees">Сотрудники</Link> и нажмите «👁» напротив нужного человека — увидите систему
          его глазами.
        </p>
      </div>
    );

  const trackerFor = (t: Task) => trackings.find((tr) => tr.taskId === t.id);
  const track = async (fn: 'start' | 'pause' | 'stop', t: Task) => {
    await api.tracking[fn](t.id, emp.id);
    load();
  };
  const open = tasks.filter((t) => t.status !== 'DONE');

  return (
    <div>
      <div className="page-head">
        <h2>
          Кабинет: {emp.name} <span className="badge">{roleLabel(emp.role)}</span>
        </h2>
        <span className="muted">{emp.position}</span>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Мои задачи ({open.length})</h3>
          {open.length === 0 && <p className="muted">Открытых задач нет.</p>}
          {open.map((t) => {
            const tr = trackerFor(t);
            const pct = t.estimateHours ? Math.min(100, Math.round(((t.spentHours || 0) / t.estimateHours) * 100)) : 0;
            return (
              <div key={t.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="flex-between">
                  <div>
                    <span className="badge">P{t.priorityRank}</span> <b>{t.title}</b>
                    <div className="muted" style={{ fontSize: 12 }}>
                      <span className="tag" style={{ background: t.project?.color }}>
                        {t.project?.code}
                      </span>{' '}
                      <span className="tag" style={{ background: TASK_STATUS_COLOR[t.status] }}>
                        {TASK_STATUS_LABEL[t.status]}
                      </span>{' '}
                      факт {t.spentHours || 0} / план {t.estimateHours} ч
                      {tr?.state === 'RUNNING' && ' · 🟢 идёт'}
                      {tr?.state === 'PAUSED' && ' · ⏸ пауза'}
                    </div>
                  </div>
                  <div style={{ whiteSpace: 'nowrap' }}>
                    {tr?.state === 'RUNNING' ? (
                      <>
                        <button className="sm" onClick={() => track('pause', t)}>
                          ⏸
                        </button>{' '}
                        <button className="sm danger" onClick={() => track('stop', t)}>
                          ⏹
                        </button>
                      </>
                    ) : (
                      <button className="sm primary" onClick={() => track('start', t)}>
                        ▶️ {tr ? 'Продолжить' : 'Старт'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="bar" style={{ marginTop: 6 }}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <div className="card">
            <h3>Мой план (2 недели)</h3>
            {plan.length === 0 && <p className="muted">Слотов пока нет.</p>}
            {plan.map((a) => (
              <div key={a.id} className="flex-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span className="tag" style={{ background: a.task?.project?.color }}>
                    {a.task?.project?.code}
                  </span>{' '}
                  {a.task?.title}
                </div>
                <span className="muted">
                  {new Date(a.startAt).toLocaleDateString('ru-RU')} {fmtTime(a.startAt)}–{fmtTime(a.endAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Заметки сотрудника: список отдельных записей — добавить / редактировать / удалить.
export function NotesBlock({ employeeId }: { employeeId: number }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const load = () => api.employees.notes(employeeId).then(setNotes);
  useEffect(() => {
    load();
  }, [employeeId]);

  const add = async () => {
    if (!draft.trim()) return;
    await api.employees.addNote(employeeId, draft.trim());
    setDraft('');
    load();
  };
  const saveEdit = async () => {
    if (editId == null) return;
    await api.employees.updateNote(editId, editText);
    setEditId(null);
    load();
  };
  const del = async (id: number) => {
    if (confirm('Удалить заметку?')) {
      await api.employees.removeNote(id);
      load();
    }
  };

  return (
    <div className="card">
      <h3>📝 Заметки ({notes.length})</h3>
      <div className="row" style={{ marginBottom: 12 }}>
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Новая заметка…"
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={add}>
          Добавить
        </button>
      </div>
      {notes.length === 0 && <p className="muted">Заметок пока нет.</p>}
      {notes.map((n) => (
        <div key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          {editId === n.id ? (
            <div className="row">
              <textarea rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} style={{ flex: 1 }} />
              <button className="primary sm" onClick={saveEdit}>
                Сохранить
              </button>
              <button className="sm" onClick={() => setEditId(null)}>
                Отмена
              </button>
            </div>
          ) : (
            <div className="flex-between">
              <div style={{ whiteSpace: 'pre-wrap', flex: 1 }}>{n.text}</div>
              <div style={{ whiteSpace: 'nowrap', marginLeft: 8 }}>
                <button
                  className="sm"
                  onClick={() => {
                    setEditId(n.id);
                    setEditText(n.text);
                  }}
                >
                  ✏️
                </button>{' '}
                <button className="sm danger" onClick={() => del(n.id)}>
                  🗑
                </button>
              </div>
            </div>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {new Date(n.createdAt).toLocaleString('ru-RU')}
          </div>
        </div>
      ))}
    </div>
  );
}
