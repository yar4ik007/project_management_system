import { useEffect, useState } from 'react';

const KEY = 'pms_acting_as';

export function getActingAs(): number | null {
  const v = localStorage.getItem(KEY);
  return v ? Number(v) : null;
}

export function setActingAs(id: number | null) {
  if (id) localStorage.setItem(KEY, String(id));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('acting-changed'));
}

// Хук: текущий «под кем сидим» id, реактивно обновляется.
export function useActingAs(): number | null {
  const [id, setId] = useState<number | null>(getActingAs());
  useEffect(() => {
    const h = () => setId(getActingAs());
    window.addEventListener('acting-changed', h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener('acting-changed', h);
      window.removeEventListener('storage', h);
    };
  }, []);
  return id;
}
