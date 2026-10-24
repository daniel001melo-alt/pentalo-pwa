import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { nowHHMM, minutesOf } from './domain/dates';
import type { Snapshot } from './domain/snapshot';
import { navigate, useNow, useRoute, useSnapshot } from './hooks';
import { requestPersistence, setBadge, showNotification } from './pwa/platform';
import { dueReminders, loadFired, pendingCount, saveFired } from './pwa/reminders';
import { CalendarScreen } from './screens/CalendarScreen';
import { DietScreen } from './screens/DietScreen';
import { ImportWizard } from './screens/ImportWizard';
import { MoreScreen } from './screens/MoreScreen';
import { TodayScreen } from './screens/TodayScreen';
import { TrainingScreen } from './screens/TrainingScreen';
import { cx, useToast } from './ui/kit';
import { todayISO } from './domain/dates';

const TABS = [
  { path: '/hoje', label: 'Hoje', icon: '◉' },
  { path: '/treinos', label: 'Treinos', icon: '⚑' },
  { path: '/dieta', label: 'Dieta', icon: '◍' },
  { path: '/calendario', label: 'Calendário', icon: '▦' },
  { path: '/mais', label: 'Mais', icon: '≡' },
];

function useTheme(snap: Snapshot | undefined) {
  const theme = snap?.settings.theme ?? 'system';
  const motion = snap?.settings.reducedMotion ?? 'system';
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', dark ? '#0b1220' : '#f4f6f1');
    };
    apply();
    try {
      localStorage.setItem('pentatlo-theme', JSON.stringify(theme));
    } catch {
      /* sem armazenamento local */
    }
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', motion === 'on');
  }, [motion]);
}

/** Motor de lembretes: roda apenas com o app aberto; usa notificação do sistema se permitida, senão aviso interno. */
function useReminders(snap: Snapshot | undefined) {
  const now = useNow(30_000);
  const toast = useToast();
  const firedRef = useRef<{ day: string; set: Set<string> } | null>(null);
  useEffect(() => {
    if (!snap || !snap.sessions.length) return;
    const today = todayISO(now);
    if (!firedRef.current || firedRef.current.day !== today) firedRef.current = { day: today, set: loadFired(today) };
    const fired = firedRef.current.set;
    const due = dueReminders(snap, today, minutesOf(nowHHMM(now)) ?? 0, fired);
    for (const d of due) {
      fired.add(d.id);
      void showNotification(d.title, d.body, d.id).then((ok) => {
        if (!ok) toast(`⏰ ${d.title} — ${d.body}`);
      });
    }
    if (due.length) saveFired(fired);
    void setBadge(pendingCount(snap, today));
  }, [snap, now, toast]);
}

export default function App() {
  const snap = useSnapshot();
  const route = useRoute();
  const toast = useToast();
  useTheme(snap);
  useReminders(snap);
  const [wizard, setWizard] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW() {
      void requestPersistence();
    },
  });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.path]);

  if (!snap) {
    return (
      <div className="flex h-full items-center justify-center text-muted" role="status">
        Carregando dados locais…
      </div>
    );
  }

  const imported = snap.files.some((f) => f.id === 'plan');
  if (!imported || wizard) {
    return (
      <ImportWizard
        firstRun={!imported}
        onDone={() => {
          setWizard(false);
          navigate('/hoje');
          toast('Importação concluída. Dados salvos neste aparelho.');
        }}
        onCancel={imported ? () => setWizard(false) : undefined}
      />
    );
  }

  const path = route.path;
  let screen;
  if (path.startsWith('/treinos')) screen = <TrainingScreen snap={snap} route={route} />;
  else if (path.startsWith('/dieta')) screen = <DietScreen snap={snap} route={route} />;
  else if (path.startsWith('/calendario')) screen = <CalendarScreen snap={snap} />;
  else if (path.startsWith('/mais')) screen = <MoreScreen snap={snap} route={route} onReimport={() => setWizard(true)} />;
  else screen = <TodayScreen snap={snap} route={route} />;

  return (
    <div className="mx-auto min-h-full max-w-xl">
      {needRefresh && (
        <div className="pt-safe sticky top-0 z-40 flex items-center justify-between gap-2 bg-accent px-4 pb-2 text-accentInk">
          <span className="text-[14px] font-semibold">Nova versão do app disponível. Seus dados são mantidos.</span>
          <button className="rounded-lg bg-accentInk/15 px-3 py-2 text-[14px] font-bold" onClick={() => void updateServiceWorker(true)}>
            Atualizar
          </button>
        </div>
      )}
      <main className="pt-safe pb-nav px-4">{screen}</main>
      <nav aria-label="Navegação principal" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <ul className="mx-auto flex max-w-xl">
          {TABS.map((t) => {
            const active = path.startsWith(t.path);
            return (
              <li key={t.path} className="flex-1">
                <a
                  href={`#${t.path}`}
                  aria-current={active ? 'page' : undefined}
                  className={cx('flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', active ? 'text-accent' : 'text-muted')}
                >
                  <span aria-hidden className={cx('text-[20px] leading-none', active && 'scale-110')}>
                    {t.icon}
                  </span>
                  {t.label}
                  {active && <span className="sr-only">(atual)</span>}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
