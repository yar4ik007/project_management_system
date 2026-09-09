import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Calendar from './pages/Calendar';
import Live from './pages/Live';

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
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/live" element={<Live />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/employees" element={<Employees />} />
        </Routes>
      </main>
    </div>
  );
}
