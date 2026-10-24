import { getDB, getSettings, type AppDB } from '../db/db';
import { combine, dietScore, hydrationScore, supplementScore, trainingScore } from './adherence';
import { addDaysISO, daysBetween, planDateFor, realDateFor } from './dates';
import type {
  AdherenceScore,
  AppSettings,
  CoachNote,
  Competition,
  DayPlan,
  DietProfile,
  HydrationEntry,
  ImportFile,
  Meal,
  MealItem,
  MealLog,
  Mesocycle,
  PainEntry,
  PersonalNote,
  SessionLog,
  Supplement,
  SupplementEntry,
  TrainingPhase,
  TrainingSession,
  TrainingWeek,
  WellnessEntry,
} from './schemas';

export interface PlanMeta {
  competition: Competition | null;
  hydrationReference: { text: string; minMl: number | null; maxMl: number | null } | null;
  supplementReferences: { name: string; text: string }[];
  weightKg?: { value: number | null; cell?: string } | null;
}

/** Fotografia de todos os dados necessários às telas (volume pequeno: centenas de linhas). */
export interface Snapshot {
  settings: AppSettings;
  files: ImportFile[];
  planMeta: PlanMeta | null;
  weeks: TrainingWeek[];
  phases: TrainingPhase[];
  mesocycles: Mesocycle[];
  sessions: TrainingSession[];
  sessionsByDate: Map<string, TrainingSession[]>;
  dayPlans: Map<string, DayPlan>;
  profiles: Map<string, DietProfile>;
  meals: Meal[];
  mealsByProfile: Map<string, Meal[]>;
  itemsByMeal: Map<string, MealItem[]>;
  sessionLogs: Map<string, SessionLog>;
  mealLogs: Map<string, MealLog>;
  hydration: HydrationEntry[];
  supplements: Supplement[];
  supplementEntries: SupplementEntry[];
  wellness: Map<string, WellnessEntry>;
  pains: PainEntry[];
  coachNotes: CoachNote[];
  personalNotes: PersonalNote[];
}

export async function loadSnapshot(db: AppDB = getDB()): Promise<Snapshot> {
  const [
    settings,
    files,
    planMetaRow,
    weeks,
    phases,
    mesocycles,
    sessions,
    dayPlans,
    profiles,
    meals,
    items,
    sLogs,
    mLogs,
    hydration,
    supplements,
    sEntries,
    wellness,
    pains,
    coachNotes,
    personalNotes,
  ] = await Promise.all([
    getSettings(db),
    db.importFiles.toArray(),
    db.meta.get('planMeta'),
    db.weeks.orderBy('number').toArray(),
    db.phases.orderBy('order').toArray(),
    db.mesocycles.toArray(),
    db.sessions.toArray(),
    db.dayPlans.toArray(),
    db.dietProfiles.toArray(),
    db.meals.toArray(),
    db.mealItems.toArray(),
    db.sessionLogs.toArray(),
    db.mealLogs.toArray(),
    db.hydration.toArray(),
    db.supplements.toArray(),
    db.supplementEntries.toArray(),
    db.wellness.toArray(),
    db.pains.toArray(),
    db.coachNotes.toArray(),
    db.personalNotes.toArray(),
  ]);
  sessions.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
  const sessionsByDate = new Map<string, TrainingSession[]>();
  for (const s of sessions) sessionsByDate.set(s.date, [...(sessionsByDate.get(s.date) ?? []), s]);
  const mealsByProfile = new Map<string, Meal[]>();
  for (const m of [...meals].sort((a, b) => a.order - b.order)) mealsByProfile.set(m.profileId, [...(mealsByProfile.get(m.profileId) ?? []), m]);
  const itemsByMeal = new Map<string, MealItem[]>();
  for (const i of [...items].sort((a, b) => a.order - b.order)) itemsByMeal.set(i.mealKey, [...(itemsByMeal.get(i.mealKey) ?? []), i]);
  return {
    settings,
    files,
    planMeta: (planMetaRow?.value as PlanMeta | undefined) ?? null,
    weeks,
    phases,
    mesocycles,
    sessions,
    sessionsByDate,
    dayPlans: new Map(dayPlans.map((d) => [d.date, d])),
    profiles: new Map(profiles.map((p) => [p.id, p])),
    meals,
    mealsByProfile,
    itemsByMeal,
    sessionLogs: new Map(sLogs.map((l) => [l.sessionKey, l])),
    mealLogs: new Map(mLogs.map((l) => [l.id, l])),
    hydration,
    supplements,
    supplementEntries: sEntries,
    wellness: new Map(wellness.map((w) => [w.date, w])),
    pains,
    coachNotes,
    personalNotes,
  };
}

export function mealLogId(dayKey: string, mealKey: string): string {
  return `${dayKey}|${mealKey}`;
}

