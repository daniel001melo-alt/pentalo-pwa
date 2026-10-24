import { getDB, getSettings, saveSettings, uid, type AppDB } from '../db/db';
import { createAutoBackup } from './backup';
import { addDaysISO, daysBetween, nowHHMM, realDateFor } from './dates';

/** Campos de horário real preenchidos automaticamente SÓ quando o registro é do dia de hoje. */
export function autoSessionTime(isToday: boolean, status: SessionLog['status'], current: SessionLog | undefined): Partial<SessionLog> {
  return isToday && (status === 'concluido' || status === 'parcial') && !current?.performedAt ? { performedAt: new Date().toISOString() } : {};
}

export function autoMealTime(isToday: boolean, status: MealLog['status'], current: MealLog | undefined): Partial<MealLog> {
  return isToday && (status === 'conforme' || status === 'parcial' || status === 'substituida') && !current?.actualTime ? { actualTime: nowHHMM() } : {};
}
import type { MealLog, PainEntry, SessionLog, Substitution, Supplement, WellnessEntry } from './schemas';
import { mealLogId, type Snapshot } from './snapshot';

const now = () => new Date().toISOString();

export async function upsertSessionLog(sessionKey: string, patch: Partial<Omit<SessionLog, 'sessionKey'>>, db: AppDB = getDB()) {
  await db.transaction('rw', db.sessionLogs, async () => {
    const cur = await db.sessionLogs.get(sessionKey);
    const base: SessionLog = cur ?? { sessionKey, status: 'nao_iniciado', rpe: null, notes: '', performedAt: null, painNote: '', skipReason: '', updatedAt: now() };
    // horário real não é inventado: só a interface o preenche, e apenas quando o dia marcado é hoje
    await db.sessionLogs.put({ ...base, ...patch, updatedAt: now() });
  });
}

export async function upsertMealLog(dayKey: string, mealKey: string, patch: Partial<Pick<MealLog, 'status' | 'actualTime' | 'notes'>>, db: AppDB = getDB()) {
  const id = mealLogId(dayKey, mealKey);
  await db.transaction('rw', db.mealLogs, async () => {
    const cur = await db.mealLogs.get(id);
    const base: MealLog = cur ?? { id, dayKey, mealKey, status: 'pendente', actualTime: null, notes: '', updatedAt: now() };
    await db.mealLogs.put({ ...base, ...patch, updatedAt: now() });
  });
}

export async function addWater(date: string, ml: number, db: AppDB = getDB()) {
  if (!Number.isFinite(ml) || ml <= 0 || ml > 5000) throw new Error('Quantidade de água inválida.');
  const id = uid('agua');
  await db.hydration.put({ id, date, at: now(), ml: Math.round(ml) });
  return id;
}

export async function undoLastWater(date: string, db: AppDB = getDB()) {
  const entries = await db.hydration.where('date').equals(date).toArray();
  const last = entries.sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  if (last) await db.hydration.delete(last.id);
  return last ?? null;
}

export async function deleteWater(id: string, db: AppDB = getDB()) {
  await db.hydration.delete(id);
}

export async function setSupplementEntry(date: string, supplementId: string, status: 'tomado' | 'ignorado' | null, note = '', db: AppDB = getDB()) {
  const id = `${date}|${supplementId}`;
  if (status === null) await db.supplementEntries.delete(id);
  else await db.supplementEntries.put({ id, date, supplementId, status, at: now(), note });
}

export async function updateSupplement(id: string, patch: Partial<Supplement>, db: AppDB = getDB()) {
  await db.supplements.update(id, patch);
}

export async function addSupplement(name: string, db: AppDB = getDB()) {
  const s: Supplement = { id: uid('sup'), name, active: true, time: null, dose: '', notes: '', planReference: null };
  await db.supplements.put(s);
  return s;
}

export async function saveWellness(date: string, patch: Partial<Omit<WellnessEntry, 'date'>>, db: AppDB = getDB()) {
  await db.transaction('rw', db.wellness, async () => {
    const cur = await db.wellness.get(date);
    const base: WellnessEntry = cur ?? { date, energy: null, mood: null, sleep: null, fatigue: null, muscleSoreness: null, localizedPain: '', notes: '', updatedAt: now() };
    await db.wellness.put({ ...base, ...patch, updatedAt: now() });
  });
}

