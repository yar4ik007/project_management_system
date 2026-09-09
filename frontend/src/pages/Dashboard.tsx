import { useEffect, useState } from 'react';
import { api, Capacity, ROLE_LABEL } from '../api';
import { fmtDate } from '../ui';

function utilColor(u: number) {
  if (u > 100) return '#ef4444';
  if (u > 85) return '#f59e0b';
  if (u < 40) return '#94a3b8';
  return '#10b981';
}

export default function Dashboard() {
  const [data, setData] = useState<Capacity | null>(null);
  const [weeks, setWeeks] = useState(4);

  const load = (w: number) => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + w * 7 * 864e5);
    api.dashboard
      .capacity(from.toISOString(), to.toISOString())
      .then(setData)
      .catch((e) => console.error(e));
  };

  useEffect(() => load(weeks), [weeks]);

  if (!data) return <div>Загрузка…</div>;
  const s = data.summary;

  return (
    <div>
      <div className="page-head">
        <h2>Дашборд ресурсов</h2>
        <div className="row">
          <div>
            <label>Горизонт планирования</label>
            <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={{ width: 160 }}>
              <option value={1}>1 неделя</option>
              <option value={2}>2 недели</option>
              <option value={4}>4 недели</option>
              <option value={8}>8 недель</option>
              <option value={12}>12 недель</option>
            </select>
          </div>
        </div>
      </div>

      <p className="muted">
        Период: {fmtDate(data.range.from)} — {fmtDate(data.range.to)} · рабочих дней: {data.range.workdays}
      </p>

      <div className="grid grid-4">
        <div className="card">
          <div className="stat-label">Ёмкость команды</div>
          <div className="stat">{s.totalCapacityHours} ч</div>
        </div>
        <div className="card">
          <div className="stat-label">Запланировано</div>
          <div className="stat">{s.totalPlannedHours} ч</div>
        </div>
        <div className="card">
          <div className="stat-label">Свободно</div>
          <div className="stat">{s.freeCapacityHours} ч</div>
        </div>
        <div className="card" style={{ background: s.adequate ? '#f0fdf4' : '#fef2f2' }}>
          <div className="stat-label">Остаток работ / ресурс</div>
          <div className="stat" style={{ color: s.adequate ? 'var(--ok)' : 'var(--danger)' }}>
            {s.totalRemainingHours} ч
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {s.adequate ? '✓ Ресурсов хватает' : `⚠ Дефицит ${s.deficitHours} ч — нужны люди`}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Загрузка сотрудников</h3>
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Роль</th>
                <th>План / Ёмкость</th>
                <th style={{ width: 160 }}>Загрузка</th>
              </tr>
            </thead>
            <tbody>
              {data.perEmployee.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.name}
                    {e.vacationDays > 0 && <span className="muted"> · отпуск {e.vacationDays}д</span>}
                  </td>
                  <td>
                    <span className="badge">{ROLE_LABEL[e.role]}</span>
                  </td>
                  <td>
                    {e.plannedHours} / {e.capacityHours} ч
                  </td>
                  <td>
                    <div className="bar">
                      <span style={{ width: `${Math.min(100, e.utilization)}%`, background: utilColor(e.utilization) }} />
                    </div>
                    <small className="muted">{e.utilization}%</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Остаток работ по проектам</h3>
          <table>
            <thead>
              <tr>
                <th>Проект</th>
                <th>Открытых задач</th>
                <th>Оценка</th>
                <th>Факт</th>
                <th>Осталось</th>
              </tr>
            </thead>
            <tbody>
              {data.projectLoad.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="tag" style={{ background: p.color }}>
                      {p.code}
                    </span>{' '}
                    {p.name}
                  </td>
                  <td>{p.openTasks}</td>
                  <td>{p.estimateHours} ч</td>
                  <td>{p.spentHours} ч</td>
                  <td>
                    <b>{p.remainingHours} ч</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
