import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/db/db';
import { autoMealTime, autoSessionTime } from '../src/domain/actions';
import { combine, dietScore, hydrationScore, supplementScore, trainingScore } from '../src/domain/adherence';
import type { Meal, MealLog, SessionLog, TrainingSession } from '../src/domain/schemas';

const settings = defaultSettings();
const ses = (key: string, priority: 'principal' | 'opcional'): TrainingSession => ({ key, priority }) as TrainingSession;
const log = (sessionKey: string, status: SessionLog['status']): SessionLog => ({ sessionKey, status, rpe: null, notes: '', performedAt: null, painNote: '', skipReason: '', updatedAt: '' });
const meal = (key: string): Meal => ({ key }) as Meal;
const mlog = (mealKey: string, status: MealLog['status']): MealLog => ({ id: mealKey, dayKey: 'd', mealKey, status, actualTime: null, notes: '', updatedAt: '' });

describe('aderência ao treino', () => {
  it('dia sem treino não é penalizado (não aplicável)', () => {
    expect(trainingScore([], new Map(), settings).score).toBeNull();
  });
  it('principal conta; opcional não realizada não penaliza', () => {
    const s = [ses('a', 'principal'), ses('b', 'opcional')];
    expect(trainingScore(s, new Map([['a', log('a', 'concluido')]]), settings).score).toBe(1);
  });
  it('opcional realizada entra com peso reduzido', () => {
    const s = [ses('a', 'principal'), ses('b', 'opcional')];
    const r = trainingScore(s, new Map([['b', log('b', 'concluido')]]), settings);
    // (0 + 0,5×1) / (1 + 0,5)
    expect(r.score).toBeCloseTo(1 / 3);
  });
  it('crédito parcial', () => {
    const s = [ses('a', 'principal'), ses('b', 'principal')];
    const r = trainingScore(
      s,
      new Map([
        ['a', log('a', 'parcial')],
        ['b', log('b', 'ignorado')],
      ]),
      settings,
    );
    expect(r.score).toBeCloseTo(0.25);
    expect(r).toMatchObject({ done: 0, planned: 2 });
  });
});

describe('aderência à dieta', () => {
  it('é calculada pelas refeições planejadas, não pelas abertas', () => {
    const ms = [meal('m1'), meal('m2'), meal('m3'), meal('m4')];
    const logs = new Map([
      ['m1', mlog('m1', 'conforme')],
      ['m2', mlog('m2', 'parcial')],
      ['m3', mlog('m3', 'substituida')],
      ['m4', mlog('m4', 'pendente')],
    ]);
    const r = dietScore(ms, logs, settings);
    expect(r.score).toBeCloseTo((1 + 0.5 + 0.75 + 0) / 4);
    expect(r).toMatchObject({ done: 3, planned: 4 });
  });
  it('não realizada = 0 e perfil sem refeições = não aplicável', () => {
    expect(dietScore([meal('m1')], new Map([['m1', mlog('m1', 'nao_realizada')]]), settings).score).toBe(0);
    expect(dietScore([], new Map(), settings).score).toBeNull();
  });
});

describe('suplementos e hidratação', () => {
  it('usa só suplementos ativos', () => {
    expect(supplementScore([], []).score).toBeNull();
    const act = [{ id: 'creatina' }, { id: 'beta-alanina' }] as never[];
    expect(supplementScore(act, [{ supplementId: 'creatina', status: 'tomado' }] as never[]).score).toBe(0.5);
  });
  it('hidratação limitada a 100 % e sem meta = não aplicável', () => {
    expect(hydrationScore(4000, 2500)).toBe(1);
    expect(hydrationScore(1250, 2500)).toBe(0.5);
    expect(hydrationScore(1000, null)).toBeNull();
  });
});

describe('horário real não é inventado', () => {
  it('só preenche automaticamente quando o registro é de hoje', () => {
    expect(autoSessionTime(false, 'concluido', undefined)).toEqual({});
    expect(autoSessionTime(true, 'concluido', undefined).performedAt).toBeTruthy();
    expect(autoSessionTime(true, 'ignorado', undefined)).toEqual({});
    expect(autoMealTime(false, 'conforme', undefined)).toEqual({});
    expect(autoMealTime(true, 'conforme', undefined).actualTime).toMatch(/^\d{2}:\d{2}$/);
    expect(autoMealTime(true, 'conforme', mlog('m', 'parcial') && { ...mlog('m', 'parcial'), actualTime: '07:10' })).toEqual({});
  });
});

describe('aderência geral', () => {
  it('redistribui pesos das categorias não aplicáveis e mostra a fórmula', () => {
    const r = combine({ training: null, diet: 0.5, supplements: null, hydration: 1 }, settings.weights, '2026-11-01');
    // dieta 30 e água 10 → 75 % / 25 %
    expect(r.overall).toBeCloseTo(0.5 * 0.75 + 1 * 0.25);
    expect(r.appliedWeights).toEqual({ diet: 0.75, hydration: 0.25 });
    expect(r.formula).toMatch(/Dieta × 75% \+ Hidratação × 25%/);
  });
  it('pesos iniciais 50/30/10/10', () => {
    const r = combine({ training: 1, diet: 0, supplements: 1, hydration: 0 }, settings.weights, 'x');
    expect(r.overall).toBeCloseTo(0.6);
  });
  it('nenhuma categoria aplicável', () => {
    expect(combine({ training: null, diet: null, supplements: null, hydration: null }, settings.weights, 'x').overall).toBeNull();
  });
});