export async function addPain(entry: Omit<PainEntry, 'id' | 'createdAt'>, db: AppDB = getDB()) {
  if (entry.intensity < 0 || entry.intensity > 10) throw new Error('Intensidade deve estar entre 0 e 10.');
  await db.pains.put({ ...entry, id: uid('dor'), createdAt: now() });
}

export async function deletePain(id: string, db: AppDB = getDB()) {
  await db.pains.delete(id);
}

export async function addPersonalNote(date: string, text: string, db: AppDB = getDB()) {
  if (!text.trim()) return;
  await db.personalNotes.put({ id: uid('nota'), date, text: text.trim(), createdAt: now() });
}

export async function deletePersonalNote(id: string, db: AppDB = getDB()) {
  await db.personalNotes.delete(id);
}

export async function addCoachNote(date: string, text: string, db: AppDB = getDB()) {
  if (!text.trim()) return;
  await db.coachNotes.put({ id: uid('coach'), date, text: text.trim(), origin: 'usuario', week: null });
}

export async function deleteCoachNote(id: string, db: AppDB = getDB()) {
  const n = await db.coachNotes.get(id);
  if (n?.origin === 'usuario') await db.coachNotes.delete(id);
}

export async function saveSubstitution(sub: Omit<Substitution, 'id' | 'confirmedAt'>, db: AppDB = getDB()) {
  const s: Substitution = { ...sub, id: uid('subst'), confirmedAt: now() };
  await db.transaction('rw', db.substitutions, db.mealLogs, async () => {
    await db.substitutions.put(s);
  });
  await upsertMealLog(sub.dayKey, sub.mealKey, { status: 'substituida' }, db);
  return s;
}

/** Muda SÓ a data da competição (contagem regressiva). Treinos não se movem. */
export async function changeCompetitionDate(date: string, db: AppDB = getDB()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.');
  return saveSettings({ competitionDate: date, competitionDateOrigin: 'usuario' }, db);
}

export interface ShiftPreview {
  days: number;
  newStart: string | null;
  newEnd: string | null;
  competitionSession: { from: string; to: string } | null;
  alignedWithCompetition: boolean;
  loggedSessions: number;
  loggedMeals: number;
  pastToFuture: number;
  futureToPast: number;
  unaffected: string[];
}

/** Consequências de deslocar o calendário em `days` dias (sem gravar). */
export function previewShift(snap: Snapshot, days: number, today: string): ShiftPreview {
  const cur = snap.settings.planShiftDays;
  const start = snap.weeks[0]?.startDate ?? snap.sessions[0]?.date ?? null;
  const end = snap.weeks[snap.weeks.length - 1]?.endDate ?? snap.sessions[snap.sessions.length - 1]?.date ?? null;
  const comp = snap.sessions.find((s) => s.modality === 'competicao');
  let pastToFuture = 0;
  let futureToPast = 0;
  for (const s of snap.sessions) {
    const before = realDateFor(s.date, cur);
    const after = realDateFor(s.date, days);
    if (before < today && after >= today) pastToFuture++;
    if (before >= today && after < today) futureToPast++;
  }
  const compTo = comp ? realDateFor(comp.date, days) : null;
  return {
    days,
    newStart: start ? realDateFor(start, days) : null,
    newEnd: end ? realDateFor(end, days) : null,
    competitionSession: comp && compTo ? { from: realDateFor(comp.date, cur), to: compTo } : null,
    alignedWithCompetition: compTo === snap.settings.competitionDate,
    loggedSessions: snap.sessionLogs.size,
    loggedMeals: snap.mealLogs.size,
    pastToFuture,
    futureToPast,
    unaffected: ['Hidratação', 'Suplementação', 'Bem-estar', 'Dor/lesão', 'Notas pessoais'],
  };
}

/** Dias necessários para a sessão de competição do plano coincidir com a data configurada. */
export function shiftToMatchCompetition(snap: Snapshot): number | null {
  const comp = snap.sessions.find((s) => s.modality === 'competicao');
  return comp ? daysBetween(comp.date, snap.settings.competitionDate) : null;
}

/** Desloca o calendário do plano (operação separada, com backup automático antes). */
export async function applyShift(days: number, db: AppDB = getDB()) {
  if (!Number.isInteger(days) || Math.abs(days) > 365) throw new Error('Deslocamento inválido.');
  const backupId = await createAutoBackup(`Antes de deslocar o calendário (${days >= 0 ? '+' : ''}${days} dias)`, db);
  const prev = (await getSettings(db)).planShiftDays;
  await saveSettings({ planShiftDays: days }, db);
  return { backupId, previous: prev };
}

export { addDaysISO };
