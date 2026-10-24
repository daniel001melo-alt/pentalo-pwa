import type { AdherenceScore, AppSettings, Meal, MealLog, SessionLog, Supplement, SupplementEntry, TrainingSession } from './schemas';

/**
 * Aderência ao plano. Regras:
 * - só entram categorias aplicáveis no dia; os pesos das não aplicáveis são redistribuídos;
 * - dia sem sessão principal não penaliza treino (categoria não aplicável);
 * - sessão opcional só entra na conta se foi iniciada/realizada (nunca penaliza);
 * - treino parcial recebe crédito parcial configurável;
 * - dieta é calculada pelas refeições PLANEJADAS do perfil do dia — abrir a refeição não conta;
 * - suplementos: apenas os ativos; hidratação limitada a 100 %.
 */

export const SESSION_CREDIT_DONE = 1;

export function sessionCredit(status: SessionLog['status'] | undefined, settings: AppSettings): number {
  switch (status) {
    case 'concluido':
      return SESSION_CREDIT_DONE;
    case 'parcial':
      return settings.credits.trainingPartial;
    default:
      return 0;
  }
}

export function trainingScore(sessions: TrainingSession[], logs: Map<string, SessionLog>, settings: AppSettings): { score: number | null; done: number; planned: number } {
  let num = 0;
  let den = 0;
  let done = 0;
  let planned = 0;
  for (const s of sessions) {
    const log = logs.get(s.key);
    const status = log?.status;
    if (s.priority === 'principal') {
      planned++;
      den += 1;
      num += sessionCredit(status, settings);
      if (status === 'concluido') done++;
    } else if (status === 'concluido' || status === 'parcial') {
      const w = settings.credits.optionalWeight;
      den += w;
      num += w * sessionCredit(status, settings);
      if (status === 'concluido') done++;
    }
  }
  return { score: den > 0 ? num / den : null, done, planned };
}

export function mealCredit(status: MealLog['status'] | undefined, settings: AppSettings): number {
  switch (status) {
    case 'conforme':
      return 1;
    case 'parcial':
      return settings.credits.mealPartial;
    case 'substituida':
      return settings.credits.mealSubstituted;
    default:
      return 0;
  }
}

export function dietScore(meals: Meal[], logs: Map<string, MealLog>, settings: AppSettings): { score: number | null; done: number; planned: number } {
  if (!meals.length) return { score: null, done: 0, planned: 0 };
  let num = 0;
  let done = 0;
  for (const m of meals) {
    const st = logs.get(m.key)?.status;
    num += mealCredit(st, settings);
    if (st && st !== 'pendente' && st !== 'nao_realizada') done++;
  }
  return { score: num / meals.length, done, planned: meals.length };
}

export function supplementScore(active: Supplement[], entries: SupplementEntry[]): { score: number | null; done: number; planned: number } {
  if (!active.length) return { score: null, done: 0, planned: 0 };
  const taken = active.filter((s) => entries.some((e) => e.supplementId === s.id && e.status === 'tomado')).length;
  return { score: taken / active.length, done: taken, planned: active.length };
}

export function hydrationScore(totalMl: number, goalMl: number | null): number | null {
  if (!goalMl || goalMl <= 0) return null;
  return Math.min(1, totalMl / goalMl);
}

export function combine(parts: { training: number | null; diet: number | null; supplements: number | null; hydration: number | null }, weights: AppSettings['weights'], date: string): AdherenceScore {
  const applied: Record<string, number> = {};
  let sumW = 0;
  let acc = 0;
  for (const k of ['training', 'diet', 'supplements', 'hydration'] as const) {
    const v = parts[k];
    if (v === null || weights[k] <= 0) continue;
    sumW += weights[k];
  }
  for (const k of ['training', 'diet', 'supplements', 'hydration'] as const) {
    const v = parts[k];
    if (v === null || weights[k] <= 0) continue;
    applied[k] = weights[k] / sumW;
    acc += v * (weights[k] / sumW);
  }
  const overall = sumW > 0 ? acc : null;
  return { date, ...parts, overall, appliedWeights: applied, formula: describeFormula(applied) };
}

const LABEL: Record<string, string> = { training: 'Treino', diet: 'Dieta', supplements: 'Suplementação', hydration: 'Hidratação' };

export function describeFormula(applied: Record<string, number>): string {
  const parts = Object.entries(applied).map(([k, w]) => `${LABEL[k]} × ${(w * 100).toFixed(0)}%`);
  return parts.length ? `Aderência = ${parts.join(' + ')} (pesos redistribuídos entre as categorias aplicáveis)` : 'Nenhuma categoria aplicável neste dia';
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

export function average(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
