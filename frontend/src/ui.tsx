import React from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex-between">
          <h3>{title}</h3>
          <button className="sm" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const PROJECT_STATUS_COLOR: Record<string, string> = {
  PLANNED: '#8b5cf6',
  ACTIVE: '#10b981',
  ON_HOLD: '#f59e0b',
  DONE: '#64748b',
  CANCELLED: '#ef4444',
};

export const TASK_STATUS_COLOR: Record<string, string> = {
  TODO: '#64748b',
  IN_PROGRESS: '#3b82f6',
  BLOCKED: '#ef4444',
  REVIEW: '#f59e0b',
  DONE: '#10b981',
};

export const PRIORITY_COLOR: Record<string, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#3b82f6',
  HIGH: '#f59e0b',
  URGENT: '#ef4444',
};

// YYYY-MM-DD в локальной зоне
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mondayOf(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const shift = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - shift);
  return r;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU');
}
