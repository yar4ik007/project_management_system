import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  api,
  Employee,
  Project,
  Task,
  Tracking,
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
} from '../api';
import { Modal, TASK_STATUS_COLOR, PRIORITY_COLOR, confirmAction } from '../ui';
import TaskDetail from '../components/TaskDetail';
import TaskEditModal from '../components/TaskEditModal';
import WorklogCharts from './Analytics';

export default function ProjectDetail() {
  const { id } = useParams();
  const pid = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [taskEdit, setTaskEdit] = useState<Partial<Task> | null>(null);
  const [logFor, setLogFor] = useState<Task | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [addMember, setAddMember] = useState(false);
  const [trackings, setTrackings] = useState<Tracking[]>([]);

  const load = async () => {
    setProject(await api.projects.get(pid));
    setTasks(await api.tasks.list(pid));
    setTrackings(await api.tracking.active());
  };
  useEffect(() => {
    load();
    api.employees.list().then(setEmployees);
  }, [pid]);

  const trackerFor = (t: Task) =>
    trackings.find((tr) => tr.taskId === t.id && tr.employeeId === t.assigneeId);
  const projectTrackings = trackings.filter((tr) => tr.task?.projectId === pid);
  const track = async (fn: 'start' | 'pause' | 'stop', t: Task) => {
    if (!t.assigneeId) {
      alert('У задачи нет исполнителя — назначьте его, чтобы трекать время.');
      return;
    }
    const msg = { start: 'Начать трекинг времени по задаче?', pause: 'Поставить трекинг на паузу?', stop: 'Остановить трекинг и записать время?' }[fn];
    if (!(await confirmAction(msg, fn === 'stop' ? { danger: true } : {}))) return;
    await api.tracking[fn](t.id, t.assigneeId);
    load();
  };

  if (!project) return <div>Загрузка…</div>;

  const memberIds = new Set(project.members?.map((m) => m.employee.id));

  return (
    <div>
      <div className="page-head">
        <div>
          <Link to="/projects" className="muted">
            ← Проекты
          </Link>
          <h2>
            <span className="tag" style={{ background: project.color }}>
              {project.code}
            </span>{' '}
            {project.name}
          </h2>
        </div>
        <button
          className="primary"
          onClick={() => setTaskEdit({ status: 'TODO', priority: 'MEDIUM', priorityRank: 100, estimateHours: 0, title: '' })}
        >
          + Задача
        </button>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="flex-between">
            <h3>Команда проекта ({project.members?.length || 0})</h3>
            <button className="sm" onClick={() => setAddMember(true)}>
              + Участник
            </button>
          </div>
          <table>
            <tbody>
              {project.members?.map((m) => (
                <tr key={m.id}>
                  <td>{m.employee.name}</td>
                  <td className="muted">{m.roleOnProject || ''}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="sm danger"
                      onClick={async () => {
                        if (!(await confirmAction(`Убрать ${m.employee.name} из проекта?`, { danger: true, confirmText: 'Убрать' }))) return;
                        await api.projects.removeMember(pid, m.employee.id);
                        load();
                      }}
                    >
                      Убрать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Сводка</h3>
          <p>Всего задач: {tasks.length}</p>
          <p>Оценка: {tasks.reduce((s, t) => s + t.estimateHours, 0)} ч</p>
          <p>Факт: {tasks.reduce((s, t) => s + (t.spentHours || 0), 0)} ч</p>
          <p>Готово: {tasks.filter((t) => t.status === 'DONE').length}</p>
        </div>
      </div>

      <div className="card">
        <h3>Задачи</h3>
        <table>
          <thead>
            <tr>
              <th>Задача</th>
              <th>Статус</th>
              <th>Приоритет</th>
              <th>Исполнитель</th>
              <th>Автор</th>
              <th>Прогресс (факт/оценка)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const pct = t.estimateHours ? Math.min(100, Math.round(((t.spentHours || 0) / t.estimateHours) * 100)) : 0;
              const over = (t.spentHours || 0) > t.estimateHours && t.estimateHours > 0;
              return (
                <tr key={t.id}>
                  <td>
                    <span className="badge" title="Приоритет: меньше — важнее">
                      P{t.priorityRank}
                    </span>{' '}
                    <span style={{ cursor: 'pointer' }} onClick={() => setDetailId(t.id)} title="Открыть: описание и вложения">
                      {t.title}
                    </span>
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
                  <td style={{ minWidth: 160 }}>
                    <div className="bar">
                      <span style={{ width: `${pct}%`, background: over ? 'var(--danger)' : 'var(--primary)' }} />
                    </div>
                    <small className="muted">
                      {t.spentHours || 0} / {t.estimateHours} ч {over ? '· перерасход' : ''}
                    </small>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {(() => {
                      const tr = trackerFor(t);
                      if (tr?.state === 'RUNNING')
                        return (
                          <>
                            <button className="sm" title="Пауза" onClick={() => track('pause', t)}>
                              ⏸
                            </button>{' '}
                            <button className="sm danger" title="Стоп (записать время)" onClick={() => track('stop', t)}>
                              ⏹
                            </button>{' '}
                          </>
                        );
                      return (
                        <button
                          className="sm primary"
                          title={tr ? 'Продолжить' : 'Старт трекинга'}
                          onClick={() => track('start', t)}
                        >
                          ▶️
                        </button>
                      );
                    })()}{' '}
                    <button className="sm" onClick={() => setLogFor(t)}>
                      ⏱ Лог
                    </button>{' '}
                    <button className="sm" onClick={() => setTaskEdit(t)}>
                      Изм.
                    </button>{' '}
                    <button
                      className="sm danger"
                      onClick={async () => {
                        if (await confirmAction(`Удалить задачу «${t.title}»?`, { danger: true, confirmText: 'Удалить' })) {
                          await api.tasks.remove(t.id);
                          load();
                        }
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>🟢 Сейчас в работе по проекту</h3>
        {projectTrackings.length === 0 && <p className="muted">Никто сейчас не трекает время по проекту.</p>}
        {projectTrackings.map((tr) => (
          <div
            key={tr.id}
            className="flex-between"
            style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}
          >
            <div>
              {tr.state === 'RUNNING' ? '🟢' : '⏸'} <b>{tr.employee?.name}</b> — {tr.task?.title}
            </div>
            <span className="muted">{tr.state === 'RUNNING' ? 'идёт' : 'на паузе'}</span>
          </div>
        ))}
      </div>

      <WorklogCharts projectId={pid} />

      {taskEdit && (
        <TaskEditModal
          task={taskEdit}
          employees={employees}
          projectId={pid}
          onClose={() => setTaskEdit(null)}
          onSaved={load}
        />
      )}

      {logFor && (
        <LogModal task={logFor} employees={employees} onClose={() => setLogFor(null)} onSaved={load} />
      )}

      {detailId && <TaskDetail taskId={detailId} onClose={() => setDetailId(null)} onChanged={load} />}

      {addMember && (
        <Modal title="Добавить участника" onClose={() => setAddMember(false)}>
          <table>
            <tbody>
              {employees
                .filter((e) => !memberIds.has(e.id))
                .map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="sm primary"
                        onClick={async () => {
                          if (!(await confirmAction(`Добавить ${e.name} в проект?`))) return;
                          await api.projects.addMember(pid, e.id, e.position || undefined);
                          await load();
                          setAddMember(false);
                        }}
                      >
                        Добавить
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function LogModal({
  task,
  employees,
  onClose,
  onSaved,
}: {
  task: Task;
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [full, setFull] = useState<Task | null>(null);
  const [employeeId, setEmployeeId] = useState<number>(task.assigneeId || employees[0]?.id || 0);
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');

  const reload = () => api.tasks.get(task.id).then(setFull);
  useEffect(() => {
    reload();
  }, []);

  const add = async () => {
    if (!hours || !employeeId) return;
    if (!(await confirmAction(`Добавить запись ${hours} ч?`))) return;
    await api.tasks.addLog(task.id, { employeeId, hours: Number(hours), note });
    setHours('');
    setNote('');
    reload();
    onSaved();
  };

  return (
    <Modal title={`Таймлоги · ${task.title}`} onClose={onClose}>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Сотрудник</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
            {employees.map((em) => (
              <option key={em.id} value={em.id}>
                {em.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 90 }}>
          <label>Часы</label>
          <input type="number" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Комментарий</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="primary" onClick={add}>
        Добавить запись
      </button>

      <table style={{ marginTop: 16 }}>
        <tbody>
          {full?.timeLogs?.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.date).toLocaleDateString('ru-RU')}</td>
              <td>{l.employee?.name}</td>
              <td>
                <b>{l.hours} ч</b>
              </td>
              <td className="muted">{l.note}</td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="sm danger"
                  onClick={async () => {
                    if (!(await confirmAction(`Удалить запись ${l.hours} ч?`, { danger: true, confirmText: 'Удалить' }))) return;
                    await api.tasks.removeLog(l.id);
                    reload();
                    onSaved();
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
