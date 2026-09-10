import { useEffect, useState } from 'react';
import { api, Worklog } from '../api';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ddmm = (s: string) => {
  const [, m, d] = s.split('-');
  return `${d}.${m}`;
};

// Блок аналитики отработанного времени — встраивается в Дашборд.
export default function WorklogCharts() {
  const [data, setData] = useState<Worklog | null>(null);
  const today = new Date();
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 13 * 864e5)));
  const [to, setTo] = useState(ymd(today));

  useEffect(() => {
    api.dashboard.worklog(new Date(from).toISOString(), new Date(to + 'T23:59:59').toISOString()).then(setData);
  }, [from, to]);

  return (
    <div className="card">
      <div className="flex-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Отработанное время</h3>
        <div className="row" style={{ margin: 0 }}>
          <div>
            <label>С</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label>По</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      {!data ? (
        <div className="muted">Загрузка…</div>
      ) : data.employees.length === 0 ? (
        <div className="muted">За выбранный период отработанных часов нет.</div>
      ) : (
        <>
          <Legend employees={data.employees} />
          <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>Отработано по дням (часы)</div>
          <LineChart data={data} />
          <div style={{ fontWeight: 600, margin: '20px 0 4px' }}>Всего за период по сотрудникам (часы)</div>
          <BarChart data={data} />
        </>
      )}
    </div>
  );
}

function Legend({ employees }: { employees: Worklog['employees'] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '4px 0 8px' }}>
      {employees.map((e) => (
        <span key={e.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <i style={{ width: 12, height: 12, borderRadius: 3, background: e.color, display: 'inline-block' }} />
          {e.name} <span className="muted">· {e.total} ч</span>
        </span>
      ))}
    </div>
  );
}

// Умножаем на «красивый» максимум по оси Y.
function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function LineChart({ data }: { data: Worklog }) {
  const W = 820,
    H = 340,
    padL = 44,
    padR = 16,
    padT = 14,
    padB = 54;
  const iw = W - padL - padR,
    ih = H - padT - padB;
  const n = data.days.length;
  const maxV = niceMax(Math.max(1, ...data.employees.flatMap((e) => e.perDay)));
  const xOf = (i: number) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yOf = (v: number) => padT + ih - (v / maxV) * ih;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * maxV * 100) / 100);
  const xStep = Math.max(1, Math.ceil(n / 12)); // не больше ~12 подписей

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {/* сетка + ось Y */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(v)} y2={yOf(v)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={padL - 6} y={yOf(v) + 4} textAnchor="end" fontSize="11" fill="#64748b">
            {v}
          </text>
        </g>
      ))}
      {/* подписи X */}
      {data.days.map((d, i) =>
        i % xStep === 0 ? (
          <text key={i} x={xOf(i)} y={H - padB + 18} textAnchor="middle" fontSize="10" fill="#64748b">
            {ddmm(d)}
          </text>
        ) : null,
      )}
      {/* линии сотрудников */}
      {data.employees.map((e) => {
        const path = e.perDay.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(v)}`).join(' ');
        return (
          <g key={e.id}>
            <path d={path} fill="none" stroke={e.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {n <= 40 &&
              e.perDay.map((v, i) => (
                <circle key={i} cx={xOf(i)} cy={yOf(v)} r={n < 20 ? 3 : 2} fill="#fff" stroke={e.color} strokeWidth="1.6" />
              ))}
          </g>
        );
      })}
    </svg>
  );
}

function BarChart({ data }: { data: Worklog }) {
  const emps = data.employees;
  const W = 820,
    H = 300,
    padL = 44,
    padR = 16,
    padT = 14,
    padB = 70;
  const iw = W - padL - padR,
    ih = H - padT - padB;
  const maxV = niceMax(Math.max(1, ...emps.map((e) => e.total)));
  const slot = iw / emps.length;
  const bw = Math.min(56, slot * 0.6);
  const yOf = (v: number) => padT + ih - (v / maxV) * ih;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * maxV * 100) / 100);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={yOf(v)} y2={yOf(v)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={padL - 6} y={yOf(v) + 4} textAnchor="end" fontSize="11" fill="#64748b">
            {v}
          </text>
        </g>
      ))}
      {emps.map((e, i) => {
        const cx = padL + slot * i + slot / 2;
        return (
          <g key={e.id}>
            <rect x={cx - bw / 2} y={yOf(e.total)} width={bw} height={padT + ih - yOf(e.total)} rx="4" fill={e.color} />
            <text x={cx} y={yOf(e.total) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="#334155">
              {e.total}
            </text>
            <text x={cx} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="#64748b">
              {e.name.length > 12 ? e.name.slice(0, 11) + '…' : e.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
