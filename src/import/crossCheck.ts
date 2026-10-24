import type { DataConflict, Food, ImportReport, SourceReference } from '../domain/schemas';
import { IssueCollector } from './issues';
import { normalizeName, round2 } from './normalize';
import type { BaseDietImport } from './parseBaseDiet';
import type { PlanImport } from './parsePlan';

const STOP = new Set(['de', 'do', 'da', 'em', 'e', 'c', 'com']);
/** palavras que não mudam a identidade do alimento entre os dois arquivos */
const IGNORABLE = new Set(['magra', 'magro']);

function tokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

function tokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 3 && l.startsWith(s);
}

/** "Queijo muçarela" ≈ "queijo muç", "Filé de merluza cru" ≈ "Filé de Merluza crua", "Carne vermelha magra crua" ≈ "Carne vermelha crua *". */
export function sameFood(a: string, b: string): boolean {
  const ta = tokens(a).filter((w) => !IGNORABLE.has(w));
  const tb = tokens(b).filter((w) => !IGNORABLE.has(w));
  if (!ta.length || ta.length !== tb.length) return false;
  return ta.every((w, i) => tokenEq(w, tb[i]));
}

export interface CrossCheckResult {
  conflicts: DataConflict[];
  issues: IssueCollector;
  /** id do alimento do plano → ids das porções correspondentes na dieta-base */
  matches: Record<string, string[]>;
}

const MACROS = [
  ['protein', 'proteína'],
  ['carbs', 'carboidrato'],
  ['fat', 'gordura'],
] as const;

