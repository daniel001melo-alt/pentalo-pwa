import { z } from 'zod';

/**
 * Modelo de dados do app. Todo dado importado carrega uma SourceReference:
 * arquivo, aba, célula/linha, valor original, valor normalizado e status.
 */

export const validationStatus = z.enum(['ok', 'nao_informado', 'requer_validacao', 'inconsistente', 'configuravel', 'estimativa', 'calculado']);
export type ValidationStatus = z.infer<typeof validationStatus>;

export const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  ok: 'Conferido',
  nao_informado: 'Não informado',
  requer_validacao: 'Requer validação',
  inconsistente: 'Dado inconsistente',
  configuravel: 'Campo configurável',
  estimativa: 'Estimativa da planilha',
  calculado: 'Calculado (conferência)',
};

export const fileKind = z.enum(['plan', 'baseDiet', 'user', 'app']);
export type FileKind = z.infer<typeof fileKind>;

export const sourceReference = z.object({
  fileKind,
  fileName: z.string(),
  sheet: z.string().optional(),
  cell: z.string().optional(),
  original: z.unknown().optional(),
  normalized: z.unknown().optional(),
  status: validationStatus,
  note: z.string().optional(),
});
export type SourceReference = z.infer<typeof sourceReference>;

/** Valor numérico com rastreabilidade: o original nunca é descartado. */
export const sourcedNumber = z.object({
  original: z.unknown(),
  value: z.number().nullable(),
  cell: z.string().optional(),
  status: validationStatus,
});
export type SourcedNumber = z.infer<typeof sourcedNumber>;

export const macronutrients = z.object({
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
  kcal: z.number().nullable(),
});
export type Macronutrients = z.infer<typeof macronutrients>;

export const importFile = z.object({
  id: fileKind,
  fileName: z.string(),
  size: z.number(),
  format: z.enum(['xlsx', 'xls']),
  sha256: z.string(),
  importedAt: z.string(),
  sheetNames: z.array(z.string()),
});
export type ImportFile = z.infer<typeof importFile>;

export const issueSeverity = z.enum(['bloqueador', 'aviso', 'info']);
export type IssueSeverity = z.infer<typeof issueSeverity>;

export const importIssue = z.object({
  id: z.string(),
  severity: issueSeverity,
  category: z.enum(['estrutura', 'formula_sem_cache', 'campo_vazio', 'numero_texto', 'unidade', 'duplicata', 'nutricional_suspeito', 'divergencia', 'ausente', 'premissa', 'inconsistencia']),
  message: z.string(),
  source: sourceReference.optional(),
});
export type ImportIssue = z.infer<typeof importIssue>;

export const dataConflict = z.object({
  id: z.string(),
  subject: z.string(),
  field: z.string(),
  planValue: z.unknown(),
  baseValue: z.unknown(),
  planSource: sourceReference.optional(),
  baseSource: sourceReference.optional(),
  operational: z.enum(['plan', 'base', 'user']),
  requiresChoice: z.boolean(),
  resolution: z.unknown().optional(),
  note: z.string().optional(),
});
export type DataConflict = z.infer<typeof dataConflict>;

export const importReport = z.object({
  generatedAt: z.string(),
  files: z.array(
    z.object({
      kind: fileKind,
      fileName: z.string(),
      format: z.enum(['xlsx', 'xls']),
      sheets: z.array(z.string()),
      formulas: z.number(),
      formulasWithoutCache: z.number(),
      mergedRanges: z.number(),
    }),
  ),
  counts: z.record(z.string(), z.number()),
  issues: z.array(importIssue),
  conflicts: z.array(dataConflict),
  blocking: z.number(),
  warnings: z.number(),
});
export type ImportReport = z.infer<typeof importReport>;

// ───────────────────────── Atleta e competição ─────────────────────────

export const athleteProfile = z.object({
  weightKg: sourcedNumber,
  heightCm: sourcedNumber,
  ageYears: sourcedNumber,
  activityFactor: sourcedNumber,
  dailyExpenditureKcal: sourcedNumber,
  expenditureFormula: z.string().optional(),
  notes: z.array(z.string()),
});
export type AthleteProfile = z.infer<typeof athleteProfile>;

