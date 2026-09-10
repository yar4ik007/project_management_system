import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Calendar from './pages/Calendar';
import Cabinet from './pages/Cabinet';
import Notes from './pages/Notes';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import { api, Employee } from './api';
import { setActingAs, useActingAs } from './impersonation';
import { LoginPage, useAuth } from './auth';

function ImpersonationBanner() {
  const actingAs = useActingAs();
  const [emp, setEmp] = useState<Employee | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (actingAs) api.employees.get(actingAs).then(setEmp).catch(() => setEmp(null));
    else setEmp(null);
  }, [actingAs]);
  if (!actingAs || !emp) return null;
  return (
    <div className="impersonation">
      👁 Вы смотрите кабинет как <b>{emp.name}</b>
      <button
        className="sm"
        onClick={() => {
          setActingAs(null);
          nav('/employees');
        }}
      >
        Выйти из режима
      </button>
    </div>
  );
}

function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const { user, logout } = useAuth();
  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-badge">EOB</span>
        <span className="logo-text">
          Eye Of Boss
          <small>управление проектами</small>
        </span>
      </div>
      <nav>
        {isAdmin ? (
          <>
            <NavLink to="/" end>
              Дашборд
            </NavLink>
            <NavLink to="/analytics">Аналитика</NavLink>
            <NavLink to="/calendar">Календарь планирования</NavLink>
            <NavLink to="/projects">Проекты</NavLink>
            <NavLink to="/employees">Сотрудники</NavLink>
            <NavLink to="/notes">Заметки</NavLink>
            <NavLink to="/settings">Настройки</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/me">Мои задачи</NavLink>
            <NavLink to="/notes">Заметки</NavLink>
          </>
        )}
      </nav>
      <div className="sidebar-user">
        <NavLink to="/profile" className="sidebar-profile" title="Профиль">
          👤 {user?.name}
        </NavLink>
        <button className="sm" onClick={logout}>
          Выйти
        </button>
      </div>
    </aside>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: 40 }}>Загрузка…</div>;
  if (!user) return <LoginPage />;

  const isAdmin = !!user.isAdmin;

  return (
    <div className="app">
      <Sidebar isAdmin={isAdmin} />
      <main className="main">
        {isAdmin && <ImpersonationBanner />}
        {isAdmin ? (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/me" element={<Cabinet />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/me" element={<Cabinet />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/me" />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
