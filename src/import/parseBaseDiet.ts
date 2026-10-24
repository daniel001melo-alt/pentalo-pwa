import type { AthleteProfile, BaseDiet, BaseDietMeal, Food, FoodCategory, SourcedNumber } from '../domain/schemas';
import { IssueCollector } from './issues';
import { kcal449, normalizeName, parseDecimal, parseQuantity, round2, similarityKey, sourced } from './normalize';
import { findSheet, range, SheetReader, type LoadedWorkbook } from './workbook';

export interface BaseDietImport {
  book: LoadedWorkbook;
  baseDiet: BaseDiet | null;
  /** porções das listas de equivalência + itens das refeições */
  foods: Food[];
  issues: IssueCollector;
  counts: Record<string, number>;
}

const LIST_HEADERS: [RegExp, FoodCategory][] = [
  [/carbo\s+para\s+cutting/i, 'carbo_cutting'],
  [/carbo\s+para\s+bulking/i, 'carbo_bulking'],
  [/^prote[ií]nas?$/i, 'proteina'],
  [/^gorduras?$/i, 'gordura'],
];

// aplicados ao nome normalizado (sem acentos), pois \b do JS só reconhece ASCII
const LIQUIDS = /^(leite|suco|agua|azeite|oleo|creme de leite)\b/;
const COUNTABLE = /\bovos?\b/;

function direct(sr: SheetReader, r: number, c: number): string {
  const v = sr.cell(r, c)?.v;
  return v === undefined || v === null ? '' : String(v).replace(/\r\n/g, '\n').trim();
}

export function parseBaseDietWorkbook(book: LoadedWorkbook): BaseDietImport {
  const issues = new IssueCollector('base');
  const out: BaseDietImport = { book, baseDiet: null, foods: [], issues, counts: {} };
  const dietName = findSheet(book, 'DIETA');
  const tmbName = findSheet(book, 'TMB');
  const medName = findSheet(book, 'MEDIDAS');
  if (!dietName) {
    issues.blocker('estrutura', 'Aba "DIETA" não encontrada na dieta-base.');
    return out;
  }
  if (!tmbName) issues.warn('estrutura', 'Aba "TMB" não encontrada — dados físicos ficarão como Não informado.');
  if (!medName) issues.info('estrutura', 'Aba "MEDIDAS" não encontrada.');
  if (book.formulasWithoutCache.length) {
    issues.warn(
      'formula_sem_cache',
      `${book.formulasWithoutCache.length} fórmula(s) sem resultado salvo (${book.formulasWithoutCache.slice(0, 6).join(', ')}…). Totais serão recalculados para conferência.`,
      {
        fileKind: 'baseDiet',
        fileName: book.fileName,
        status: 'requer_validacao',
      },
    );
  }

  if (book.errorCells.length) {
    issues.warn('inconsistencia', `${book.errorCells.length} célula(s) com erro do Excel tratadas como Não informado: ${book.errorCells.slice(0, 6).join(', ')}.`, {
      fileKind: 'baseDiet',
      fileName: book.fileName,
      status: 'inconsistente',
    });
  }
  const dietSr = new SheetReader(book, dietName);
  const athlete = tmbName ? parseAthlete(new SheetReader(book, tmbName), out) : emptyAthlete();
  const meals = parseMeals(dietSr, out);
  const listFoods = parseLists(dietSr, out);
  out.foods = [...meals.flatMap((m) => m.items), ...listFoods];
  detectNumberText(dietSr, out);
  detectDisproportions(listFoods, out);
  markDuplicates(out.foods, out);

  const dayTotals = parseDayTotals(dietSr, athlete, meals, out);
  const measurements = medName ? parseMeasurements(new SheetReader(book, medName), out) : { labels: [], dates: [], values: [], isEmpty: true };
  out.baseDiet = {
    id: 'base',
    title: dietSr.text(0, 0) || 'Dieta-base',
    athlete,
    meals,
    dayTotals,
    measurements,
    notes: [],
    source: dietSr.ref(0, 0),
  };
  out.counts = {
    refeicoes: meals.length,
    refeicoesPreenchidas: meals.filter((m) => !m.isEmpty).length,
    refeicoesVazias: meals.filter((m) => m.isEmpty).length,
    itensRefeicoes: meals.reduce((a, m) => a + m.items.length, 0),
    porcoesListas: listFoods.length,
    nomesDistintos: new Set(out.foods.map((f) => normalizeName(f.originalName))).size,
    medidasPreenchidas: measurements.values.flat().filter((v) => v !== null).length,
  };
  return out;
}