export const competition = z.object({
  date: z.string(),
  source: sourceReference,
  trackAccessFrom: z.string().nullable(),
  trackAccessSource: sourceReference.optional(),
});
export type Competition = z.infer<typeof competition>;

// ───────────────────────── Treino ─────────────────────────

export const modality = z.enum(['corrida', 'natacao', 'forca', 'granada', 'tiro', 'ppm', 'pnu', 'mobilidade', 'competicao', 'outro']);
export type Modality = z.infer<typeof modality>;

export const trainingPhase = z.object({
  id: z.string(),
  order: z.number(),
  name: z.string(),
  code: z.string(),
  period: z.string(),
  weeks: z.array(z.number()),
  objectives: z.string(),
  characteristics: z.string(),
  weeklyVolume: z.string(),
  intensity: z.string(),
  keySessions: z.string(),
  source: sourceReference,
});
export type TrainingPhase = z.infer<typeof trainingPhase>;

export const microcycle = z.object({ order: z.number(), name: z.string() });
export type Microcycle = z.infer<typeof microcycle>;

export const mesocycle = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  weeks: z.array(z.number()),
  microcycles: z.array(microcycle),
  source: sourceReference,
});
export type Mesocycle = z.infer<typeof mesocycle>;

export const trainingWeek = z.object({
  number: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  datesLabel: z.string(),
  mesocycle: z.string(),
  microcycle: z.string(),
  load: z.number().nullable(),
  phaseCode: z.string(),
  objective: z.string(),
  observations: z.string().nullable(),
  planned: z.object({
    runKm: z.number().nullable(),
    swimM: z.number().nullable(),
    throws: z.number().nullable(),
    sessions: z.number().nullable(),
  }),
  source: sourceReference,
});
export type TrainingWeek = z.infer<typeof trainingWeek>;

export const exercise = z.object({
  raw: z.string(),
  name: z.string(),
  sets: z.string().nullable(),
  reps: z.string().nullable(),
  load: z.string().nullable(),
  rest: z.string().nullable(),
});
export type Exercise = z.infer<typeof exercise>;

export const trainingSession = z.object({
  key: z.string(),
  week: z.number(),
  date: z.string(),
  weekday: z.string(),
  period: z.string(),
  order: z.number(),
  type: z.string(),
  modality,
  priority: z.enum(['principal', 'opcional']),
  marker: z.enum(['»', '◦']),
  durationText: z.string().nullable(),
  durationMin: z.number().nullable(),
  intensityText: z.string().nullable(),
  intensityLevel: z.enum(['leve', 'moderada', 'alta', 'tecnica', 'prova', 'nao_informado']),
  zone: z.string().nullable(),
  pace: z.string().nullable(),
  runKm: z.number().nullable(),
  swimM: z.number().nullable(),
  throws: z.number().nullable(),
  contacts: z.number().nullable(),
  intervals: z.array(z.string()),
  detail: z.string(),
  exercises: z.array(exercise),
  source: sourceReference,
  issues: z.array(z.string()),
});
export type TrainingSession = z.infer<typeof trainingSession>;

export const paceZone = z.object({
  id: z.string(),
  name: z.string(),
  pace: z.string(),
  hrPercent: z.string(),
  use: z.string(),
  source: sourceReference,
});
export type PaceZone = z.infer<typeof paceZone>;

export const swimmingZone = z.object({
  id: z.string(),
  zone: z.string(),
  code: z.string(),
  description: z.string(),
  example: z.string(),
  source: sourceReference,
});
export type SwimmingZone = z.infer<typeof swimmingZone>;

export const guideline = z.object({
  id: z.string(),
  sheet: z.string(),
  section: z.string(),
  title: z.string(),
  value: z.string(),
  detail: z.string(),
  source: sourceReference,
});
export type Guideline = z.infer<typeof guideline>;

export const progressionTable = z.object({
  id: z.string(),
  sheet: z.string(),
  title: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.object({ week: z.number().nullable(), cells: z.array(z.string()) })),
  notes: z.array(z.string()),
  source: sourceReference,
});
export type ProgressionTable = z.infer<typeof progressionTable>;

