import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildReport, crossCheck, sameFood } from '../src/import/crossCheck';
import { parseBaseDietWorkbook } from '../src/import/parseBaseDiet';
import { parsePlanWorkbook, parseWeeklyCell } from '../src/import/parsePlan';
import { parseExercises } from '../src/import/sessionText';
import { detectFormat, readWorkbook, SheetReader } from '../src/import/workbook';
import { baseDietWorkbook, planWorkbook } from './fixtures';

const plan = (opts = {}) => parsePlanWorkbook(readWorkbook(planWorkbook(opts), 'Plano.xlsx', 'plan'));
const base = () => parseBaseDietWorkbook(readWorkbook(baseDietWorkbook(), 'DIETA.xls', 'baseDiet'));

describe('leitura de XLSX e XLS', () => {
  it('detecta o formato pelos bytes, não pela extensão', () => {
    expect(detectFormat(planWorkbook())).toBe('xlsx');
    expect(detectFormat(baseDietWorkbook())).toBe('xls');
    const fake = new TextEncoder().encode('isto não é planilha');
    expect(detectFormat(fake)).toBeNull();
    expect(() => readWorkbook(fake, 'renomeado.xlsx', 'plan')).toThrow(/não é uma planilha XLS ou XLSX válida/);
  });
  it('lê o XLS BIFF8 com as três abas', () => {
    const b = readWorkbook(baseDietWorkbook(), 'DIETA.xls', 'baseDiet');
    expect(b.format).toBe('xls');
    expect(b.wb.SheetNames).toEqual(['TMB', 'DIETA', 'MEDIDAS']);
  });
});

describe('fórmulas', () => {
  it('usa o resultado em cache e conta fórmulas', () => {
    const b = readWorkbook(planWorkbook(), 'Plano.xlsx', 'plan');
    expect(b.formulas).toBeGreaterThan(10);
    expect(b.formulasWithoutCache).toHaveLength(0);
  });
  it('fórmula sem resultado: avisa e recalcula com a regra da planilha', () => {
    const p = plan({ dropMealCache: true });
    expect(p.book.formulasWithoutCache.length).toBeGreaterThan(0);
    expect(p.issues.issues.some((i) => i.category === 'formula_sem_cache')).toBe(true);
    const item = p.mealItems.find((i) => i.foodName === 'Pão de forma')!;
    expect(item.macros.protein).toBe(6.9); // 13,8 × 50/100
    expect(item.macros.kcal).toBe(114.5);
    expect(item.issues.join(' ')).toMatch(/recalculados/);
  });
});

describe('células mescladas', () => {
  it('a área mesclada devolve o valor da célula de origem', () => {
    const b = readWorkbook(planWorkbook(), 'Plano.xlsx', 'plan');
    const sr = new SheetReader(b, 'Planilha Semanal');
    expect(sr.isMerged(5, 6)).toBe(true);
    expect(sr.text(5, 3)).toBe('Observação da semana 1.');
    expect(sr.text(5, 7)).toBe('Observação da semana 1.');
  });
  it('nota mesclada da dieta-base não vira alimento', () => {
    const b = base();
    expect(b.foods.some((f) => /patinho/.test(f.originalName))).toBe(false);
    expect(b.foods.find((f) => f.originalName.startsWith('Carne vermelha'))?.note).toMatch(/patinho/);
  });
});