export interface DayView {
  date: string;
  planDate: string;
  week: TrainingWeek | null;
  phase: TrainingPhase | null;
  mesocycle: Mesocycle | null;
  dayPlan: DayPlan | null;
  profile: DietProfile | null;
  sessions: TrainingSession[];
  meals: Meal[];
  mealLogs: Map<string, MealLog>;
  hydrationMl: number;
  hydrationEntries: HydrationEntry[];
  activeSupplements: Supplement[];
  supplementEntries: SupplementEntry[];
  wellness: WellnessEntry | null;
  pains: PainEntry[];
  scores: AdherenceScore;
  counts: { sessions: { done: number; planned: number }; meals: { done: number; planned: number }; supplements: { done: number; planned: number } };
  inPlan: boolean;
}

export function cycleStart(snap: Snapshot): string | null {
  return snap.weeks[0]?.startDate ?? snap.sessions[0]?.date ?? null;
}

export function weekForPlanDate(snap: Snapshot, planDate: string): TrainingWeek | null {
  const start = cycleStart(snap);
  if (!start) return null;
  const n = Math.floor(daysBetween(start, planDate) / 7) + 1;
  return snap.weeks.find((w) => w.number === n) ?? null;
}

export function computeDay(snap: Snapshot, date: string): DayView {
  const shift = snap.settings.planShiftDays;
  const planDate = planDateFor(date, shift);
  const week = weekForPlanDate(snap, planDate);
  const phase = week ? (snap.phases.find((p) => p.weeks.includes(week.number)) ?? null) : null;
  const mesocycle = week ? (snap.mesocycles.find((m) => m.weeks.includes(week.number)) ?? null) : null;
  const sessions = snap.sessionsByDate.get(planDate) ?? [];
  const dayPlan = snap.dayPlans.get(planDate) ?? null;
  const profile = dayPlan?.profileId ? (snap.profiles.get(dayPlan.profileId) ?? null) : null;
  const meals = profile ? (snap.mealsByProfile.get(profile.id) ?? []) : [];
  const mealLogs = new Map<string, MealLog>();
  for (const m of meals) {
    const l = snap.mealLogs.get(mealLogId(planDate, m.key));
    if (l) mealLogs.set(m.key, l);
  }
  const hydrationEntries = snap.hydration.filter((h) => h.date === date).sort((a, b) => (a.at < b.at ? -1 : 1));
  const hydrationMl = hydrationEntries.reduce((a, h) => a + h.ml, 0);
  const activeSupplements = snap.supplements.filter((s) => s.active);
  const supplementEntries = snap.supplementEntries.filter((e) => e.date === date);
  const t = trainingScore(sessions, snap.sessionLogs, snap.settings);
  const d = dietScore(meals, mealLogs, snap.settings);
  const s = supplementScore(activeSupplements, supplementEntries);
  const h = hydrationScore(hydrationMl, snap.settings.hydration.dailyMl);
  const scores = combine({ training: t.score, diet: d.score, supplements: s.score, hydration: h }, snap.settings.weights, date);
  return {
    date,
    planDate,
    week,
    phase,
    mesocycle,
    dayPlan,
    profile,
    sessions,
    meals,
    mealLogs,
    hydrationMl,
    hydrationEntries,
    activeSupplements,
    supplementEntries,
    wellness: snap.wellness.get(date) ?? null,
    pains: snap.pains.filter((p) => p.date === date),
    scores,
    counts: { sessions: { done: t.done, planned: t.planned }, meals: { done: d.done, planned: d.planned }, supplements: { done: s.done, planned: s.planned } },
    inPlan: !!week || sessions.length > 0 || !!dayPlan,
  };
}

/** Datas reais do ciclo (considerando o deslocamento). */
export function cycleDates(snap: Snapshot): string[] {
  const start = cycleStart(snap);
  if (!start) return [];
  const last = snap.weeks.length ? snap.weeks[snap.weeks.length - 1].endDate : snap.sessions[snap.sessions.length - 1]?.date;
  const out: string[] = [];
  for (let d = start; d <= last; d = addDaysISO(d, 1)) out.push(realDateFor(d, snap.settings.planShiftDays));
  return out;
}

/** Próxima sessão a partir de agora (data/hora aproximada pelo período). */
export function nextSession(snap: Snapshot, today: string, nowMinutes: number, periodTime: Record<string, string>): { session: TrainingSession; date: string } | null {
  const shift = snap.settings.planShiftDays;
  for (const s of snap.sessions) {
    const real = realDateFor(s.date, shift);
    if (real < today) continue;
    const st = snap.sessionLogs.get(s.key)?.status;
    if (st === 'concluido' || st === 'ignorado' || st === 'parcial') continue;
    if (real === today) {
      const [h, m] = (periodTime[s.period] ?? '23:59').split(':').map(Number);
      if (h * 60 + m + 120 < nowMinutes && st !== 'em_andamento') continue;
    }
    return { session: s, date: real };
  }
  return null;
}
