import { useEffect, useMemo, useState } from 'react';
import { api, Absence, AbsenceType, Assignment, Employee, Task, ABSENCE_LABEL } from '../api';
import { Modal, mondayOf, ymd, fmtTime } from '../ui';

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export default function Calendar() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [slotModal, setSlotModal] = useState<{ employee: Employee; day: Date } | null>(null);
  const [absModal, setAbsModal] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 864e5)),
    [weekStart],
  );
  const weekEnd = new Date(weekStart.getTime() + 7 * 864e5);

  const load = async () => {
    const from = weekStart.toISOString();
    const to = weekEnd.toISOString();
    setAssignments(await api.assignments.list(from, to));
    setAbsences(await api.absences.list(from, to));
  };
  useEffect(() => {
    api.employees.list().then(setEmployees);
    api.tasks.list().then(setTasks);
  }, []);
  useEffect(() => {
    load();
  }, [weekStart]);

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
          <button onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 864e5))}>← Неделя</button>
          <button onClick={() => setWeekStart(mondayOf(new Date()))}>Сегодня</button>
          <button onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 864e5))}>Неделя →</button>
          <button className="primary" onClick={() => setAbsModal(true)}>
            + Отпуск
          </button>
        </div>
      </div>

      <p className="muted">
        Неделя {days[0].toLocaleDateString('ru-RU')} — {days[6].toLocaleDateString('ru-RU')}. Нажмите на ячейку, чтобы
        запланировать задачу. Конфликты слотов и отпуска подсвечиваются при добавлении.
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
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (confirm(`Удалить слот «${s.task?.title}»?`)) api.assignments.remove(s.id).then(load);
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

      {slotModal && (
        <SlotModal
          employee={slotModal.employee}
          day={slotModal.day}
          tasks={tasks}
          onClose={() => setSlotModal(null)}
          onSaved={() => {
            setSlotModal(null);
            load();
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

function SlotModal({
  employee,
  day,
  tasks,
  onClose,
  onSaved,
}: {
  employee: Employee;
  day: Date;
  tasks: Task[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [taskId, setTaskId] = useState<number>(0);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('14:00');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<any>(null);

  const build = () => {
    const mk = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    return { startAt: mk(start), endAt: mk(end) };
  };

  const submit = async (force: boolean) => {
    setError(null);
    if (!taskId) {
      setError('Выберите задачу');
      return;
    }
    const { startAt, endAt } = build();
    try {
      await api.assignments.create({ employeeId: employee.id, taskId, startAt, endAt }, force);
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
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              [{t.project?.code}] {t.title}
            </option>
          ))}
        </select>
      </div>
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
          Запланировать
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