function emptyAthlete(): AthleteProfile {
  const e: SourcedNumber = { original: null, value: null, status: 'nao_informado' };
  return { weightKg: e, heightCm: e, ageYears: e, activityFactor: e, dailyExpenditureKcal: e, notes: [] };
}

function parseAthlete(sr: SheetReader, out: BaseDietImport): AthleteProfile {
  const pick = (label: RegExp) => {
    const cell = sr.find((t) => label.test(t.trim()));
    if (!cell) return { value: { original: null, value: null, status: 'nao_informado' } as SourcedNumber, formula: null as string | null };
    const v = sourced(sr.raw(cell.r, cell.c + 1), `${sr.name}!${SheetReader.addr(cell.r, cell.c + 1)}`);
    return { value: v, formula: sr.formula(cell.r, cell.c + 1) };
  };
  const weight = pick(/^peso$/i);
  const height = pick(/^altura$/i);
  const age = pick(/^idade$/i);
  const fa = pick(/^fa$/i);
  const gcd = pick(/^gcd$/i);
  for (const [name, v] of [
    ['Peso', weight],
    ['Altura', height],
    ['Idade', age],
    ['Fator de atividade', fa],
  ] as const) {
    if (v.value.value === null) out.issues.warn('campo_vazio', `TMB: ${name} não informado.`, { fileKind: 'baseDiet', fileName: sr.book.fileName, sheet: sr.name, status: 'nao_informado' });
  }
  // confere o GCD com a própria fórmula do arquivo (Harris-Benedict × FA)
  if (gcd.formula && weight.value.value && height.value.value && age.value.value && fa.value.value) {
    const expected = fa.value.value * (66.47 + 13.75 * weight.value.value + 5 * height.value.value - 6.8 * age.value.value);
    if (/66\.47/.test(gcd.formula) && gcd.value.value !== null && Math.abs(expected - gcd.value.value) > 1) {
      out.issues.warn('inconsistencia', `GCD em cache (${gcd.value.value}) difere da fórmula do arquivo (${round2(expected)}).`);
    }
    if (gcd.value.value === null) {
      gcd.value = { ...gcd.value, value: round2(expected), status: 'calculado' };
      out.issues.info('formula_sem_cache', `GCD sem resultado salvo — recalculado pela fórmula do próprio arquivo: ${round2(expected)} kcal.`);
    }
  }
  const notes: string[] = [];
  for (const r of range(0, sr.maxRow))
    for (const c of range(0, sr.maxCol)) {
      const t = sr.text(r, c);
      if (t.length > 60) notes.push(t.replace(/\s{2,}/g, ' '));
    }
  return {
    weightKg: weight.value,
    heightCm: height.value,
    ageYears: age.value,
    activityFactor: fa.value,
    dailyExpenditureKcal: gcd.value,
    expenditureFormula: gcd.formula ?? undefined,
    notes,
  };
}

interface Group {
  pa: number;
}

function mealItemFood(sr: SheetReader, r: number, pa: number, category: FoodCategory, out: BaseDietImport, context: string): Food | null {
  const qtyC = pa - 2;
  const nameC = pa - 1;
  const name = direct(sr, r, nameC);
  if (!name || /^ptn \(a\)$/i.test(direct(sr, r, pa))) return null;
  return buildFood(sr, r, qtyC, nameC, pa, category, out, context);
}

