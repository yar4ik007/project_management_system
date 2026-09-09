import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Assignment, Employee, Task, Tracking, ROLE_LABEL, TASK_STATUS_LABEL } from '../api';
import { useActingAs } from '../impersonation';
import { TASK_STATUS_COLOR, fmtTime } from '../ui';

export default function Cabinet() {
  const actingAs = useActingAs();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [trackings, setTrackings] = useState<Tracking[]>([]);
  const [plan, setPlan] = useState<Assignment[]>([]);
  const [notes, setNotes] = useState('');
  const [savedNote, setSavedNote] = useState(false);

  const load = async () => {
    if (!actingAs) return;
    const e = await api.employees.get(actingAs);
    setEmp(e);
    setNotes(e.notes || '');
    setTasks((await api.tasks.list()).filter((t) => t.assigneeId === actingAs));
    setTrackings((await api.tracking.active()).filter((t) => t.employeeId === actingAs));
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 14 * 864e5);
    setPlan((await api.assignments.list(from.toISOString(), to.toISOString(), actingAs)));
  };

  useEffect(() => {
    load();
  }, [actingAs]);

  if (!actingAs || !emp)
    return (
      <div className="card">
        <h3>Кабинет сотрудника</h3>
        <p className="muted">
          Откройте <Link to="/employees">Сотрудники</Link> и нажмите «👁 Войти» напротив нужного человека — увидите
          систему его глазами.
        </p>
      </div>
    );

  const trackerFor = (t: Task) => trackings.find((tr) => tr.taskId === t.id);
  const track = async (fn: 'start' | 'pause' | 'stop', t: Task) => {
    await api.tracking[fn](t.id, emp.id);
    load();
  };
  const saveNote = async () => {
    await api.employees.update(emp.id, { notes });
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 1500);
  };

  const open = tasks.filter((t) => t.status !== 'DONE');

  return (
    <div>
      <div className="page-head">
        <h2>
          Кабинет: {emp.name} <span className="badge">{ROLE_LABEL[emp.role]}</span>
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
            <h3>📝 Моя заметочная</h3>
            <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div style={{ marginTop: 8 }}>
              <button className="primary" onClick={saveNote}>
                Сохранить
              </button>{' '}
              {savedNote && <span className="muted">✓ сохранено</span>}
            </div>
          </div>

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
