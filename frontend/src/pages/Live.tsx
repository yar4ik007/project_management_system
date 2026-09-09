import { useEffect, useRef, useState } from 'react';
import { api, Task, Tracking } from '../api';
import { TASK_STATUS_COLOR } from '../ui';

function fmt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function Live() {
  const [trackings, setTrackings] = useState<Tracking[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const fetchedAt = useRef(Date.now());
  const [, force] = useState(0);

  const load = async () => {
    setTrackings(await api.tracking.active());
    setTasks(await api.tasks.list());
    fetchedAt.current = Date.now();
  };

  useEffect(() => {
    load();
    const poll = setInterval(load, 5000); // перечитываем каждые 5с
    const tick = setInterval(() => force((n) => n + 1), 1000); // тикаем секундами
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const liveNow = (t: Tracking) => {
    if (t.state !== 'RUNNING') return t.liveSec;
    return t.liveSec + Math.floor((Date.now() - fetchedAt.current) / 1000);
  };

  const running = trackings.filter((t) => t.state === 'RUNNING');
  const paused = trackings.filter((t) => t.state === 'PAUSED');
  const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS');

  const act = async (fn: 'pause' | 'stop' | 'start', t: Tracking) => {
    await api.tracking[fn](t.taskId, t.employeeId);
    load();
  };

  return (
    <div>
      <div className="page-head">
        <h2>Сейчас в работе</h2>
        <span className="muted">🟢 трекается: {running.length} · ⏸ пауза: {paused.length}</span>
      </div>

      <div className="card">
        <h3>Живой трекинг времени</h3>
        {trackings.length === 0 && <p className="muted">Сейчас никто не трекает время.</p>}
        {trackings.map((t) => {
          const spent = t.task?.spentHours ?? 0;
          const est = t.task?.estimateHours ?? 0;
          return (
            <div
              key={t.id}
              className="flex-between"
              style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 20 }}>{t.state === 'RUNNING' ? '🟢' : '⏸'}</span>
                <div>
                  <b>{t.employee?.name}</b>
                  <div className="muted" style={{ fontSize: 13 }}>
                    <span className="tag" style={{ background: t.task?.project?.color }}>
                      {t.task?.project?.code}
                    </span>{' '}
                    {t.task?.title}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700 }}>
                    {fmt(liveNow(t))}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    факт {spent} ч / план {est} ч
                  </div>
                </div>
                {t.state === 'RUNNING' ? (
                  <button className="sm" onClick={() => act('pause', t)}>
                    ⏸ Пауза
                  </button>
                ) : (
                  <button className="sm primary" onClick={() => act('start', t)}>
                    ▶️ Продолжить
                  </button>
                )}
                <button className="sm danger" onClick={() => act('stop', t)}>
                  ⏹ Стоп
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Задачи в работе ({inProgress.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Задача</th>
              <th>Проект</th>
              <th>Исполнитель</th>
              <th>План</th>
              <th>Факт</th>
              <th style={{ width: 160 }}>Прогресс</th>
            </tr>
          </thead>
          <tbody>
            {inProgress.map((t) => {
              const pct = t.estimateHours ? Math.min(100, Math.round(((t.spentHours || 0) / t.estimateHours) * 100)) : 0;
              const over = (t.spentHours || 0) > t.estimateHours && t.estimateHours > 0;
              return (
                <tr key={t.id}>
                  <td>
                    <span className="tag" style={{ background: TASK_STATUS_COLOR[t.status] }}>
                      P{t.priorityRank}
                    </span>{' '}
                    {t.title}
                  </td>
                  <td>
                    <span className="tag" style={{ background: t.project?.color }}>
                      {t.project?.code}
                    </span>
                  </td>
                  <td>{t.assignee?.name || '—'}</td>
                  <td>{t.estimateHours} ч</td>
                  <td>{t.spentHours || 0} ч</td>
                  <td>
                    <div className="bar">
                      <span style={{ width: `${pct}%`, background: over ? 'var(--danger)' : 'var(--primary)' }} />
                    </div>
                    <small className="muted">{pct}%{over ? ' · перерасход' : ''}</small>
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