// ───────────────────────── Nutrição ─────────────────────────

export const dietProfileId = z.enum(['intenso', 'moderado', 'leve', 'recuperacao', 'pre_prova', 'dia_prova']);
export type DietProfileId = z.infer<typeof dietProfileId>;

export const dietProfile = z.object({
  id: dietProfileId,
  name: z.string(),
  planned: macronutrients,
  perKg: z.object({ protein: z.number().nullable(), carbs: z.number().nullable(), fat: z.number().nullable() }),
  whenToUse: z.string(),
  isEstimate: z.boolean(),
  hasMeals: z.boolean(),
  source: sourceReference,
});
export type DietProfile = z.infer<typeof dietProfile>;

export const nutritionTarget = z.object({
  profileId: dietProfileId,
  macros: macronutrients,
  status: validationStatus,
  source: sourceReference,
});
export type NutritionTarget = z.infer<typeof nutritionTarget>;

export const mealItem = z.object({
  id: z.string(),
  mealKey: z.string(),
  order: z.number(),
  foodName: z.string(),
  foodId: z.string().nullable(),
  quantity: sourcedNumber,
  unit: z.string(),
  macros: macronutrients,
  kcalCalculated: z.number().nullable(),
  source: sourceReference,
  issues: z.array(z.string()),
});
export type MealItem = z.infer<typeof mealItem>;

export const meal = z.object({
  key: z.string(),
  profileId: dietProfileId,
  order: z.number(),
  name: z.string(),
  time: z.string().nullable(),
  trainingRelation: z.enum(['pre_treino', 'pos_treino', 'intra_treino', 'refeicao', 'ceia', 'nao_informado']),
  totals: macronutrients,
  source: sourceReference,
});
export type Meal = z.infer<typeof meal>;

export const mealPlan = z.object({
  profileId: dietProfileId,
  meals: z.array(meal),
  items: z.array(mealItem),
});
export type MealPlan = z.infer<typeof mealPlan>;

export const foodCategory = z.enum(['carbo_cutting', 'carbo_bulking', 'proteina', 'gordura', 'refeicao_base', 'plano']);
export type FoodCategory = z.infer<typeof foodCategory>;

export const FOOD_CATEGORY_LABEL: Record<FoodCategory, string> = {
  carbo_cutting: 'Carbo p/ cutting',
  carbo_bulking: 'Carbo p/ bulking',
  proteina: 'Proteína',
  gordura: 'Gordura',
  refeicao_base: 'Refeição da dieta-base',
  plano: 'Base do plano atual',
};

/** Alimento/porção. Usado tanto para Base_Alimentos (plano) quanto para as listas da dieta-base. */
export const food = z.object({
  id: z.string(),
  origin: z.enum(['plan', 'baseDiet']),
  originalName: z.string(),
  normalizedName: z.string(),
  category: foodCategory,
  baseMeasure: sourcedNumber,
  unit: z.string(),
  unitOriginal: z.string(),
  proteinAnimal: sourcedNumber.nullable(),
  proteinVegetal: sourcedNumber.nullable(),
  protein: sourcedNumber,
  carbs: sourcedNumber,
  fat: sourcedNumber,
  kcalReported: sourcedNumber.nullable(),
  kcalCalculated: z.number().nullable(),
  kcalDifference: z.number().nullable(),
  note: z.string().nullable(),
  sourceNote: z.string().nullable(),
  status: validationStatus,
  issues: z.array(z.string()),
  duplicateGroup: z.string().nullable(),
  source: sourceReference,
});
export type Food = z.infer<typeof food>;

/** Porção derivada de um Food em outra quantidade (consulta, não substituição). */
export const foodServing = z.object({
  foodId: z.string(),
  quantity: z.number(),
  unit: z.string(),
  macros: macronutrients,
  derived: z.boolean(),
});
export type FoodServing = z.infer<typeof foodServing>;

export const foodEquivalence = z.object({
  normalizedName: z.string(),
  displayName: z.string(),
  servings: z.array(z.string()),
  categories: z.array(foodCategory),
  origins: z.array(z.enum(['plan', 'baseDiet'])),
});
export type FoodEquivalence = z.infer<typeof foodEquivalence>;

