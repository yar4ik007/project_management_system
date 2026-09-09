import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Calendar from './pages/Calendar';
import Live from './pages/Live';
import Cabinet from './pages/Cabinet';
import { api, Employee } from './api';
import { setActingAs, useActingAs } from './impersonation';

function ImpersonationBanner() {
  const actingAs = useActingAs();
  const [emp, setEmp] = useState<Employee | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (actingAs) api.employees.get(actingAs).then(setEmp);
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

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>📊 Управление проектами</h1>
        <nav>
          <NavLink to="/" end>
            Дашборд ресурсов
          </NavLink>
          <NavLink to="/live">🟢 Сейчас в работе</NavLink>
          <NavLink to="/calendar">Календарь планирования</NavLink>
          <NavLink to="/projects">Проекты</NavLink>
          <NavLink to="/employees">Сотрудники</NavLink>
          <NavLink to="/me">👤 Кабинет сотрудника</NavLink>
        </nav>
      </aside>
      <main className="main">
        <ImpersonationBanner />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/live" element={<Live />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/me" element={<Cabinet />} />
        </Routes>
      </main>
    </div>
  );
}
