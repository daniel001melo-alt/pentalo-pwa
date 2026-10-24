import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  BackupFile,
  BaseDiet,
  CoachNote,
  DataConflict,
  DayPlan,
  DietProfile,
  Food,
  Guideline,
  HydrationEntry,
  ImportFile,
  ImportReport,
  Meal,
  MealItem,
  MealLog,
  Mesocycle,
  PaceZone,
  PainEntry,
  PersonalNote,
  ProgressionTable,
  SessionLog,
  Substitution,
  Supplement,
  SupplementEntry,
  SwimmingZone,
  TrainingPhase,
  TrainingSession,
  TrainingWeek,
  WellnessEntry,
} from '../domain/schemas';

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface ImportBlob {
  id: 'plan' | 'baseDiet';
  fileName: string;
  bytes: ArrayBuffer;
}

export interface StoredReport {
  id: 'last';
  report: ImportReport;
  orphans: { sessionLogs: string[]; mealLogs: string[] };
}

export interface AutoBackup {
  id: string;
  createdAt: string;
  reason: string;
  data: BackupFile;
}

export class AppDB extends Dexie {
  meta!: Table<MetaRow, string>;
  importFiles!: Table<ImportFile, string>;
  importBlobs!: Table<ImportBlob, string>;
  reports!: Table<StoredReport, string>;
  // planejamento (substituídos a cada reimportação do plano)
  phases!: Table<TrainingPhase, string>;
  mesocycles!: Table<Mesocycle, string>;
  weeks!: Table<TrainingWeek, number>;
  sessions!: Table<TrainingSession, string>;
  dayPlans!: Table<DayPlan, string>;
  dietProfiles!: Table<DietProfile, string>;
  meals!: Table<Meal, string>;
  mealItems!: Table<MealItem, string>;
  paceZones!: Table<PaceZone, string>;
  swimZones!: Table<SwimmingZone, string>;
  guidelines!: Table<Guideline, string>;
  progressionTables!: Table<ProgressionTable, string>;
  conflicts!: Table<DataConflict, string>;
  // alimentos de ambos os arquivos (campo origin)
  foods!: Table<Food, string>;
  // dieta-base (substituída a cada reimportação da dieta-base)
  baseDiet!: Table<BaseDiet, string>;
  // notas: origin "planilha" vem do plano; origin "usuario" é progresso pessoal
  coachNotes!: Table<CoachNote, string>;
  // progresso pessoal — NUNCA tocado pela importação
  sessionLogs!: Table<SessionLog, string>;
  mealLogs!: Table<MealLog, string>;
  hydration!: Table<HydrationEntry, string>;
  supplements!: Table<Supplement, string>;
  supplementEntries!: Table<SupplementEntry, string>;
  wellness!: Table<WellnessEntry, string>;
  pains!: Table<PainEntry, string>;
  personalNotes!: Table<PersonalNote, string>;
  substitutions!: Table<Substitution, string>;
  autoBackups!: Table<AutoBackup, string>;

  constructor(name = 'pentatlo-pwa') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      importFiles: 'id',
      importBlobs: 'id',
      reports: 'id',
      phases: 'id, order',
      mesocycles: 'id',
      weeks: 'number',
      sessions: 'key, date, week, modality, priority',
      dayPlans: 'date, week, profileId',
      dietProfiles: 'id',
      meals: 'key, profileId, order',
      mealItems: 'id, mealKey',
      paceZones: 'id',
      swimZones: 'id',
      guidelines: 'id, sheet, section',
      progressionTables: 'id, sheet',
      conflicts: 'id',
      foods: 'id, origin, category, normalizedName',
      baseDiet: 'id',
      coachNotes: 'id, date, origin, week',
      sessionLogs: 'sessionKey, status, updatedAt',
      mealLogs: 'id, dayKey, mealKey',
      hydration: 'id, date',
      supplements: 'id',
      supplementEntries: 'id, date, supplementId',
      wellness: 'date',
      pains: 'id, date',
      personalNotes: 'id, date',
      substitutions: 'id, dayKey',
      autoBackups: 'id, createdAt',
    });
  }
}

/** Tabelas que vêm do plano e são substituídas na reimportação do plano. */
export const PLAN_TABLES = ['phases', 'mesocycles', 'weeks', 'sessions', 'dayPlans', 'dietProfiles', 'meals', 'mealItems', 'paceZones', 'swimZones', 'guidelines', 'progressionTables'] as const;

/** Tabelas de progresso pessoal. A importação nunca escreve nelas. */
export const PROGRESS_TABLES = ['sessionLogs', 'mealLogs', 'hydration', 'supplements', 'supplementEntries', 'wellness', 'pains', 'personalNotes', 'substitutions'] as const;

export type ProgressTable = (typeof PROGRESS_TABLES)[number];

let instance: AppDB | null = null;

export function getDB(): AppDB {
  if (!instance) instance = new AppDB();
  return instance;
}

/** Para testes: troca a instância usada pelo app. */
export function setDB(db: AppDB) {
  instance = db;
}

export const SETTINGS_KEY = 'settings';

export function defaultSettings(): AppSettings {
  return {
    competitionDate: '2027-02-27',
    competitionDateOrigin: 'padrao',
    planShiftDays: 0,
    weights: { training: 50, diet: 30, supplements: 10, hydration: 10 },
    credits: { trainingPartial: 0.5, optionalWeight: 0.5, mealPartial: 0.5, mealSubstituted: 0.75 },
    hydration: { dailyMl: null, origin: 'nao_definida', planReference: null },
    theme: 'system',
    reducedMotion: 'system',
    reminders: {
      training: { enabled: false, minutesBefore: 30 },
      meals: { enabled: false, minutesBefore: 10 },
      water: { enabled: false, everyMinutes: 90, from: '07:00', to: '21:00' },
      supplements: { enabled: false },
    },
    onboardingDone: false,
  };
}

export async function getSettings(db: AppDB = getDB()): Promise<AppSettings> {
  const row = await db.meta.get(SETTINGS_KEY);
  return mergeSettings(row?.value);
}

export function mergeSettings(value: unknown): AppSettings {
  const d = defaultSettings();
  if (!value || typeof value !== 'object') return d;
  const v = value as Partial<AppSettings>;
  return {
    ...d,
    ...v,
    weights: { ...d.weights, ...(v.weights ?? {}) },
    credits: { ...d.credits, ...(v.credits ?? {}) },
    hydration: { ...d.hydration, ...(v.hydration ?? {}) },
    reminders: {
      training: { ...d.reminders.training, ...(v.reminders?.training ?? {}) },
      meals: { ...d.reminders.meals, ...(v.reminders?.meals ?? {}) },
      water: { ...d.reminders.water, ...(v.reminders?.water ?? {}) },
      supplements: { ...d.reminders.supplements, ...(v.reminders?.supplements ?? {}) },
    },
  };
}

export async function saveSettings(patch: Partial<AppSettings>, db: AppDB = getDB()): Promise<AppSettings> {
  return db.transaction('rw', db.meta, async () => {
    const current = await getSettings(db);
    const next = mergeSettings({ ...current, ...patch });
    await db.meta.put({ key: SETTINGS_KEY, value: next });
    return next;
  });
}

export function uid(prefix = ''): string {
  const r = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}-${r}` : r;
}
