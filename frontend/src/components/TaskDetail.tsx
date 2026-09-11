import { useEffect, useRef, useState } from 'react';
import { api, Attachment, Task } from '../api';
import { Modal } from '../ui';

export default function TaskDetail({ taskId, onClose, onChanged }: { taskId: number; onClose: () => void; onChanged?: () => void }) {
  const [task, setTask] = useState<Task | null>(null);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [editing, setEditing] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const t = await api.tasks.get(taskId);
    setTask(t);
    setDescDraft(t.description || '');
    setAtts(await api.attachments.list(taskId));
  };
  useEffect(() => {
    load();
  }, [taskId]);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const saveDesc = async () => {
    setErr(null);
    try {
      await api.tasks.updateDescription(taskId, descDraft);
      setEditing(false);
      load();
      onChanged?.();
    } catch (e: any) {
      setErr(e.message || 'Не удалось сохранить');
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    setUploading(true);
    try {
      for (const f of Array.from(files)) await api.attachments.upload(taskId, f);
      setAtts(await api.attachments.list(taskId));
    } catch (e: any) {
      setErr(e.message || 'Ошибка загрузки');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const del = async (id: number) => {
    if (!confirm('Удалить вложение?')) return;
    await api.attachments.remove(id);
    setAtts(await api.attachments.list(taskId));
  };

  if (!task) return null;

  return (
    <Modal title={`Задача #${task.id}`} onClose={onClose}>
      {err && <div className="alert">{err}</div>}

      <div
        className="copyable"
        title="Клик — скопировать"
        onClick={() => copy(task.title)}
        style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}
      >
        {task.title}
      </div>

      <div className="flex-between" style={{ marginBottom: 4 }}>
        <label style={{ margin: 0 }}>Описание {copied && <span style={{ color: 'var(--ok)' }}>· скопировано</span>}</label>
        {!editing && (
          <button className="sm" onClick={() => setEditing(true)}>
            ✏️ Изменить
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea rows={5} value={descDraft} onChange={(e) => setDescDraft(e.target.value)} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="primary sm" onClick={saveDesc}>
              Сохранить
            </button>
            <button className="sm" onClick={() => { setEditing(false); setDescDraft(task.description || ''); }}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div
          className="copyable"
          title="Клик — скопировать текст"
          onClick={() => task.description && copy(task.description)}
          style={{ whiteSpace: 'pre-wrap', minHeight: 24, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}
        >
          {task.description || <span className="muted">Нет описания</span>}
        </div>
      )}

      <div className="flex-between" style={{ margin: '16px 0 6px' }}>
        <label style={{ margin: 0 }}>📎 Вложения ({atts.length})</label>
        <div>
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => upload(e.target.files)}
          />
          <button className="sm primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Загрузка…' : '+ Файл / фото'}
          </button>
        </div>
      </div>
      {atts.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Вложений нет.</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {atts.map((a) => (
          <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 6, width: 120 }}>
            <a href={a.url} target="_blank" rel="noreferrer">
              {a.isImage ? (
                <img src={a.url} alt={a.filename} style={{ width: '100%', height: 72, objectFit: 'cover', borderRadius: 4 }} />
              ) : (
                <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>📄</div>
              )}
            </a>
            <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.filename}>
              {a.filename}
            </div>
            <button className="sm danger" style={{ width: '100%', marginTop: 4 }} onClick={() => del(a.id)}>
              🗑
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
