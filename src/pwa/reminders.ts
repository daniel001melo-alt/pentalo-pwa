import { minutesOf, PERIOD_TIME } from '../domain/dates';
import { computeDay, type Snapshot } from '../domain/snapshot';

export interface DueReminder {
  id: string;
  kind: 'treino' | 'refeicao' | 'agua' | 'suplemento';
  title: string;
  body: string;
}

/**
 * Lembretes que vencem AGORA. Executado só com o app aberto (em primeiro plano):
 * o navegador não oferece agendamento local confiável com o app fechado.
 * Janela de disparo: 15 minutos após o horário do lembrete.
 */
export function dueReminders(snap: Snapshot, today: string, nowMin: number, fired: Set<string>): DueReminder[] {
  const r = snap.settings.reminders;
  const day = computeDay(snap, today);
  const out: DueReminder[] = [];
  const inWindow = (target: number | null) => target !== null && nowMin >= target && nowMin < target + 15;
  if (r.training.enabled) {
    for (const s of day.sessions) {
      const st = snap.sessionLogs.get(s.key)?.status;
      if (st && st !== 'nao_iniciado') continue;
      const t = minutesOf(PERIOD_TIME[s.period] ?? null);
      const id = `treino|${today}|${s.key}`;
      if (t !== null && inWindow(t - r.training.minutesBefore) && !fired.has(id)) {
        out.push({ id, kind: 'treino', title: `${s.marker} ${s.type}`, body: `${s.period} · ${s.durationText ?? 'duração não informada'} · ${s.intensityText ?? ''}`.trim() });
      }
    }
  }
  if (r.meals.enabled) {
    for (const m of day.meals) {
      const st = day.mealLogs.get(m.key)?.status;
      if (st && st !== 'pendente') continue;
      const t = minutesOf(m.time);
      const id = `refeicao|${today}|${m.key}`;
      if (inWindow(t === null ? null : t - r.meals.minutesBefore) && !fired.has(id)) {
        out.push({ id, kind: 'refeicao', title: `${m.name} (${m.time})`, body: `Perfil ${day.profile?.name ?? ''} · ${Math.round(m.totals.kcal ?? 0)} kcal planejadas` });
      }
    }
  }
  if (r.water.enabled && r.water.everyMinutes > 0) {
    const from = minutesOf(r.water.from) ?? 0;
    const to = minutesOf(r.water.to) ?? 24 * 60;
    const last = day.hydrationEntries[day.hydrationEntries.length - 1];
    const lastMin = last ? new Date(last.at).getHours() * 60 + new Date(last.at).getMinutes() : from;
    const slot = Math.floor((nowMin - from) / r.water.everyMinutes);
    const id = `agua|${today}|${slot}`;
    if (nowMin >= from && nowMin <= to && nowMin - lastMin >= r.water.everyMinutes && !fired.has(id)) {
      const goal = snap.settings.hydration.dailyMl;
      out.push({ id, kind: 'agua', title: 'Hidratação', body: goal ? `${day.hydrationMl} de ${goal} ml registrados hoje` : `${day.hydrationMl} ml registrados hoje` });
    }
  }
  if (r.supplements.enabled) {
    for (const s of day.activeSupplements) {
      if (day.supplementEntries.some((e) => e.supplementId === s.id)) continue;
      const id = `sup|${today}|${s.id}`;
      if (inWindow(minutesOf(s.time)) && !fired.has(id)) out.push({ id, kind: 'suplemento', title: s.name, body: s.dose ? `Dose registrada por você: ${s.dose}` : 'Dose não preenchida' });
    }
  }
  return out;
}

/** Itens pendentes do dia para o badge do ícone (quando suportado). */
export function pendingCount(snap: Snapshot, today: string): number {
  const day = computeDay(snap, today);
  const sessions = day.sessions.filter((s) => s.priority === 'principal' && !['concluido', 'parcial', 'ignorado'].includes(snap.sessionLogs.get(s.key)?.status ?? '')).length;
  const meals = day.meals.filter((m) => (day.mealLogs.get(m.key)?.status ?? 'pendente') === 'pendente').length;
  return sessions + meals;
}

const FIRED_KEY = 'pentatlo-reminders-fired';

export function loadFired(today: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[];
    return new Set(raw.filter((id) => id.includes(`|${today}|`)));
  } catch {
    return new Set();
  }
}

export function saveFired(fired: Set<string>) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-200)));
  } catch {
    /* armazenamento indisponível */
  }
}