export const baseDietMeal = z.object({
  number: z.number(),
  title: z.string(),
  isEmpty: z.boolean(),
  items: z.array(food),
  totalsReported: z.object({
    proteinAnimal: sourcedNumber,
    proteinVegetal: sourcedNumber,
    carbs: sourcedNumber,
    fat: sourcedNumber,
    kcal: sourcedNumber,
  }),
  totalsComputed: z.object({ protein: z.number(), carbs: z.number(), fat: z.number(), kcal: z.number() }),
  source: sourceReference,
});
export type BaseDietMeal = z.infer<typeof baseDietMeal>;

export const baseDiet = z.object({
  id: z.literal('base'),
  title: z.string(),
  athlete: athleteProfile,
  meals: z.array(baseDietMeal),
  dayTotals: z.object({
    proteinAnimal: sourcedNumber,
    proteinVegetal: sourcedNumber,
    carbs: sourcedNumber,
    fat: sourcedNumber,
    kcal: sourcedNumber,
    surplus: sourcedNumber,
    percent: z.record(z.string(), z.number().nullable()),
    perKg: z.record(z.string(), z.number().nullable()),
  }),
  measurements: z.object({
    labels: z.array(z.string()),
    dates: z.array(z.string()),
    values: z.array(z.array(z.number().nullable())),
    isEmpty: z.boolean(),
  }),
  notes: z.array(z.string()),
  source: sourceReference,
});
export type BaseDiet = z.infer<typeof baseDiet>;

export const dayPlan = z.object({
  date: z.string(),
  week: z.number(),
  weekday: z.string(),
  profileId: dietProfileId.nullable(),
  profileName: z.string().nullable(),
  profileSource: sourceReference,
  crossCheck: z.enum(['ok', 'divergente', 'sem_conferencia']),
});
export type DayPlan = z.infer<typeof dayPlan>;

export const hydrationTarget = z.object({
  dailyMl: z.number().nullable(),
  origin: z.enum(['usuario', 'planilha', 'nao_definida']),
  planReference: z.string().nullable(),
  planSource: sourceReference.optional(),
});
export type HydrationTarget = z.infer<typeof hydrationTarget>;

// ───────────────────────── Progresso pessoal ─────────────────────────

export const sessionStatus = z.enum(['nao_iniciado', 'em_andamento', 'concluido', 'parcial', 'ignorado']);
export type SessionStatus = z.infer<typeof sessionStatus>;

export const sessionLog = z.object({
  sessionKey: z.string(),
  status: sessionStatus,
  rpe: z.number().min(0).max(10).nullable(),
  notes: z.string(),
  performedAt: z.string().nullable(),
  painNote: z.string(),
  skipReason: z.string(),
  updatedAt: z.string(),
});
export type SessionLog = z.infer<typeof sessionLog>;

export const mealStatus = z.enum(['pendente', 'conforme', 'parcial', 'substituida', 'nao_realizada']);
export type MealStatus = z.infer<typeof mealStatus>;

export const mealLog = z.object({
  id: z.string(),
  dayKey: z.string(),
  mealKey: z.string(),
  status: mealStatus,
  actualTime: z.string().nullable(),
  notes: z.string(),
  updatedAt: z.string(),
});
export type MealLog = z.infer<typeof mealLog>;

export const hydrationEntry = z.object({
  id: z.string(),
  date: z.string(),
  at: z.string(),
  ml: z.number(),
});
export type HydrationEntry = z.infer<typeof hydrationEntry>;

export const supplement = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  time: z.string().nullable(),
  dose: z.string(),
  notes: z.string(),
  planReference: z.string().nullable(),
});
export type Supplement = z.infer<typeof supplement>;

export const supplementEntry = z.object({
  id: z.string(),
  date: z.string(),
  supplementId: z.string(),
  status: z.enum(['tomado', 'ignorado']),
  at: z.string(),
  note: z.string(),
});
export type SupplementEntry = z.infer<typeof supplementEntry>;

