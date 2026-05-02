import { useEffect, useState, useCallback } from "react";

const KEY = "active_staff_v1";

export interface ActiveStaff {
  id: string;
  name: string;
  at: number;
}

export function useActiveStaff() {
  const [active, setActive] = useState<ActiveStaff | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setActive(JSON.parse(raw));
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setActive(e.newValue ? JSON.parse(e.newValue) : null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setStaff = useCallback((s: ActiveStaff | null) => {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
    setActive(s);
  }, []);

  return { active, setStaff };
}