function buildFood(sr: SheetReader, r: number, qtyC: number, nameC: number, pa: number, category: FoodCategory, out: BaseDietImport, context: string): Food {
  const name = sr.text(r, nameC);
  const qRaw = sr.raw(r, qtyC);
  const q = parseQuantity(qRaw);
  const issues: string[] = [];
  let status: Food['status'] = 'ok';
  let unit: string = q.unit ?? '';
  if (q.value === null) {
    status = 'inconsistente';
    issues.push(`Quantidade não interpretável: "${String(qRaw ?? '')}".`);
  } else if (!q.unit) {
    if (COUNTABLE.test(normalizeName(name))) {
      unit = 'un';
      status = 'requer_validacao';
      issues.push('Quantidade sem unidade escrita — interpretada como unidade(s).');
    } else {
      status = 'inconsistente';
      issues.push(`Quantidade "${String(qRaw)}" sem unidade associada.`);
      out.issues.warn('unidade', `${context}: "${name}" com quantidade ${String(qRaw)} sem unidade.`, sr.ref(r, qtyC, 'inconsistente', { original: qRaw }));
    }
  } else if (q.unit === 'g' && LIQUIDS.test(normalizeName(name)) && !/em po\b/.test(normalizeName(name))) {
    status = 'requer_validacao';
    issues.push('Líquido medido em gramas (g) na planilha — confirmar se g ou ml.');
    out.issues.info('unidade', `${context}: "${name}" (${String(qRaw).trim()}) — líquido medido em g.`, sr.ref(r, qtyC, 'requer_validacao', { original: qRaw }));
  }
  const pa_ = sourced(sr.raw(r, pa), SheetReader.addr(r, pa), 'nao_informado');
  const pv_ = sourced(sr.raw(r, pa + 1), SheetReader.addr(r, pa + 1), 'nao_informado');
  const carbs = sourced(sr.raw(r, pa + 2), SheetReader.addr(r, pa + 2), 'nao_informado');
  const fat = sourced(sr.raw(r, pa + 3), SheetReader.addr(r, pa + 3), 'nao_informado');
  const anyText = [pa_, pv_, carbs, fat].some((v) => typeof v.original === 'string' && v.value !== null);
  if (anyText) {
    status = status === 'ok' ? 'requer_validacao' : status;
    issues.push('Número armazenado como texto com vírgula decimal — normalizado.');
  }
  const proteinValue = pa_.value === null && pv_.value === null ? null : round2((pa_.value ?? 0) + (pv_.value ?? 0));
  const protein: SourcedNumber = {
    original: { animal: pa_.original, vegetal: pv_.original },
    value: proteinValue,
    cell: `${pa_.cell}+${pv_.cell}`,
    status: proteinValue === null ? 'nao_informado' : 'ok',
  };
  const noMacros = proteinValue === null && carbs.value === null && fat.value === null;
  if (noMacros) {
    status = 'nao_informado';
    issues.push('Porção sem macronutrientes informados.');
    out.issues.warn('campo_vazio', `${context}: "${name}" ${String(qRaw ?? '').trim()} sem macros.`, sr.ref(r, nameC, 'nao_informado'));
  }
  const calc = noMacros ? null : kcal449(proteinValue, carbs.value, fat.value);
  return {
    id: `base:${sr.name}!${SheetReader.addr(r, nameC)}`,
    origin: 'baseDiet',
    originalName: name,
    normalizedName: normalizeName(name),
    category,
    baseMeasure: { original: qRaw ?? null, value: q.value, cell: SheetReader.addr(r, qtyC), status: q.value === null ? 'inconsistente' : 'ok' },
    unit,
    unitOriginal: q.unitOriginal,
    proteinAnimal: pa_,
    proteinVegetal: pv_,
    protein,
    carbs,
    fat,
    kcalReported: null,
    kcalCalculated: calc,
    kcalDifference: null,
    note: name.includes('*') ? 'Ver nota "*" da planilha' : null,
    sourceNote: context,
    status,
    issues,
    duplicateGroup: null,
    source: sr.ref(r, [qtyC, pa + 3], status, { original: name }),
  };
}

