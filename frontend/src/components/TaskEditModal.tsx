import { useState } from 'react';
import {
  api,
  Employee,
  Task,
  TaskPriority,
  TaskStatus,
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
} from '../api';
import { Modal, confirmAction } from '../ui';

// Единая модалка создания/редактирования задачи. Используется и на странице проекта,
// и в разделе «Все задачи». Сохранение проходит через попап-подтверждение, ошибки видны.
export default function TaskEditModal({
  task,
  employees,
  projectId,
  onClose,
  onSaved,
}: {
  task: Partial<Task>;
  employees: Employee[];
  projectId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Partial<Task>>(task);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft.title) {
      setErr('Укажите название задачи');
      return;
    }
    if (!(await confirmAction(draft.id ? 'Сохранить изменения задачи?' : 'Создать задачу?'))) return;
    setErr(null);
    setSaving(true);
    try {
      const payload = { ...draft, projectId, estimateHours: Number(draft.estimateHours) || 0 };
      if (draft.id) await api.tasks.update(draft.id, payload);
      else await api.tasks.create(payload);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Не удалось сохранить задачу');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={draft.id ? 'Редактировать задачу' : 'Новая задача'} onClose={onClose}>
      {err && <div className="alert">{err}</div>}
      <div className="field">
        <label>Название</label>
        <input value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Статус</label>
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}
          >
            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Приоритет</label>
          <select
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}
          >
            {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Исполнитель</label>
          <select
            value={draft.assigneeId ?? ''}
            onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">—</option>
            {employees.map((em) => (
              <option key={em.id} value={em.id}>
                {em.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>Оценка, ч</label>
          <input
            type="number"
            value={draft.estimateHours ?? 0}
            onChange={(e) => setDraft({ ...draft, estimateHours: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="field" style={{ width: 200 }}>
        <label>Приоритет № (меньше — важнее)</label>
        <input
          type="number"
          value={draft.priorityRank ?? 100}
          onChange={(e) => setDraft({ ...draft, priorityRank: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>Описание</label>
        <textarea
          value={draft.description || ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </div>
      <button className="primary" disabled={saving} onClick={save}>
        {saving ? 'Сохранение…' : 'Сохранить'}
      </button>
    </Modal>
  );
}
