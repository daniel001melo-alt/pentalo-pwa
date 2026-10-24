import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { getDB } from './db/db';
import { todayISO } from './domain/dates';
import { loadSnapshot, type Snapshot } from './domain/snapshot';

/** Todos os dados das telas, reativos às gravações no IndexedDB. */
export function useSnapshot(): Snapshot | undefined {
  return useLiveQuery(() => loadSnapshot(getDB()), []);
}

/** Relógio que avança a cada minuto e ao voltar o app para frente. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, intervalMs);
    const vis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [intervalMs]);
  return now;
}

export function useToday(): string {
  return todayISO(useNow());
}

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/hoje';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/hoje', params: new URLSearchParams(query) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
