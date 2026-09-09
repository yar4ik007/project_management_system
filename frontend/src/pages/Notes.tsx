import { useActingAs } from '../impersonation';
import { useAuth } from '../auth';
import { NotesBlock } from './Cabinet';

export default function Notes() {
  const actingAs = useActingAs();
  const { user } = useAuth();
  const employeeId = actingAs ?? user?.id ?? null;

  return (
    <div>
      <div className="page-head">
        <h2>Заметки</h2>
      </div>
      {employeeId ? (
        <div style={{ maxWidth: 640 }}>
          <NotesBlock employeeId={employeeId} />
        </div>
      ) : (
        <p className="muted">Нет данных.</p>
      )}
    </div>
  );
}