export function crossCheck(plan: PlanImport | null, base: BaseDietImport | null): CrossCheckResult {
  const issues = new IssueCollector('cruzamento');
  const conflicts: DataConflict[] = [];
  const matches: Record<string, string[]> = {};
  let seq = 0;
  const push = (c: Omit<DataConflict, 'id'>) => {
    // a mesma divergência repetida em várias porções idênticas da base vira um único conflito
    const same = conflicts.find((x) => x.subject === c.subject && x.field === c.field && x.planValue === c.planValue && x.baseValue === c.baseValue);
    if (same) {
      same.note = `${same.note ?? ''} Também em ${c.baseSource?.sheet ?? ''}!${c.baseSource?.cell ?? ''}.`.trim();
      return;
    }
    conflicts.push({ id: `conf-${++seq}`, ...c });
  };

  if (plan) {
    // perfis divergentes entre Dieta_Calendario e Planilha Semanal: o usuário escolhe
    for (const d of plan.dayPlans.filter((x) => x.crossCheck === 'divergente')) {
      push({
        subject: `Perfil do dia ${d.date}`,
        field: 'perfil nutricional',
        planValue: d.profileName,
        baseValue: d.profileSource.note,
        planSource: d.profileSource,
        operational: 'plan',
        requiresChoice: true,
        note: 'Dieta_Calendario × Planilha Semanal (ambos do plano).',
      });
    }
  }
  if (!plan || !base) return { conflicts, issues, matches };

  const baseFoods = base.foods;
  for (const pf of plan.foods) {
    const cands = baseFoods.filter((bf) => sameFood(pf.originalName, bf.originalName));
    matches[pf.id] = cands.map((c) => c.id);
    if (!cands.length) {
      issues.info('ausente', `"${pf.originalName}" (plano) não existe na dieta-base${pf.sourceNote ? ` — fonte informada: ${pf.sourceNote}` : ''}.`, pf.source);
      continue;
    }
    const sameMeasure = cands.filter((c) => c.baseMeasure.value === pf.baseMeasure.value && c.unit === pf.unit);
    if (!sameMeasure.length) {
      const sameQtyOtherUnit = cands.find((c) => c.baseMeasure.value !== null && c.unit && c.unit !== pf.unit);
      if (sameQtyOtherUnit) {
        push({
          subject: pf.originalName,
          field: 'unidade',
          planValue: `${pf.baseMeasure.value} ${pf.unit}`,
          baseValue: `${String(sameQtyOtherUnit.baseMeasure.original).trim()} (${sameQtyOtherUnit.unit})`,
          planSource: pf.source,
          baseSource: sameQtyOtherUnit.source,
          operational: 'plan',
          requiresChoice: false,
          note: 'Unidades diferentes — sem conversão automática g↔ml.',
        });
      }
      // compara proporcionalmente com a porção de mesma unidade mais próxima
      const prop = cands.find((c) => c.unit === pf.unit && c.baseMeasure.value);
      if (prop) compareMacros(pf, prop, (prop.baseMeasure.value ?? 1) / (pf.baseMeasure.value ?? 1));
      continue;
    }
    // várias porções iguais (ex.: banana 100 g em duas listas) → compara com cada uma
    for (const bf of sameMeasure) compareMacros(pf, bf, 1);
  }

  function compareMacros(pf: Food, bf: Food, factor: number) {
    for (const [key, label] of MACROS) {
      const pv = pf[key].value;
      const bvRaw = bf[key].value;
      const bv = bvRaw === null ? null : round2(bvRaw / factor);
      if (pv === null && bv === null) continue;
      if (pv !== null && bv !== null && Math.abs(pv - bv) <= 0.05) continue;
      // célula vazia na base × 0 no plano: mesma informação (o plano copiou o vazio como zero)
      if (pv === 0 && bv === null) continue;
      push({
        subject: pf.originalName,
        field: label,
        planValue: pv,
        baseValue: bv === null ? 'vazio' : bv,
        planSource: { ...pf.source, cell: pf[key].cell, original: pf[key].original },
        baseSource: { ...bf.source, cell: bf[key].cell, original: bf[key].original, note: factor !== 1 ? `proporcional a ${String(bf.baseMeasure.original).trim()}` : undefined },
        operational: 'plan',
        requiresChoice: false,
        note: `Plano por ${pf.baseMeasure.value} ${pf.unit}; dieta-base ${String(bf.baseMeasure.original).trim()} (${bf.sourceNote}).`,
      });
    }
  }

  // dados físicos e totais
  const ath = base.baseDiet?.athlete;
  if (ath && plan.weightKg && plan.weightKg.value !== null && ath.weightKg.value !== null && plan.weightKg.value !== ath.weightKg.value) {
    push({
      subject: 'Peso do atleta',
      field: 'peso (kg)',
      planValue: plan.weightKg.value,
      baseValue: ath.weightKg.value,
      planSource: { fileKind: 'plan', fileName: plan.book.fileName, sheet: 'Dieta_Resumo', cell: plan.weightKg.cell, status: 'configuravel' },
      baseSource: { fileKind: 'baseDiet', fileName: base.book.fileName, sheet: 'TMB', cell: ath.weightKg.cell, status: 'ok' },
      operational: 'plan',
      requiresChoice: false,
    });
  }
  const expGuideline = plan.guidelines.find((g) => g.sheet === 'Dieta_Resumo' && /gasto di[aá]rio/i.test(g.title));
  if (expGuideline && ath?.dailyExpenditureKcal.value) {
    const planExp = Number(expGuideline.value.split(' · ')[0].replace(',', '.'));
    if (Number.isFinite(planExp)) {
      const diff = round2(planExp - ath.dailyExpenditureKcal.value);
      if (Math.abs(diff) > 0.5) {
        push({
          subject: 'Gasto calórico diário',
          field: 'kcal',
          planValue: planExp,
          baseValue: ath.dailyExpenditureKcal.value,
          planSource: expGuideline.source,
          baseSource: { fileKind: 'baseDiet', fileName: base.book.fileName, sheet: 'TMB', cell: ath.dailyExpenditureKcal.cell, status: 'ok' },
          operational: 'plan',
          requiresChoice: false,
        });
      } else if (diff !== 0) {
        issues.info('divergencia', `Gasto diário: plano ${planExp} × dieta-base ${round2(ath.dailyExpenditureKcal.value)} — diferença de arredondamento (${diff}).`, expGuideline.source);
      }
    }
  }
  const baseTotals = base.baseDiet?.dayTotals;
  const cmp = plan.guidelines.find((g) => g.sheet === 'Dieta_Resumo' && /^dieta base atual/i.test(g.title));
  if (cmp && baseTotals?.kcal.value) {
    const planKcal = Number(cmp.value.split(' · ')[0]);
    if (Number.isFinite(planKcal) && Math.abs(planKcal - baseTotals.kcal.value) > 0.5) {
      push({
        subject: 'Total da dieta-base',
        field: 'kcal/dia',
        planValue: planKcal,
        baseValue: baseTotals.kcal.value,
        planSource: cmp.source,
        operational: 'base',
        requiresChoice: false,
        note: 'Valor histórico: a própria dieta-base prevalece.',
      });
    }
  }
  // texto do plano sobre refeições vazias × arquivo
  const empty = base.baseDiet?.meals.filter((m) => m.isEmpty).map((m) => m.number) ?? [];
  const emptyText = plan.guidelines.find((g) => /vazias/i.test(g.value) && g.sheet === 'Dieta_Analise');
  if (emptyText && empty.length) {
    const label = `${Math.min(...empty)}–${Math.max(...empty)}`;
    if (!emptyText.title.includes(label)) {
      issues.info('divergencia', `Dieta_Analise cita "${emptyText.title}" vazias; na dieta-base as refeições ${label} estão vazias.`, emptyText.source);
    }
  }
  return { conflicts, issues, matches };
}

