import { addDaysISO, daysBetween, pad } from '../import/normalize';

export { addDaysISO, daysBetween };

/** Data local de hoje (o atleta vive no fuso do aparelho), "AAAA-MM-DD". */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function nowHHMM(now: Date = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Data do plano correspondente a uma data real, considerando o deslocamento do calendário. */
export function planDateFor(realDate: string, shiftDays: number): string {
  return shiftDays ? addDaysISO(realDate, -shiftDays) : realDate;
}

/** Data real em que acontece um dia do plano. */
export function realDateFor(planDate: string, shiftDays: number): string {
  return shiftDays ? addDaysISO(planDate, shiftDays) : planDate;
}

const WEEKDAY_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const WEEKDAY_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function weekdayIndex(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT[weekdayIndex(iso)];
}

export function formatLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAY_LONG[weekdayIndex(iso)]}, ${d} de ${MONTHS[m - 1]} de ${y}`;
}

export function formatShort(iso: string): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function formatBR(iso: string): string {
  if (!iso) return '—';
  return iso.split('-').reverse().join('/');
}

export function monthLabel(year: number, month0: number): string {
  return `${MONTHS[month0][0].toUpperCase()}${MONTHS[month0].slice(1)} ${year}`;
}

/** Segunda-feira da semana de uma data. */
export function mondayOf(iso: string): string {
  const wd = weekdayIndex(iso);
  return addDaysISO(iso, -((wd + 6) % 7));
}

export interface TemporalProgress {
  start: string;
  end: string;
  total: number;
  elapsed: number;
  remaining: number;
  percent: number;
}

/** Progresso temporal do ciclo: (hoje − início) ÷ (competição − início). Não mede treino feito. */
export function temporalProgress(start: string, competition: string, today: string): TemporalProgress {
  const total = Math.max(1, daysBetween(start, competition));
  const elapsed = Math.min(total, Math.max(0, daysBetween(start, today)));
  return { start, end: competition, total, elapsed, remaining: daysBetween(today, competition), percent: Math.round((elapsed / total) * 1000) / 10 };
}

export function minutesOf(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Horário aproximado de cada período (premissa do LEIA-ME: treinos ≈06:00 e ≈16:00). */
export const PERIOD_TIME: Record<string, string> = { AM: '06:00', Único: '07:00', PM: '16:00', Casa: '20:30' };