function parseMeals(sr: SheetReader, out: BaseDietImport): BaseDietMeal[] {
  const headers: { r: number; c: number; n: number; title: string }[] = [];
  for (const r of range(0, sr.maxRow))
    for (const c of range(0, sr.maxCol)) {
      const m = direct(sr, r, c).match(/^Refei[cç][aã]o\s+(\d+)$/i);
      if (m) headers.push({ r, c, n: Number(m[1]), title: direct(sr, r, c) });
    }
  if (!headers.length) {
    out.issues.blocker('estrutura', 'Nenhum bloco "Refeição N" encontrado na aba DIETA.');
    return [];
  }
  // colunas "Ptn (A)" da primeira faixa de cabeçalhos definem os grupos de colunas
  const groups: Group[] = [];
  const firstRow = Math.min(...headers.map((h) => h.r));
  for (const c of range(0, sr.maxCol)) if (/^ptn \(a\)$/i.test(sr.text(firstRow + 1, c))) groups.push({ pa: c });
  if (!groups.length) {
    out.issues.blocker('estrutura', 'Colunas "Ptn (A)" não encontradas abaixo dos cabeçalhos de refeição.');
    return [];
  }
  const meals: BaseDietMeal[] = [];
  for (const h of headers.sort((a, b) => a.n - b.n)) {
    const g = groups.find((x) => x.pa >= h.c) ?? groups[groups.length - 1];
    const qtyC = g.pa - 2;
    let totalsRow = -1;
    for (let r = h.r + 1; r <= Math.min(sr.maxRow, h.r + 15); r++) {
      if (/^kcals?$/i.test(sr.text(r, qtyC))) {
        totalsRow = r;
        break;
      }
    }
    if (totalsRow < 0) {
      out.issues.warn('estrutura', `${h.title}: linha de totais não encontrada.`, sr.ref(h.r, h.c));
      continue;
    }
    const items: Food[] = [];
    for (let r = h.r + 1; r < totalsRow; r++) {
      const f = mealItemFood(sr, r, g.pa, 'refeicao_base', out, h.title);
      if (f) items.push(f);
    }
    const t = (c: number, row = totalsRow) => sourced(sr.raw(row, c), SheetReader.addr(row, c), 'nao_informado');
    const totalsReported = { proteinAnimal: t(g.pa), proteinVegetal: t(g.pa + 1), carbs: t(g.pa + 2), fat: t(g.pa + 3), kcal: t(qtyC, totalsRow + 1) };
    const sum = (sel: (f: Food) => number | null) => round2(items.reduce((a, f) => a + (sel(f) ?? 0), 0));
    const totalsComputed = {
      protein: sum((f) => f.protein.value),
      carbs: sum((f) => f.carbs.value),
      fat: sum((f) => f.fat.value),
      kcal: 0,
    };
    totalsComputed.kcal = kcal449(totalsComputed.protein, totalsComputed.carbs, totalsComputed.fat) ?? 0;
    const repP = (totalsReported.proteinAnimal.value ?? 0) + (totalsReported.proteinVegetal.value ?? 0);
    const isEmpty = items.length === 0;
    if (isEmpty) out.issues.info('campo_vazio', `${h.title} está vazia na dieta-base.`, sr.ref(h.r, h.c, 'nao_informado'));
    else if (totalsReported.kcal.value !== null && Math.abs(totalsReported.kcal.value - totalsComputed.kcal) > 1) {
      out.issues.warn('divergencia', `${h.title}: total do arquivo ${totalsReported.kcal.value} kcal × soma conferida ${totalsComputed.kcal} kcal.`, sr.ref(totalsRow + 1, qtyC, 'inconsistente'));
    } else if (Math.abs(repP - totalsComputed.protein) > 0.1) {
      out.issues.warn('divergencia', `${h.title}: proteína do arquivo ${repP} × soma conferida ${totalsComputed.protein}.`, sr.ref(totalsRow, g.pa, 'inconsistente'));
    }
    if (!isEmpty && totalsReported.kcal.value === null) out.issues.info('formula_sem_cache', `${h.title}: total sem cache — usando soma conferida.`);
    meals.push({ number: h.n, title: h.title, isEmpty, items, totalsReported, totalsComputed, source: sr.ref(h.r, h.c) });
  }
  return meals;
}

function parseLists(sr: SheetReader, out: BaseDietImport): Food[] {
  const heads: { r: number; c: number; cat: FoodCategory; label: string }[] = [];
  for (const r of range(0, sr.maxRow))
    for (const c of range(0, sr.maxCol)) {
      const t = sr.cell(r, c)?.v;
      if (typeof t !== 'string') continue;
      for (const [re, cat] of LIST_HEADERS) if (re.test(t.trim())) heads.push({ r, c, cat, label: t.trim() });
    }
  const foods: Food[] = [];
  for (const h of heads) {
    const nextInCol = heads.filter((x) => x.c === h.c && x.r > h.r).sort((a, b) => a.r - b.r)[0];
    const end = nextInCol ? nextInCol.r - 1 : sr.maxRow;
    let note: string | null = null;
    for (let r = h.r + 1; r <= end; r++) {
      // células mescladas (nota L79:Q82) não podem virar "alimento": lê só a célula direta
      const name = direct(sr, r, h.c + 1);
      const qty = direct(sr, r, h.c);
      if (!name) {
        if (qty.length > 25) note = qty.replace(/\s{2,}/g, ' ');
        continue;
      }
      foods.push(buildFood(sr, r, h.c, h.c + 1, h.c + 2, h.cat, out, h.label));
    }
    if (note) {
      for (const f of foods) if (f.category === h.cat && f.originalName.includes('*')) f.note = note;
      out.issues.info('estrutura', `Nota da lista "${h.label}": ${note}`);
    }
  }
  return foods;
}

