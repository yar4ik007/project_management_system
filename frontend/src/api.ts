const BASE = '/api';

const TOKEN_KEY = 'pms_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (res.status === 401) {
    // Сессия истекла/невалидна — сбрасываем и показываем вход.
    setToken(null);
    window.dispatchEvent(new Event('auth-changed'));
  }
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const err: any = new Error(body?.message || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type Role = 'OPERATOR' | 'MANAGER' | 'DEVELOPER';
export type ProjectStatus = 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'DONE' | 'CANCELLED';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type AbsenceType = 'VACATION' | 'SICK' | 'DAYOFF' | 'OTHER';

export interface Employee {
  id: number;
  name: string;
  email?: string | null;
  role: Role | null;
  position?: string | null;
  weeklyHours: number;
  active: boolean;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
  login?: string | null;
  isAdmin?: boolean;
  twoFactorEnabled?: boolean;
  password?: string; // только для отправки при создании/смене
  members?: { project: Project }[];
}

export interface Note {
  id: number;
  employeeId: number;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  status: ProjectStatus;
  color: string;
  startDate?: string | null;
  dueDate?: string | null;
  botToken?: string | null;
  botUsername?: string | null;
  members?: { id: number; roleOnProject?: string | null; employee: Employee }[];
  stats?: { taskCount: number; doneCount: number; estimateHours: number; spentHours: number };
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  priorityRank: number;
  estimateHours: number;
  assigneeId?: number | null;
  assignee?: Employee | null;
  createdById?: number | null;
  creator?: Employee | null;
  project?: Project;
  dueDate?: string | null;
  spentHours?: number;
  timeLogs?: TimeLog[];
}

export interface TimeLog {
  id: number;
  taskId: number;
  employeeId: number;
  hours: number;
  date: string;
  note?: string | null;
  employee?: Employee;
  task?: Task;
  editedAt?: string | null;
  editedById?: number | null;
  editor?: Employee | null;
  originalHours?: number | null;
}

export interface Assignment {
  id: number;
  employeeId: number;
  taskId: number;
  startAt: string;
  endAt: string;
  note?: string | null;
  employee?: Employee;
  task?: Task;
}

export interface Absence {
  id: number;
  employeeId: number;
  type: AbsenceType;
  startDate: string;
  endDate: string;
  note?: string | null;
  employee?: Employee;
}

export interface Tracking {
  id: number;
  taskId: number;
  employeeId: number;
  state: 'RUNNING' | 'PAUSED';
  startedAt?: string | null;
  liveSec: number;
  liveHours: number;
  employee?: Employee;
  task?: Task;
}

export interface Attachment {
  id: number;
  taskId: number;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  isImage: boolean;
  uploader?: Employee | null;
  createdAt: string;
}

export interface Worklog {
  from: string;
  to: string;
  days: string[];
  employees: { id: number; name: string; color: string; perDay: number[]; total: number }[];
}

export interface Capacity {
  range: { from: string; to: string; workdays: number };
  perEmployee: {
    id: number;
    name: string;
    role: Role;
    weeklyHours: number;
    capacityHours: number;
    plannedHours: number;
    vacationDays: number;
    freeHours: number;
    utilization: number;
  }[];
  projectLoad: {
    id: number;
    name: string;
    code: string;
    status: ProjectStatus;
    color: string;
    estimateHours: number;
    spentHours: number;
    remainingHours: number;
    openTasks: number;
  }[];
  summary: {
    totalCapacityHours: number;
    totalPlannedHours: number;
    freeCapacityHours: number;
    totalRemainingHours: number;
    adequate: boolean;
    deficitHours: number;
  };
}

export const api = {
  auth: {
    login: (login: string, password: string) =>
      req<{ token?: string; user?: Employee; twoFactorRequired?: boolean; ticket?: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login, password }),
      }),
    verify2fa: (ticket: string, code: string) =>
      req<{ token: string; user: Employee }>('/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ ticket, code }),
      }),
    me: () => req<Employee>('/auth/me'),
    updateAccount: (data: { login?: string; currentPassword?: string; newPassword?: string }) =>
      req<Employee>('/auth/account', { method: 'PATCH', body: JSON.stringify(data) }),
    setup2fa: () => req<{ otpauth: string; qrDataUrl: string; secret: string }>('/auth/2fa/setup', { method: 'POST' }),
    enable2fa: (code: string) =>
      req<{ enabled: boolean }>('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
    disable2fa: (code: string) =>
      req<{ enabled: boolean }>('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  },
  employees: {
    list: () => req<Employee[]>('/employees'),
    get: (id: number) => req<Employee>(`/employees/${id}`),
    create: (data: Partial<Employee>) => req<Employee>('/employees', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Employee>) =>
      req<Employee>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<void>(`/employees/${id}`, { method: 'DELETE' }),
    notes: (id: number) => req<Note[]>(`/employees/${id}/notes`),
    addNote: (id: number, text: string) =>
      req<Note>(`/employees/${id}/notes`, { method: 'POST', body: JSON.stringify({ text }) }),
    updateNote: (noteId: number, text: string) =>
      req<Note>(`/employees/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
    removeNote: (noteId: number) => req<void>(`/employees/notes/${noteId}`, { method: 'DELETE' }),
  },
  projects: {
    list: () => req<Project[]>('/projects'),
    get: (id: number) => req<Project>(`/projects/${id}`),
    create: (data: Partial<Project>) => req<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Project>) =>
      req<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => req<void>(`/projects/${id}`, { method: 'DELETE' }),
    addMember: (id: number, employeeId: number, roleOnProject?: string) =>
      req(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify({ employeeId, roleOnProject }) }),
    removeMember: (id: number, employeeId: number) =>
      req(`/projects/${id}/members/${employeeId}`, { method: 'DELETE' }),
    resolveBot: (token: string) =>
      req<{ username: string | null; error?: string }>('/projects/bot-username', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
  },
  tasks: {
    list: (projectId?: number) => req<Task[]>(`/tasks${projectId ? `?projectId=${projectId}` : ''}`),
    get: (id: number) => req<Task>(`/tasks/${id}`),
    create: (data: Partial<Task>) => req<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Task>) =>
      req<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    updateDescription: (id: number, description: string) =>
      req<Task>(`/tasks/${id}/description`, { method: 'PATCH', body: JSON.stringify({ description }) }),
    remove: (id: number) => req<void>(`/tasks/${id}`, { method: 'DELETE' }),
    addLog: (id: number, data: { employeeId: number; hours: number; date?: string; note?: string }) =>
      req<TimeLog>(`/tasks/${id}/logs`, { method: 'POST', body: JSON.stringify(data) }),
    removeLog: (logId: number) => req<void>(`/tasks/logs/${logId}`, { method: 'DELETE' }),
    allLogs: () => req<TimeLog[]>('/tasks/logs'),
    updateLog: (logId: number, data: { hours?: number; note?: string; date?: string }) =>
      req<TimeLog>(`/tasks/logs/${logId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  assignments: {
    list: (from: string, to: string, employeeId?: number) =>
      req<Assignment[]>(`/assignments?from=${from}&to=${to}${employeeId ? `&employeeId=${employeeId}` : ''}`),
    create: (data: Partial<Assignment>, force = false) =>
      req<Assignment>(`/assignments${force ? '?force=true' : ''}`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Assignment>, force = false) =>
      req<Assignment>(`/assignments/${id}${force ? '?force=true' : ''}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (id: number) => req<void>(`/assignments/${id}`, { method: 'DELETE' }),
  },
  absences: {
    list: (from: string, to: string) => req<Absence[]>(`/absences?from=${from}&to=${to}`),
    create: (data: Partial<Absence>) => req<Absence>('/absences', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: number) => req<void>(`/absences/${id}`, { method: 'DELETE' }),
  },
  tracking: {
    active: () => req<Tracking[]>('/tracking/active'),
    start: (taskId: number, employeeId: number) =>
      req<Tracking>('/tracking/start', { method: 'POST', body: JSON.stringify({ taskId, employeeId }) }),
    pause: (taskId: number, employeeId: number) =>
      req<Tracking>('/tracking/pause', { method: 'POST', body: JSON.stringify({ taskId, employeeId }) }),
    stop: (taskId: number, employeeId: number) =>
      req<{ loggedHours: number }>('/tracking/stop', { method: 'POST', body: JSON.stringify({ taskId, employeeId }) }),
  },
  dashboard: {
    capacity: (from?: string, to?: string) =>
      req<Capacity>(`/dashboard/capacity${from && to ? `?from=${from}&to=${to}` : ''}`),
    worklog: (from?: string, to?: string) =>
      req<Worklog>(`/dashboard/worklog${from && to ? `?from=${from}&to=${to}` : ''}`),
  },
  attachments: {
    list: (taskId: number) => req<Attachment[]>(`/tasks/${taskId}/attachments`),
    upload: async (taskId: number, file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const token = getToken();
      const res = await fetch(`/api/tasks/${taskId}/attachments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          msg = (await res.json()).message || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      return res.json() as Promise<Attachment>;
    },
    remove: (id: number) => req<void>(`/attachments/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => req<{ adminBotToken: string | null; adminBotUsername: string | null }>('/settings'),
    update: (adminBotToken: string | null) =>
      req<{ adminBotToken: string | null; adminBotUsername: string | null }>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ adminBotToken }),
      }),
  },
};

export const ROLE_LABEL: Record<Role, string> = {
  OPERATOR: 'Оператор',
  MANAGER: 'Руководитель',
  DEVELOPER: 'Разработчик',
};
export const roleLabel = (role?: Role | null) => (role ? ROLE_LABEL[role] : '⏳ без роли');
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNED: 'Запланирован',
  ACTIVE: 'В работе',
  ON_HOLD: 'На паузе',
  DONE: 'Завершён',
  CANCELLED: 'Отменён',
};
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'В очереди',
  IN_PROGRESS: 'В работе',
  BLOCKED: 'Заблокирована',
  REVIEW: 'На ревью',
  DONE: 'Готово',
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочно',
};
export const ABSENCE_LABEL: Record<AbsenceType, string> = {
  VACATION: 'Отпуск',
  SICK: 'Больничный',
  DAYOFF: 'Отгул',
  OTHER: 'Прочее',
};