export function buildReport(plan: PlanImport | null, base: BaseDietImport | null, cross: CrossCheckResult): ImportReport {
  const all = [...(plan?.issues.issues ?? []), ...(base?.issues.issues ?? []), ...cross.issues.issues];
  const files: ImportReport['files'] = [];
  for (const imp of [plan, base]) {
    if (!imp) continue;
    files.push({
      kind: imp.book.kind,
      fileName: imp.book.fileName,
      format: imp.book.format,
      sheets: imp.book.wb.SheetNames,
      formulas: imp.book.formulas,
      formulasWithoutCache: imp.book.formulasWithoutCache.length,
      mergedRanges: imp.book.mergedRanges,
    });
  }
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(plan?.counts ?? {})) counts[`plano.${k}`] = v;
  for (const [k, v] of Object.entries(base?.counts ?? {})) counts[`base.${k}`] = v;
  const foods = base?.foods ?? [];
  counts['base.registrosValidos'] = foods.filter((f) => f.status === 'ok').length;
  counts['base.registrosIncompletos'] = foods.filter((f) => f.status === 'nao_informado').length;
  counts['base.possiveisDuplicatas'] = foods.filter((f) => f.duplicateGroup).length;
  counts['base.valoresSuspeitos'] = foods.filter((f) => f.status === 'inconsistente').length;
  counts['plano.alimentosValidos'] = (plan?.foods ?? []).filter((f) => f.status === 'ok').length;
  counts['divergencias'] = cross.conflicts.length;
  counts['camposVazios'] = all.filter((i) => i.category === 'campo_vazio').length;
  counts['formulasSemResultado'] = files.reduce((a, f) => a + f.formulasWithoutCache, 0);
  return {
    generatedAt: new Date().toISOString(),
    files,
    counts,
    issues: all,
    conflicts: cross.conflicts,
    blocking: all.filter((i) => i.severity === 'bloqueador').length,
    warnings: all.filter((i) => i.severity === 'aviso').length,
  };
}

export function describeSource(s: SourceReference | undefined): string {
  if (!s) return 'origem não registrada';
  const kind = s.fileKind === 'plan' ? 'Plano' : s.fileKind === 'baseDiet' ? 'Dieta-base' : s.fileKind === 'user' ? 'Usuário' : 'App';
  return [kind, s.sheet, s.cell].filter(Boolean).join(' › ');
}