function detectNumberText(sr: SheetReader, out: BaseDietImport) {
  for (const addr of Object.keys(sr.ws)) {
    if (addr[0] === '!') continue;
    const c = sr.ws[addr];
    if (c.t === 's' && typeof c.v === 'string' && /^\s*-?\d+,\d+\s*$/.test(c.v)) {
      out.issues.warn('numero_texto', `${addr}: número armazenado como texto "${c.v}" → normalizado ${parseDecimal(c.v)} (original preservado).`, {
        fileKind: 'baseDiet',
        fileName: sr.book.fileName,
        sheet: sr.name,
        cell: addr,
        original: c.v,
        normalized: parseDecimal(c.v),
        status: 'requer_validacao',
      });
    }
  }
}

/** Mesma lista, mesmo alimento, mesma unidade: macros devem ser proporcionais à quantidade. */
function detectDisproportions(foods: Food[], out: BaseDietImport) {
  const groups = new Map<string, Food[]>();
  for (const f of foods) {
    if (f.baseMeasure.value === null || !f.unit) continue;
    const k = `${f.category}|${similarityKey(f.originalName)}|${f.unit}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const ref = g.find((f) => f.status !== 'nao_informado') ?? g[0];
    for (const f of g) {
      if (f === ref || f.status === 'nao_informado' || ref.status === 'nao_informado') continue;
      const factor = (f.baseMeasure.value ?? 0) / (ref.baseMeasure.value ?? 1);
      const bad: string[] = [];
      for (const [label, key] of [
        ['proteína', 'protein'],
        ['carboidrato', 'carbs'],
        ['gordura', 'fat'],
      ] as const) {
        const exp = (ref[key].value ?? 0) * factor;
        const got = f[key].value ?? 0;
        if (Math.abs(got - exp) > Math.max(0.15, exp * 0.1)) bad.push(`${label} ${got} (proporcional: ${round2(exp)})`);
      }
      if (bad.length) {
        f.status = 'inconsistente';
        f.issues.push(`Não proporcional a ${ref.baseMeasure.original} (${ref.source.cell}): ${bad.join('; ')}.`);
        out.issues.warn(
          'nutricional_suspeito',
          `${f.sourceNote}: ${f.originalName} ${String(f.baseMeasure.original).trim()} — ${bad.join('; ')} em relação a ${String(ref.baseMeasure.original).trim()}.`,
          f.source,
        );
      }
    }
  }
  // mesma porção com valores diferentes (entre listas)
  const same = new Map<string, Food[]>();
  for (const f of foods) {
    if (f.baseMeasure.value === null) continue;
    const k = `${similarityKey(f.originalName)}|${f.baseMeasure.value}|${f.unit}`;
    same.set(k, [...(same.get(k) ?? []), f]);
  }
  for (const g of same.values()) {
    const sig = new Set(g.map((f) => `${f.protein.value}|${f.carbs.value}|${f.fat.value}`));
    if (g.length > 1 && sig.size > 1) {
      for (const f of g) if (f.status === 'ok') f.status = 'inconsistente';
      g.forEach((f) =>
        f.issues.push(
          `Mesma porção com valores diferentes em outra lista (${g
            .filter((x) => x !== f)
            .map((x) => x.source.cell)
            .join(', ')}).`,
        ),
      );
      out.issues.warn(
        'divergencia',
        `"${g[0].originalName}" ${String(g[0].baseMeasure.original).trim()}: valores diferentes entre listas (${g.map((f) => `${f.source.cell}: P ${f.protein.value ?? '—'} C ${f.carbs.value ?? '—'} G ${f.fat.value ?? '—'}`).join(' × ')}).`,
      );
    }
  }
}

/** Marca possíveis duplicatas (mesma chave de similaridade + mesma porção). Nunca une registros. */
function markDuplicates(foods: Food[], out: BaseDietImport) {
  const groups = new Map<string, Food[]>();
  for (const f of foods) {
    const k = `${similarityKey(f.originalName)}|${f.baseMeasure.value}|${f.unit}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  let n = 0;
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    n++;
    for (const f of g) f.duplicateGroup = k;
  }
  if (n) out.issues.info('duplicata', `${n} grupo(s) de possíveis duplicatas (mesmo alimento e porção em mais de um lugar). Mantidos separados.`);
  const variants = new Map<string, Set<string>>();
  for (const f of foods) {
    const k = similarityKey(f.originalName);
    variants.set(k, (variants.get(k) ?? new Set()).add(f.originalName.trim()));
  }
  for (const [, names] of variants) {
    if (names.size > 1) out.issues.info('duplicata', `Variações de nome tratadas como possível mesmo alimento: ${[...names].map((x) => `"${x}"`).join(', ')}.`);
  }
}