export const wellnessEntry = z.object({
  date: z.string(),
  energy: z.number().min(1).max(5).nullable(),
  mood: z.number().min(1).max(5).nullable(),
  sleep: z.number().min(1).max(5).nullable(),
  fatigue: z.number().min(1).max(5).nullable(),
  muscleSoreness: z.number().min(1).max(5).nullable(),
  localizedPain: z.string(),
  notes: z.string(),
  updatedAt: z.string(),
});
export type WellnessEntry = z.infer<typeof wellnessEntry>;

export const painEntry = z.object({
  id: z.string(),
  date: z.string(),
  location: z.string(),
  intensity: z.number().min(0).max(10),
  onset: z.string(),
  trainingImpact: z.enum(['nenhum', 'adaptou', 'reduziu', 'interrompeu', 'nao_treinou']),
  notes: z.string(),
  createdAt: z.string(),
});
export type PainEntry = z.infer<typeof painEntry>;

export const coachNote = z.object({
  id: z.string(),
  date: z.string(),
  text: z.string(),
  origin: z.enum(['planilha', 'usuario']),
  week: z.number().nullable(),
  source: sourceReference.optional(),
});
export type CoachNote = z.infer<typeof coachNote>;

export const personalNote = z.object({
  id: z.string(),
  date: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
export type PersonalNote = z.infer<typeof personalNote>;

export const substitution = z.object({
  id: z.string(),
  dayKey: z.string(),
  mealKey: z.string(),
  itemId: z.string(),
  fromFood: z.string(),
  toFoodId: z.string(),
  toFood: z.string(),
  quantity: z.number(),
  unit: z.string(),
  delta: macronutrients,
  confirmedAt: z.string(),
});
export type Substitution = z.infer<typeof substitution>;

export const dailyChecklist = z.object({
  date: z.string(),
  sessions: z.object({ done: z.number(), planned: z.number() }),
  meals: z.object({ done: z.number(), planned: z.number() }),
  supplements: z.object({ done: z.number(), planned: z.number() }),
  hydration: z.object({ ml: z.number(), goal: z.number().nullable() }),
});
export type DailyChecklist = z.infer<typeof dailyChecklist>;

export const adherenceScore = z.object({
  date: z.string(),
  training: z.number().nullable(),
  diet: z.number().nullable(),
  supplements: z.number().nullable(),
  hydration: z.number().nullable(),
  overall: z.number().nullable(),
  appliedWeights: z.record(z.string(), z.number()),
  formula: z.string(),
});
export type AdherenceScore = z.infer<typeof adherenceScore>;

export const reminderConfig = z.object({
  training: z.object({ enabled: z.boolean(), minutesBefore: z.number() }),
  meals: z.object({ enabled: z.boolean(), minutesBefore: z.number() }),
  water: z.object({ enabled: z.boolean(), everyMinutes: z.number(), from: z.string(), to: z.string() }),
  supplements: z.object({ enabled: z.boolean() }),
});
export type ReminderConfig = z.infer<typeof reminderConfig>;

export const appSettings = z.object({
  competitionDate: z.string(),
  competitionDateOrigin: z.enum(['planilha', 'usuario', 'padrao']),
  planShiftDays: z.number(),
  weights: z.object({ training: z.number(), diet: z.number(), supplements: z.number(), hydration: z.number() }),
  credits: z.object({
    trainingPartial: z.number(),
    optionalWeight: z.number(),
    mealPartial: z.number(),
    mealSubstituted: z.number(),
  }),
  hydration: hydrationTarget,
  theme: z.enum(['system', 'light', 'dark']),
  reducedMotion: z.enum(['system', 'on', 'off']),
  reminders: reminderConfig,
  onboardingDone: z.boolean(),
});
export type AppSettings = z.infer<typeof appSettings>;

export const BACKUP_FORMAT = 'pentatlo-pwa-backup';
export const BACKUP_VERSION = 1;

export const backupFile = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().positive(),
  appVersion: z.string(),
  kind: z.enum(['completo', 'progresso']),
  createdAt: z.string(),
  tables: z.record(z.string(), z.array(z.unknown())),
});
export type BackupFile = z.infer<typeof backupFile>;