describe('planejamento', () => {
  const p = plan();
  it('sessões com marcadores » e ◦', () => {
    expect(p.sessions).toHaveLength(12);
    expect(p.sessions.filter((s) => s.priority === 'opcional').map((s) => s.type)).toEqual(['Granada G2 – potência rotacional + core']);
    expect(p.sessions.find((s) => s.type === 'Limiar (Z4)')).toMatchObject({ marker: '»', modality: 'corrida', zone: 'Z4', runKm: 10, durationMin: 60 });
    expect(p.issues.issues.filter((i) => i.severity === 'bloqueador')).toHaveLength(0);
  });
  it('quebra a célula semanal em blocos', () => {
    const r = parseWeeklyCell("[AM] » Corrida | 30' | Z1\n6,5 km\n\n[PM] ◦ Granada | ≈45' | Alta\nMed ball\n\nDIETA: Leve");
    expect(r.diet).toBe('Leve');
    expect(r.blocks.map((b) => [b.period, b.marker, b.type])).toEqual([
      ['AM', '»', 'Corrida'],
      ['PM', '◦', 'Granada'],
    ]);
  });
  it('associação dia → treino → perfil nutricional → refeições', () => {
    const day = p.dayPlans.find((d) => d.date === '2026-10-27')!;
    expect(day).toMatchObject({ profileId: 'moderado', crossCheck: 'ok' });
    expect(p.sessions.filter((s) => s.date === '2026-10-27')).toHaveLength(3);
    const meals = p.meals.filter((m) => m.profileId === 'moderado');
    expect(meals.map((m) => m.name)).toEqual(['Café da manhã', 'Pós-treino']);
    expect(meals[1].trainingRelation).toBe('pos_treino');
    expect(p.dayPlans.find((d) => d.date === '2026-11-07')?.profileId).toBe('dia_prova');
  });
  it('perfil sem refeições é reportado (Dia de prova)', () => {
    expect(p.dietProfiles.find((x) => x.id === 'dia_prova')).toMatchObject({ hasMeals: false, isEstimate: true });
    expect(p.issues.issues.some((i) => i.category === 'ausente' && /Dia de prova/.test(i.message))).toBe(true);
  });
  it('competição, pistas e hidratação vêm da planilha como premissas', () => {
    expect(p.competition).toMatchObject({ date: '2026-11-07', trackAccessFrom: '2026-11-02' });
    expect(p.hydrationReference).toMatchObject({ minMl: 2300, maxMl: 2900 });
    expect(p.supplementReferences[0].text).toMatch(/3–5 g\/dia/);
    expect(p.issues.issues.some((i) => /Beta-alanina/.test(i.message))).toBe(true);
  });
  it('detecta duplicata na mesma refeição sem unir', () => {
    expect(p.mealItems.filter((i) => i.mealKey.startsWith('recuperacao|2') && i.foodName === 'Banana nanica')).toHaveLength(2);
    expect(p.issues.issues.some((i) => i.category === 'duplicata')).toBe(true);
  });
  it('detecta inconsistência de duração e divergência da Visão Geral', () => {
    expect(p.issues.issues.some((i) => i.category === 'inconsistencia' && /PPM/.test(i.message))).toBe(true);
    const bad = plan({ wrongOverviewKm: true });
    expect(bad.issues.issues.some((i) => i.category === 'divergencia' && /Visão Geral/.test(i.message))).toBe(true);
  });
  it('perfil divergente entre Calendário e Planilha Semanal exige escolha', () => {
    const d = plan({ divergentProfile: true });
    const c = crossCheck(d, null);
    expect(c.conflicts.find((x) => x.requiresChoice)?.subject).toBe('Perfil do dia 2026-10-26');
  });
  it('extrai séries/repetições preservando o texto original', () => {
    const ex = parseExercises("Aquec 10'.\n- Agachamento com barra 3x15 (~60% 1RM) i: 1'\n- Copenhagen 3x30\"/lado");
    expect(ex[0]).toMatchObject({ name: 'Agachamento com barra', sets: '3', reps: '15', load: '~60% 1RM', rest: "1'" });
    expect(ex[1].raw).toBe('Copenhagen 3x30"/lado');
  });
});

