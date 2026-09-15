import { useEffect, useMemo, useRef, useState } from 'react';
import { api, Absence, AbsenceType, Assignment, Employee, Project, Task, ABSENCE_LABEL } from '../api';
import { Modal, mondayOf, ymd, fmtTime, confirmAction } from '../ui';

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export default function Calendar() {
  const [mode, setMode] = useState<'week' | 'day'>('week');
  const [dayDate, setDayDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [slotModal, setSlotModal] = useState<{ employee: Employee; day: Date } | null>(null);
  const [absModal, setAbsModal] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 864e5)),
    [weekStart],
  );
  const weekEnd = new Date(weekStart.getTime() + 7 * 864e5);

  const dayEnd = new Date(dayDate.getTime() + 864e5);
  const load = async () => {
    const from = (mode === 'week' ? weekStart : dayDate).toISOString();
    const to = (mode === 'week' ? weekEnd : dayEnd).toISOString();
    setAssignments(await api.assignments.list(from, to));
    setAbsences(await api.absences.list(from, to));
  };
  useEffect(() => {
    api.employees.list().then(setEmployees);
    api.tasks.list().then(setTasks);
    api.projects.list().then(setProjects);
  }, []);
  useEffect(() => {
    load();
  }, [weekStart, dayDate, mode]);

  const slotsFor = (empId: number, day: Date) =>
    assignments.filter((a) => a.employeeId === empId && ymd(new Date(a.startAt)) === ymd(day));

  const absenceFor = (empId: number, day: Date) =>
    absences.find(
      (a) =>
        a.employeeId === empId &&
        ymd(new Date(a.startDate)) <= ymd(day) &&
        ymd(new Date(a.endDate)) >= ymd(day),
    );

  return (
    <div>
      <div className="page-head">
        <h2>Календарь планирования</h2>
        <div className="row">
          <div className="toggle">
            <button className={mode === 'week' ? 'primary' : ''} onClick={() => setMode('week')}>
              Неделя
            </button>
            <button className={mode === 'day' ? 'primary' : ''} onClick={() => setMode('day')}>
              День
            </button>
          </div>
          {mode === 'week' ? (
            <>
              <button onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 864e5))}>←</button>
              <button onClick={() => setWeekStart(mondayOf(new Date()))}>Эта неделя</button>
              <button onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 864e5))}>→</button>
            </>
          ) : (
            <>
              <button onClick={() => setDayDate(new Date(dayDate.getTime() - 864e5))}>←</button>
              <button
                onClick={() => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  setDayDate(d);
                }}
              >
                Сегодня
              </button>
              <button onClick={() => setDayDate(new Date(dayDate.getTime() + 864e5))}>→</button>
            </>
          )}
          <button className="primary" onClick={() => setAbsModal(true)}>
            + Отпуск
          </button>
        </div>
      </div>

      {mode === 'day' ? (
        <DayView
          date={dayDate}
          employees={employees.filter((e) => e.active)}
          assignments={assignments}
          absences={absences}
          tasks={tasks}
          onCreate={(employee, day) => setSlotModal({ employee, day })}
          onReload={load}
        />
      ) : (
        <>
          <p className="muted">
            Неделя {days[0].toLocaleDateString('ru-RU')} — {days[6].toLocaleDateString('ru-RU')}. Нажмите на ячейку,
            чтобы запланировать задачу. Конфликты слотов и отпуска подсвечиваются при добавлении.
          </p>

          <div className="cal">
        <div className="cal-head">
          <div>Сотрудник</div>
          {days.map((d, i) => (
            <div key={i}>
              {DAY_NAMES[i]} {d.getDate()}.{String(d.getMonth() + 1).padStart(2, '0')}
            </div>
          ))}
        </div>
        {employees
          .filter((e) => e.active)
          .map((e) => (
            <div className="cal-row" key={e.id}>
              <div className="cal-name">
                {e.name}
                <small className="muted">{e.position}</small>
              </div>
              {days.map((d, i) => {
                const abs = absenceFor(e.id, d);
                const slots = slotsFor(e.id, d);
                const weekend = i >= 5;
                return (
                  <div
                    key={i}
                    className={`cal-cell ${weekend ? 'weekend' : ''}`}
                    onClick={() => setSlotModal({ employee: e, day: d })}
                  >
                    {abs && <div className="absence">🌴 {ABSENCE_LABEL[abs.type]}</div>}
                    {slots.map((s) => (
                      <div
                        key={s.id}
                        className="slot"
                        style={{ background: s.task?.project?.color || '#3b82f6' }}
                        title={s.task?.title}
                        onClick={async (ev) => {
                          ev.stopPropagation();
                          if (!(await confirmAction(`Удалить слот «${s.task?.title}»?`, { danger: true, confirmText: 'Удалить' }))) return;
                          api.assignments.remove(s.id).then(load);
                        }}
                      >
                        {fmtTime(s.startAt)}–{fmtTime(s.endAt)}
                        <br />
                        <small>{s.task?.title}</small>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
          </div>
        </>
      )}

      {slotModal && (
        <SlotModal
          employee={slotModal.employee}
          day={slotModal.day}
          existingSlots={slotsFor(slotModal.employee.id, slotModal.day)}
          tasks={tasks}
          projects={projects}
          onClose={() => setSlotModal(null)}
          onSaved={() => {
            setSlotModal(null);
            load();
            api.tasks.list().then(setTasks);
          }}
        />
      )}

      {absModal && (
        <AbsenceModal
          employees={employees}
          onClose={() => setAbsModal(false)}
          onSaved={() => {
            setAbsModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}

const HOUR_START = 8;
const HOUR_END = 21;
const ROW_H = 48; // px на час

function DayView({
  date,
  employees,
  assignments,
  absences,
  onCreate,
  onReload,
}: {
  date: Date;
  employees: Employee[];
  assignments: Assignment[];
  absences: Absence[];
  tasks: Task[];
  onCreate: (employee: Employee, day: Date) => void;
  onReload: () => void;
}) {
  const drag = useRef<{ id: number; durationMin: number; grabY: number } | null>(null);
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

  const slotsFor = (empId: number) =>
    assignments.filter((a) => a.employeeId === empId && ymd(new Date(a.startAt)) === ymd(date));
  const absenceFor = (empId: number) =>
    absences.find(
      (a) => a.employeeId === empId && ymd(new Date(a.startDate)) <= ymd(date) && ymd(new Date(a.endDate)) >= ymd(date),
    );

  const onDrop = async (e: React.DragEvent, employee: Employee) => {
    e.preventDefault();
    const d = drag.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top - d.grabY;
    let startMin = HOUR_START * 60 + Math.round((y / ROW_H) * 60 / 15) * 15; // шаг 15 мин
    startMin = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - d.durationMin, startMin));
    const startAt = new Date(date);
    startAt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    const endAt = new Date(startAt.getTime() + d.durationMin * 60000);
    drag.current = null;
    try {
      await api.assignments.update(d.id, { employeeId: employee.id, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
      onReload();
    } catch (err: any) {
      if (err.status === 409 && (await confirmAction('Слот пересекается с другим/отпуском. Всё равно перенести?', { danger: true, confirmText: 'Перенести' }))) {
        await api.assignments.update(d.id, { employeeId: employee.id, startAt: startAt.toISOString(), endAt: endAt.toISOString() }, true);
        onReload();
      }
    }
  };

  return (
    <div>
      <p className="muted">
        {date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}. Перетаскивайте блоки по
        часам и между сотрудниками. Клик по пустому месту — добавить задачу. Клик по блоку — удалить.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${employees.length}, minmax(150px, 1fr))`, minWidth: 'fit-content' }}>
          {/* Заголовки */}
          <div style={{ borderBottom: '1px solid var(--border)' }} />
          {employees.map((e) => (
            <div key={e.id} style={{ borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)', padding: '6px 8px', fontWeight: 600, fontSize: 13, background: '#f8fafc' }}>
              {e.name}
              {absenceFor(e.id) && <span className="muted"> · 🌴</span>}
            </div>
          ))}

          {/* Колонка часов */}
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: ROW_H, fontSize: 11, color: 'var(--muted)', textAlign: 'right', paddingRight: 6, borderTop: '1px solid var(--border)' }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Колонки сотрудников */}
          {employees.map((e) => {
            const abs = absenceFor(e.id);
            return (
              <div
                key={e.id}
                onDragOver={(ev) => ev.preventDefault()}
                onDrop={(ev) => onDrop(ev, e)}
                onClick={() => onCreate(e, date)}
                style={{
                  position: 'relative',
                  height: (HOUR_END - HOUR_START) * ROW_H,
                  borderLeft: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: abs
                    ? 'repeating-linear-gradient(45deg,#fef9c3,#fef9c3 6px,#fef08a 6px,#fef08a 12px)'
                    : `repeating-linear-gradient(#fff,#fff ${ROW_H - 1}px,var(--border) ${ROW_H - 1}px,var(--border) ${ROW_H}px)`,
                }}
              >
                {slotsFor(e.id).map((s) => {
                  const start = new Date(s.startAt);
                  const end = new Date(s.endAt);
                  const startMin = start.getHours() * 60 + start.getMinutes();
                  const durationMin = (end.getTime() - start.getTime()) / 60000;
                  const top = ((startMin - HOUR_START * 60) / 60) * ROW_H;
                  const height = Math.max(20, (durationMin / 60) * ROW_H);
                  return (
                    <div
                      key={s.id}
                      draggable
                      onDragStart={(ev) => {
                        drag.current = { id: s.id, durationMin, grabY: ev.nativeEvent.offsetY };
                      }}
                      onClick={async (ev) => {
                        ev.stopPropagation();
                        if (!(await confirmAction(`Удалить слот «${s.task?.title}»?`, { danger: true, confirmText: 'Удалить' }))) return;
                        api.assignments.remove(s.id).then(onReload);
                      }}
                      className="slot"
                      style={{
                        position: 'absolute',
                        top,
                        height,
                        left: 4,
                        right: 4,
                        background: s.task?.project?.color || '#3b82f6',
                        overflow: 'hidden',
                        cursor: 'grab',
                      }}
                      title={`${fmtTime(s.startAt)}–${fmtTime(s.endAt)} · ${s.task?.title}`}
                    >
                      {fmtTime(s.startAt)}–{fmtTime(s.endAt)}
                      <br />
                      <small>{s.task?.title}</small>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SlotModal({
  employee,
  day,
  existingSlots,
  tasks,
  projects,
  onClose,
  onSaved,
}: {
  employee: Employee;
  day: Date;
  existingSlots: Assignment[];
  tasks: Task[];
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Дефолтное время: после последнего слота сотрудника в этот день (чтобы вторую
  // задачу можно было запланировать без пересечения). Если слотов нет — 10:00–14:00.
  const [defStart, defEnd] = (() => {
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const lastEnd = existingSlots.reduce<Date | null>((max, s) => {
      const e = new Date(s.endAt);
      return !max || e > max ? e : max;
    }, null);
    if (!lastEnd || lastEnd.getHours() >= 20) return ['10:00', '14:00'];
    const s = new Date(lastEnd);
    const e = new Date(lastEnd.getTime() + 4 * 3600000);
    return [hhmm(s), e.getDate() === s.getDate() ? hhmm(e) : '23:59'];
  })();

  // taskId: 0 — не выбрано, -1 — «новая задача», >0 — существующая
  const [taskId, setTaskId] = useState<number>(0);
  const [newTitle, setNewTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState<number>(projects[0]?.id || 0);
  const [start, setStart] = useState(defStart);
  const [end, setEnd] = useState(defEnd);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<any>(null);

  const isNew = taskId === -1;

  const build = () => {
    const mk = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    return { startAt: mk(start), endAt: mk(end) };
  };
  const durationHours = () => {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    return Math.max(0, Math.round(((h2 * 60 + m2 - (h1 * 60 + m1)) / 60) * 10) / 10);
  };

  const submit = async (force: boolean) => {
    setError(null);
    let realTaskId = taskId;
    // Валидация перед подтверждением
    if (isNew) {
      if (!newTitle.trim()) {
        setError('Введите название задачи');
        return;
      }
      if (!newProjectId) {
        setError('Выберите проект');
        return;
      }
    } else if (!taskId) {
      setError('Выберите задачу или создайте новую');
      return;
    }
    if (!(await confirmAction(isNew ? `Создать задачу «${newTitle.trim()}» и запланировать?` : 'Запланировать задачу в этот слот?', { confirmText: isNew ? 'Создать' : 'Запланировать' }))) return;
    // Создание новой задачи прямо из календаря
    if (isNew) {
      try {
        const t = await api.tasks.create({
          projectId: newProjectId,
          title: newTitle.trim(),
          assigneeId: employee.id,
          estimateHours: durationHours(),
          status: 'IN_PROGRESS',
        });
        realTaskId = t.id;
      } catch (e: any) {
        setError(e.message || 'Не удалось создать задачу');
        return;
      }
    }
    const { startAt, endAt } = build();
    try {
      await api.assignments.create({ employeeId: employee.id, taskId: realTaskId, startAt, endAt }, force);
      onSaved();
    } catch (e: any) {
      if (e.status === 409) {
        setConflict(e.body);
        setError(e.body?.message || 'Слот занят');
      } else {
        setError(e.message || 'Ошибка');
      }
    }
  };

  return (
    <Modal title={`План: ${employee.name} · ${day.toLocaleDateString('ru-RU')}`} onClose={onClose}>
      {error && <div className="alert">{error}</div>}
      {conflict && (
        <div className="alert">
          {conflict.overlapping?.length > 0 && (
            <div>
              Пересекается с: {conflict.overlapping.map((o: any) => `${o.task?.title} (${fmtTime(o.startAt)}–${fmtTime(o.endAt)})`).join(', ')}
            </div>
          )}
          {conflict.absences?.length > 0 && <div>Сотрудник в отпуске/отсутствует в эти дни.</div>}
        </div>
      )}
      <div className="field">
        <label>Задача</label>
        <select value={taskId} onChange={(e) => setTaskId(Number(e.target.value))}>
          <option value={0}>— выберите —</option>
          <option value={-1}>➕ Новая задача…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              [{t.project?.code}] {t.title}
            </option>
          ))}
        </select>
      </div>
      {isNew && (
        <div className="card" style={{ background: '#f8fafc', margin: 0, marginBottom: 12 }}>
          <div className="field">
            <label>Название новой задачи</label>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Что нужно сделать" autoFocus />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Проект</label>
            <select value={newProjectId} onChange={(e) => setNewProjectId(Number(e.target.value))}>
              <option value={0}>— выберите проект —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.code}] {p.name}
                </option>
              ))}
            </select>
          </div>
          <small className="muted">
            Задача создастся на «{employee.name}», оценка — {durationHours()} ч (по длине слота).
          </small>
        </div>
      )}
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Начало</label>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Конец</label>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <button className="primary" onClick={() => submit(false)}>
          {isNew ? 'Создать и запланировать' : 'Запланировать'}
        </button>
        {conflict && (
          <button className="danger" onClick={() => submit(true)}>
            Всё равно создать
          </button>
        )}
      </div>
    </Modal>
  );
}

function AbsenceModal({
  employees,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState<number>(employees[0]?.id || 0);
  const [type, setType] = useState<AbsenceType>('VACATION');
  const [startDate, setStartDate] = useState(ymd(new Date()));
  const [endDate, setEndDate] = useState(ymd(new Date()));
  const [note, setNote] = useState('');

  const save = async () => {
    if (!(await confirmAction('Сохранить отпуск / отсутствие?', { confirmText: 'Сохранить' }))) return;
    await api.absences.create({ employeeId, type, startDate, endDate, note });
    onSaved();
  };

  return (
    <Modal title="Отпуск / отсутствие" onClose={onClose}>
      <div className="field">
        <label>Сотрудник</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
          {employees.map((em) => (
            <option key={em.id} value={em.id}>
              {em.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Тип</label>
        <select value={type} onChange={(e) => setType(e.target.value as AbsenceType)}>
          {(Object.keys(ABSENCE_LABEL) as AbsenceType[]).map((t) => (
            <option key={t} value={t}>
              {ABSENCE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>С</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>По</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Комментарий</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button className="primary" onClick={save}>
        Сохранить
      </button>
    </Modal>
  );
}