function parseDayTotals(sr: SheetReader, athlete: AthleteProfile, meals: BaseDietMeal[], out: BaseDietImport): BaseDiet['dayTotals'] {
  const valAt = (cell: { r: number; c: number } | null, dc: number) =>
    cell ? sourced(sr.raw(cell.r, cell.c + dc), SheetReader.addr(cell.r, cell.c + dc)) : ({ original: null, value: null, status: 'nao_informado' } as SourcedNumber);
  const pa = sr.find((t) => /^protein \(a\)$/i.test(t));
  // os demais rótulos são procurados só na coluna do quadro de totais ("Fat" também é cabeçalho das refeições)
  const inCol = (re: RegExp, dc = 0) => (pa ? sr.find((t) => re.test(t), { col: pa.c + dc, fromRow: pa.r }) : null);
  const pv = inCol(/^protein \(v\)$/i);
  const cb = inCol(/^carbs$/i);
  const ft = inCol(/^fat$/i);
  const total = inCol(/^total$/i, 2);
  const surplus = inCol(/^excedente$/i, 2);
  if (!pa) out.issues.warn('estrutura', 'Quadro de totais do dia (Protein (A)/(V), Carbs, Fat) não encontrado.');
  const percent: Record<string, number | null> = {
    proteinAnimal: valAt(pa, 2).value,
    proteinVegetal: valAt(pv, 2).value,
    carbs: valAt(cb, 2).value,
    fat: valAt(ft, 2).value,
  };
  const perKg: Record<string, number | null> = {
    proteinAnimal: valAt(pa, 4).value,
    proteinVegetal: valAt(pv, 4).value,
    carbs: valAt(cb, 4).value,
    fat: valAt(ft, 4).value,
  };
  const totals = {
    proteinAnimal: valAt(pa, 1),
    proteinVegetal: valAt(pv, 1),
    carbs: valAt(cb, 1),
    fat: valAt(ft, 1),
    kcal: valAt(total, 1),
    surplus: valAt(surplus, 1),
    percent,
    perKg,
  };
  const computedKcal = round2(meals.reduce((a, m) => a + m.totalsComputed.kcal, 0));
  if (totals.kcal.value === null) {
    totals.kcal = { ...totals.kcal, value: computedKcal, status: 'calculado' };
  } else if (Math.abs(totals.kcal.value - computedKcal) > 1) {
    out.issues.warn('divergencia', `Total diário do arquivo ${totals.kcal.value} kcal × soma conferida das refeições ${computedKcal} kcal.`);
  }
  if (totals.surplus.value === null && athlete.dailyExpenditureKcal.value !== null && totals.kcal.value !== null) {
    totals.surplus = { ...totals.surplus, value: round2(totals.kcal.value - athlete.dailyExpenditureKcal.value), status: 'calculado' };
  }
  return totals;
}

function parseMeasurements(sr: SheetReader, out: BaseDietImport): BaseDiet['measurements'] {
  const labels: string[] = [];
  const rows: number[] = [];
  for (let r = 1; r <= sr.maxRow; r++) {
    const t = sr.text(r, 0);
    if (t) {
      labels.push(t);
      rows.push(r);
    }
  }
  const dates = range(1, sr.maxCol).map((c) => sr.text(0, c));
  const values = rows.map((r) => range(1, sr.maxCol).map((c) => parseDecimal(sr.raw(r, c))));
  const isEmpty = values.flat().every((v) => v === null);
  if (isEmpty) out.issues.info('campo_vazio', `Aba MEDIDAS: ${labels.length} medidas × ${dates.length} datas — todas vazias.`, sr.ref(0, 0, 'nao_informado'));
  return { labels, dates, values, isEmpty };
}