describe('dieta-base', () => {
  const b = base();
  const bd = b.baseDiet!;
  it('refeições preenchidas e vazias', () => {
    expect(bd.meals.map((m) => [m.number, m.isEmpty])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(bd.meals[0].items.map((i) => i.originalName.trim())).toEqual(['pão de forma', 'Ovos Inteiros (cozido, omelete, mexido)', 'queijo muç']);
  });
  it('número com vírgula como texto: original preservado, valor normalizado', () => {
    const q = bd.meals[0].items[2];
    expect(q.carbs).toMatchObject({ original: '1,5', value: 1.5, status: 'requer_validacao' });
    expect(q.fat.value).toBe(8.5);
    expect(bd.meals[0].totalsComputed.carbs).toBe(35.5);
    expect(b.issues.issues.filter((i) => i.category === 'numero_texto')).toHaveLength(2);
  });
  it('unidade inferida para ovos e ausente no requeijão', () => {
    expect(bd.meals[0].items[1]).toMatchObject({ unit: 'un', status: 'requer_validacao' });
    const r = b.foods.find((f) => f.originalName === 'Requeijão Light')!;
    expect(r.status).toBe('inconsistente');
    expect(r.issues.join()).toMatch(/sem unidade/);
  });
  it('valores suspeitos e porções sem macros', () => {
    const banana300 = b.foods.find((f) => f.originalName === 'Banana nanica' && f.baseMeasure.value === 300)!;
    expect(banana300.status).toBe('inconsistente');
    expect(b.foods.find((f) => f.originalName === 'Batata doce crua')?.status).toBe('nao_informado');
    expect(b.issues.issues.some((i) => /líquido medido em g/.test(i.message))).toBe(true);
  });
  it('alimentos duplicados são marcados, nunca unidos', () => {
    const bananas100 = b.foods.filter((f) => /banana nanica/i.test(f.originalName) && f.baseMeasure.value === 100);
    expect(bananas100).toHaveLength(2);
    expect(bananas100[0].duplicateGroup).toBe(bananas100[1].duplicateGroup);
    expect(bananas100[0].id).not.toBe(bananas100[1].id);
  });
  it('dados físicos e gasto do arquivo', () => {
    expect(bd.athlete.weightKg).toMatchObject({ value: 64, cell: 'TMB!C3' });
    expect(bd.athlete.dailyExpenditureKcal.value).toBeCloseTo(2637.872);
    expect(bd.measurements).toMatchObject({ isEmpty: true });
    expect(bd.dayTotals.kcal.value).toBeCloseTo(4 * 33.8 + 4 * 35.5 + 9 * 17.7);
    expect(bd.dayTotals.surplus.status).toBe('calculado');
  });
});

describe('cruzamento entre arquivos', () => {
  it('reconhece o mesmo alimento com nomes diferentes', () => {
    expect(sameFood('Ovo inteiro', 'Ovos Inteiros (cozido, omelete, mexido)')).toBe(true);
    expect(sameFood('Queijo muçarela', 'queijo muç')).toBe(true);
    expect(sameFood('Carne vermelha magra crua', 'Carne vermelha crua *')).toBe(true);
    expect(sameFood('Leite desnatado', 'leite em pó desnatado')).toBe(false);
    expect(sameFood('Batata doce cozida', 'Batata doce crua')).toBe(false);
  });
  it('divergências: plano operacional, base preservada como histórico', () => {
    const p = plan();
    const b = base();
    const c = crossCheck(p, b);
    const key = (s: string, f: string) => c.conflicts.find((x) => x.subject === s && x.field === f);
    expect(key('Ovo inteiro', 'carboidrato')).toMatchObject({ planValue: 0.5, baseValue: 'vazio', operational: 'plan', requiresChoice: false });
    expect(key('Whey protein', 'gordura')).toMatchObject({ planValue: 1.5 });
    expect(key('Leite integral', 'unidade')).toBeTruthy();
    expect(key('Banana nanica', 'carboidrato')).toMatchObject({ planValue: 23.8, baseValue: 24 });
    expect(c.issues.issues.some((i) => /Macarrão cozido/.test(i.message))).toBe(true);
    const r = buildReport(p, b, c);
    expect(r.blocking).toBe(0);
    expect(r.counts['plano.sessoes']).toBe(12);
    expect(r.counts['base.refeicoesVazias']).toBe(1);
    expect(r.files.map((f) => f.format)).toEqual(['xlsx', 'xls']);
  });
});

describe('aba ausente', () => {
  it('erro bloqueador quando falta aba obrigatória', () => {
    const wb = XLSX.read(planWorkbook(), { type: 'array' });
    delete wb.Sheets['Dieta_Planos'];
    wb.SheetNames = wb.SheetNames.filter((n) => n !== 'Dieta_Planos');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    const p = parsePlanWorkbook(readWorkbook(bytes, 'x.xlsx', 'plan'));
    expect(p.issues.issues.some((i) => i.severity === 'bloqueador' && /Dieta_Planos/.test(i.message))).toBe(true);
  });
});
