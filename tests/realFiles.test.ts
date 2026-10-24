import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildReport, crossCheck } from '../src/import/crossCheck';
import { parseBaseDietWorkbook } from '../src/import/parseBaseDiet';
import { parsePlanWorkbook } from '../src/import/parsePlan';
import { readWorkbook } from '../src/import/workbook';

/**
 * Teste de integração com os ARQUIVOS REAIS do atleta. Os arquivos não fazem parte do
 * repositório (dados pessoais). Para rodar:
 *   PENTATLO_PLAN_FILE=/caminho/Plano.xlsx PENTATLO_DIET_FILE=/caminho/DIETA.xls npm test
 */
const planPath = process.env.PENTATLO_PLAN_FILE;
const dietPath = process.env.PENTATLO_DIET_FILE;
const available = !!planPath && !!dietPath && existsSync(planPath) && existsSync(dietPath);

describe.skipIf(!available)('arquivos reais', () => {
  it('importa o plano e a dieta-base com os totais conferidos no relatório', () => {
    const plan = parsePlanWorkbook(readWorkbook(readFileSync(planPath!), 'Plano.xlsx', 'plan'));
    const base = parseBaseDietWorkbook(readWorkbook(readFileSync(dietPath!), 'DIETA.xls', 'baseDiet'));
    const cross = crossCheck(plan, base);
    const report = buildReport(plan, base, cross);

    expect(plan.book.format).toBe('xlsx');
    expect(base.book.format).toBe('xls');
    expect(report.blocking).toBe(0);
    expect(plan.sessions).toHaveLength(251);
    expect(plan.counts.sessoesPrincipais).toBe(218);
    expect(plan.counts.sessoesOpcionais).toBe(33);
    expect(plan.weeks).toHaveLength(18);
    expect(plan.weeks[0].startDate).toBe('2026-10-26');
    expect(plan.phases).toHaveLength(6);
    expect(plan.mesocycles).toHaveLength(6);
    expect(plan.dayPlans).toHaveLength(126);
    expect(plan.dayPlans.every((d) => d.crossCheck === 'ok')).toBe(true);
    expect(plan.dietProfiles.map((p) => p.id)).toEqual(['intenso', 'moderado', 'leve', 'recuperacao', 'pre_prova', 'dia_prova']);
    expect(plan.meals).toHaveLength(34);
    expect(plan.mealItems).toHaveLength(127);
    expect(plan.foods).toHaveLength(32);
    expect(plan.competition?.date).toBe('2027-02-27');
    expect(plan.competition?.trackAccessFrom).toBe('2027-02-01');
    expect(plan.hydrationReference?.minMl).toBe(2300);
    expect(plan.hydrationReference?.maxMl).toBe(2900);
    expect(plan.dietProfiles.find((p) => p.id === 'dia_prova')?.hasMeals).toBe(false);

    const bd = base.baseDiet!;
    expect(bd.meals).toHaveLength(9);
    expect(bd.meals.filter((m) => !m.isEmpty).map((m) => m.number)).toEqual([1, 2, 3, 4]);
    expect(bd.meals[0].totalsReported.kcal.value).toBeCloseTo(511.7, 1);
    expect(bd.meals[3].totalsComputed.carbs).toBeCloseTo(65.1, 1); // inclui "1,5" do queijo
    expect(bd.dayTotals.kcal.value).toBeCloseTo(1929.6, 1);
    expect(bd.athlete.weightKg.value).toBe(64);
    expect(bd.athlete.dailyExpenditureKcal.value).toBeCloseTo(2637.872, 2);
    expect(bd.measurements.isEmpty).toBe(true);
    expect(base.counts.porcoesListas).toBe(168);

    // divergências documentadas no relatório
    const subj = cross.conflicts.map((c) => `${c.subject}|${c.field}`);
    expect(subj).toContain('Ovo inteiro|carboidrato');
    expect(subj).toContain('Whey protein|gordura');
    expect(subj).toContain('Leite integral|unidade');
    expect(report.issues.some((i) => i.category === 'numero_texto' && i.source?.cell === 'G20')).toBe(true);
    expect(report.issues.some((i) => i.message.includes('Requeijão Light'))).toBe(true);

    // diagnóstico legível
    console.log(
      JSON.stringify(
        {
          counts: report.counts,
          conflicts: cross.conflicts.map((c) => `${c.subject} · ${c.field}: plano=${String(c.planValue)} base=${String(c.baseValue)}`),
          issues: report.issues.map((i) => `[${i.severity}/${i.category}] ${i.message}`),
        },
        null,
        1,
      ),
    );
  });
});
