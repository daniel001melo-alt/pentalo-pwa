import type {
  CoachNote,
  Competition,
  DayPlan,
  DietProfile,
  DietProfileId,
  Food,
  Guideline,
  Meal,
  MealItem,
  Mesocycle,
  PaceZone,
  ProgressionTable,
  SourceReference,
  SourcedNumber,
  SwimmingZone,
  TrainingPhase,
  TrainingSession,
  TrainingWeek,
} from '../domain/schemas';
import { IssueCollector } from './issues';
import { addDaysISO, compareKcal, kcal449, normalizeName, parseDecimal, parseDurationMinutes, round2, similarityKey, slug, sourced, toISODate, toTimeHHMM } from './normalize';
import { deriveIntensityLevel, deriveModality, extractContacts, extractIntervals, extractPace, extractZones, parseExercises, sessionKey, stripMarker } from './sessionText';
import { findSheet, range, SheetReader, type LoadedWorkbook } from './workbook';

export const REQUIRED_PLAN_SHEETS = ['Sessões (detalhe)', 'Dieta_Planos', 'Dieta_Calendario', 'Dieta_Resumo', 'Base_Alimentos'];
export const EXPECTED_PLAN_SHEETS = [
  'LEIA-ME',
  'Análise',
  'Periodização',
  'Visão Geral',
  'Planilha Semanal',
  'Sessões (detalhe)',
  'Corrida',
  'Natação',
  'Força',
  'Granada',
  'Tiro',
  'Pistas (substitutos)',
  'Biblioteca',
  'Zonas e Paces',
  'Dieta_Analise',
  'Dieta_Timing',
  'Dieta_Resumo',
  'Dieta_Planos',
  'Dieta_Calendario',
  'Base_Alimentos',
];

const WEEKDAYS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

export interface WeeklyBlock {
  period: string;
  marker: '»' | '◦' | null;
  type: string;
  duration: string;
  intensity: string;
  detail: string;
}

export interface PlanImport {
  book: LoadedWorkbook;
  competition: Competition | null;
  phases: TrainingPhase[];
  mesocycles: Mesocycle[];
  weeks: TrainingWeek[];
  sessions: TrainingSession[];
  dayPlans: DayPlan[];
  dietProfiles: DietProfile[];
  meals: Meal[];
  mealItems: MealItem[];
  foods: Food[];
  paceZones: PaceZone[];
  swimZones: SwimmingZone[];
  guidelines: Guideline[];
  progressionTables: ProgressionTable[];
  coachNotes: CoachNote[];
  weightKg: SourcedNumber | null;
  hydrationReference: { text: string; minMl: number | null; maxMl: number | null; source: SourceReference } | null;
  supplementReferences: { name: string; text: string; source: SourceReference }[];
  issues: IssueCollector;
  counts: Record<string, number>;
}

export function profileIdFromName(name: string): DietProfileId | null {
  const n = normalizeName(name);
  if (n.startsWith('intenso')) return 'intenso';
  if (n.startsWith('moderado')) return 'moderado';
  if (n.startsWith('leve')) return 'leve';
  if (n.startsWith('recuperacao')) return 'recuperacao';
  if (n.startsWith('pre prova') || n.startsWith('pre-prova')) return 'pre_prova';
  if (n.startsWith('dia de prova')) return 'dia_prova';
  return null;
}

function reader(book: LoadedWorkbook, name: string): SheetReader | null {
  const actual = findSheet(book, name);
  return actual ? new SheetReader(book, actual) : null;
}

function headerMap(sr: SheetReader, row: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of range(0, sr.maxCol)) {
    const t = normalizeName(sr.text(row, c));
    if (t) m.set(t, c);
  }
  return m;
}

function col(map: Map<string, number>, ...prefixes: string[]): number | null {
  for (const p of prefixes) for (const [k, v] of map) if (k.startsWith(p)) return v;
  return null;
}

export function parsePlanWorkbook(book: LoadedWorkbook): PlanImport {
  const issues = new IssueCollector('plano');
  const out: PlanImport = {
    book,
    competition: null,
    phases: [],
    mesocycles: [],
    weeks: [],
    sessions: [],
    dayPlans: [],
    dietProfiles: [],
    meals: [],
    mealItems: [],
    foods: [],
    paceZones: [],
    swimZones: [],
    guidelines: [],
    progressionTables: [],
    coachNotes: [],
    weightKg: null,
    hydrationReference: null,
    supplementReferences: [],
    issues,
    counts: {},
  };

  for (const s of REQUIRED_PLAN_SHEETS) {
    if (!findSheet(book, s)) issues.blocker('estrutura', `Aba obrigatória "${s}" não encontrada no planejamento.`);
  }
  for (const s of EXPECTED_PLAN_SHEETS) {
    if (!REQUIRED_PLAN_SHEETS.includes(s) && !findSheet(book, s)) issues.warn('estrutura', `Aba "${s}" não encontrada — conteúdo correspondente ficará indisponível.`);
  }
  if (book.formulasWithoutCache.length) {
    const bySheet = new Map<string, string[]>();
    for (const ref of book.formulasWithoutCache) {
      const [sheet, cell] = ref.split('!');
      bySheet.set(sheet, [...(bySheet.get(sheet) ?? []), cell]);
    }
    for (const [sheet, cells] of bySheet) {
      issues.warn(
        'formula_sem_cache',
        `${cells.length} fórmula(s) sem resultado salvo em "${sheet}" (${cells.slice(0, 6).join(', ')}${cells.length > 6 ? '…' : ''}). Abra e salve no Excel para gravar os resultados; quando possível o app recalcula.`,
        { fileKind: 'plan', fileName: book.fileName, sheet, status: 'requer_validacao' },
      );
    }
  }

  if (book.errorCells.length) {
    issues.warn(
      'inconsistencia',
      `${book.errorCells.length} célula(s) com erro do Excel tratadas como Não informado: ${book.errorCells.slice(0, 6).join(', ')}${book.errorCells.length > 6 ? '…' : ''}.`,
      {
        fileKind: 'plan',
        fileName: book.fileName,
        status: 'inconsistente',
      },
    );
  }

  const weekly = parseWeeklySheet(book, out);
  parseSessions(book, out, weekly);
  parseOverview(book, out);
  parsePeriodization(book, out);
  parseCalendar(book, out, weekly);
  parseFoods(book, out);
  parseProfiles(book, out);
  parseMealPlans(book, out);
  parseZones(book, out);
  parseGuidelines(book, out);
  parseProgressions(book, out);
  parseCompetition(book, out);

  out.counts = {
    semanas: out.weeks.length,
    fases: out.phases.length,
    mesociclos: out.mesocycles.length,
    sessoes: out.sessions.length,
    sessoesPrincipais: out.sessions.filter((s) => s.priority === 'principal').length,
    sessoesOpcionais: out.sessions.filter((s) => s.priority === 'opcional').length,
    perfis: out.dietProfiles.length,
    refeicoes: out.meals.length,
    itensRefeicao: out.mealItems.length,
    alimentosPlano: out.foods.length,
    diasComPerfil: out.dayPlans.filter((d) => d.profileId).length,
    zonasCorrida: out.paceZones.length,
    zonasNatacao: out.swimZones.length,
    orientacoes: out.guidelines.length,
    tabelasProgressao: out.progressionTables.length,
  };
  return out;
}

// ───────────────────────── Planilha Semanal ─────────────────────────

interface WeeklyData {
  /** semana → índice do dia (0=SEG) → blocos */
  blocks: Map<number, WeeklyBlock[][]>;
  /** semana → índice do dia → perfil escrito na linha "DIETA:" */
  diet: Map<number, (string | null)[]>;
  dietCells: Map<number, SourceReference[]>;
}

export function parseWeeklyCell(text: string): { blocks: WeeklyBlock[]; diet: string | null } {
  const parts = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  let diet: string | null = null;
  const blocks: WeeklyBlock[] = [];
  for (const p of parts) {
    const dm = p.match(/^DIETA:\s*(.+)$/i);
    if (dm) {
      diet = dm[1].trim();
      continue;
    }
    const [first, ...rest] = p.split('\n');
    const m = first.match(/^(?:\[(AM|PM|Casa)\]\s*)?([»◦])?\s*(.+)$/);
    if (!m) continue;
    const [type, duration = '', intensity = ''] = m[3].split(' | ').map((x) => x.trim());
    blocks.push({ period: m[1] ?? 'Único', marker: (m[2] as '»' | '◦' | undefined) ?? null, type, duration, intensity, detail: rest.join('\n') });
  }
  return { blocks, diet };
}

function parseWeeklySheet(book: LoadedWorkbook, out: PlanImport): WeeklyData {
  const data: WeeklyData = { blocks: new Map(), diet: new Map(), dietCells: new Map() };
  const sr = reader(book, 'Planilha Semanal');
  if (!sr) return data;
  const header = sr.find((t) => normalizeName(t) === 'semana', { col: 0 });
  if (!header) {
    out.issues.warn('estrutura', 'Cabeçalho "Semana" não encontrado na Planilha Semanal.', sr.ref(0, 0));
    return data;
  }
  const hm = headerMap(sr, header.r);
  const dayCols = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'].map((d) => col(hm, d));
  for (let r = header.r + 1; r <= sr.maxRow; r++) {
    const wm = sr.text(r, 0).match(/^S(\d+)$/);
    if (!wm) continue;
    const week = Number(wm[1]);
    const days: WeeklyBlock[][] = [];
    const diets: (string | null)[] = [];
    const cells: SourceReference[] = [];
    dayCols.forEach((c, i) => {
      if (c === null) {
        days.push([]);
        diets.push(null);
        cells.push(sr.ref(r, 0, 'nao_informado'));
        return;
      }
      const parsed = parseWeeklyCell(sr.text(r, c));
      days.push(parsed.blocks);
      diets.push(parsed.diet);
      cells.push(sr.ref(r, c, parsed.diet ? 'ok' : 'nao_informado', { original: parsed.diet }));
      for (const b of parsed.blocks) {
        if (!b.marker) out.issues.warn('campo_vazio', `S${week} ${WEEKDAYS[i]}: sessão "${b.type}" sem marcador » ou ◦.`, sr.ref(r, c, 'requer_validacao'));
      }
    });
    data.blocks.set(week, days);
    data.diet.set(week, diets);
    data.dietCells.set(week, cells);
    const obsRow = r + 1;
    if (/^observa/i.test(normalizeName(sr.text(obsRow, 2)))) {
      const text = sr.text(obsRow, 3);
      if (text) {
        out.coachNotes.push({
          id: `planilha-S${week}`,
          date: '',
          text,
          origin: 'planilha',
          week,
          source: sr.ref(obsRow, [3, 10], 'ok', { note: 'Observações da semana (célula mesclada D:K)' }),
        });
      }
    }
  }
  return data;
}

// ───────────────────────── Sessões ─────────────────────────

function parseSessions(book: LoadedWorkbook, out: PlanImport, weekly: WeeklyData) {
  const sr = reader(book, 'Sessões (detalhe)');
  if (!sr) return;
  const header = sr.find((t) => normalizeName(t) === 'semana', { col: 0 });
  if (!header) {
    out.issues.blocker('estrutura', 'Cabeçalho da lista de sessões não encontrado.', sr.ref(0, 0));
    return;
  }
  const hm = headerMap(sr, header.r);
  const C = {
    week: col(hm, 'semana'),
    date: col(hm, 'data'),
    day: col(hm, 'dia'),
    period: col(hm, 'periodo'),
    type: col(hm, 'tipo'),
    duration: col(hm, 'duracao'),
    intensity: col(hm, 'intensidade'),
    km: col(hm, 'corrida'),
    m: col(hm, 'natacao'),
    throws: col(hm, 'lanc'),
    detail: col(hm, 'detalhe'),
  };
  for (const [k, v] of Object.entries(C)) {
    if (v === null) out.issues.blocker('estrutura', `Coluna "${k}" não encontrada em Sessões (detalhe).`, sr.ref(header.r, 0));
  }
  if (Object.values(C).some((v) => v === null)) return;
  const c = C as Record<keyof typeof C, number>;
  const usedKeys = new Map<string, number>();
  const usedWeeklyBlocks = new Set<string>();
  let order = 0;
  for (let r = header.r + 1; r <= sr.maxRow; r++) {
    const weekNum = parseDecimal(sr.raw(r, c.week));
    if (weekNum === null) continue;
    const date = toISODate(sr.raw(r, c.date));
    const rowRef = sr.ref(r, [0, c.detail]);
    if (!date) {
      out.issues.blocker('estrutura', `Sessão sem data válida na linha ${r + 1}.`, sr.ref(r, c.date, 'inconsistente', { original: sr.raw(r, c.date) }));
      continue;
    }
    const weekday = sr.text(r, c.day).toUpperCase();
    const period = sr.text(r, c.period) || 'Único';
    const rawType = sr.text(r, c.type);
    const { type, marker: typeMarker } = stripMarker(rawType);
    const durationText = sr.text(r, c.duration) || null;
    const intensityText = sr.text(r, c.intensity) || null;
    const detail = sr.text(r, c.detail);
    const km = parseDecimal(sr.raw(r, c.km));
    const m = parseDecimal(sr.raw(r, c.m));
    const throws = parseDecimal(sr.raw(r, c.throws));
    const sIssues: string[] = [];

    // marcador: Planilha Semanal (» / ◦) tem precedência; Sessões só marca opcionais com "◦".
    const dayIdx = WEEKDAYS.indexOf(weekday);
    const blocks = weekly.blocks.get(weekNum)?.[dayIdx] ?? [];
    const bIdx = blocks.findIndex((b, i) => !usedWeeklyBlocks.has(`${weekNum}-${dayIdx}-${i}`) && normalizeName(b.type) === normalizeName(type) && normalizeName(b.period) === normalizeName(period));
    let marker: '»' | '◦';
    if (bIdx >= 0) {
      usedWeeklyBlocks.add(`${weekNum}-${dayIdx}-${bIdx}`);
      const wb = blocks[bIdx];
      marker = wb.marker ?? (typeMarker === '◦' ? '◦' : '»');
      if (wb.marker && typeMarker === '◦' && wb.marker !== '◦') sIssues.push('Marcador diverge entre Planilha Semanal e Sessões (detalhe).');
    } else {
      marker = typeMarker === '◦' ? '◦' : '»';
      if (weekly.blocks.size) sIssues.push('Sessão não localizada na Planilha Semanal; marcador inferido de Sessões (detalhe).');
    }

    const dur = parseDurationMinutes(durationText);
    if (dur.minutes === null) {
      sIssues.push(`Duração não numérica: "${durationText ?? 'vazio'}".`);
      out.issues.info(
        'campo_vazio',
        `S${weekNum} ${weekday} "${type}": duração "${durationText ?? 'vazia'}" — tratada como Não informado.`,
        sr.ref(r, c.duration, 'nao_informado', { original: durationText }),
      );
    }
    const limit = detail.match(/≤\s?(\d+)\s?'/);
    if (limit && dur.minutes !== null && dur.minutes > Number(limit[1]) + 10) {
      sIssues.push(`Duração ${durationText} difere do limite "≤${limit[1]}'" do detalhe.`);
      out.issues.warn('inconsistencia', `S${weekNum} ${weekday} "${type}": duração ${durationText} × detalhe "≤${limit[1]}'".`, sr.ref(r, c.duration, 'inconsistente', { original: durationText }));
    }
    const expectedDay = dayIdx >= 0 ? dayIdx : null;
    const jsDay = new Date(date + 'T00:00:00Z').getUTCDay();
    if (expectedDay !== null && (jsDay + 6) % 7 !== expectedDay) {
      sIssues.push('Dia da semana não confere com a data.');
      out.issues.warn('inconsistencia', `Linha ${r + 1}: ${weekday} não corresponde a ${date}.`, rowRef);
    }

    let key = sessionKey(date, period, type);
    const n = usedKeys.get(key) ?? 0;
    usedKeys.set(key, n + 1);
    if (n > 0) key = `${key}#${n + 1}`;

    out.sessions.push({
      key,
      week: weekNum,
      date,
      weekday,
      period,
      order: order++,
      type,
      modality: deriveModality(type, km, m, throws),
      priority: marker === '◦' ? 'opcional' : 'principal',
      marker,
      durationText,
      durationMin: dur.minutes,
      intensityText,
      intensityLevel: deriveIntensityLevel(intensityText),
      zone: extractZones(intensityText, detail),
      pace: extractPace(intensityText, detail),
      runKm: km,
      swimM: m,
      throws,
      contacts: extractContacts(detail),
      intervals: extractIntervals(detail),
      detail,
      exercises: parseExercises(detail),
      source: { ...rowRef, original: rawType, status: sIssues.length ? 'requer_validacao' : 'ok' },
      issues: sIssues,
    });
  }
  // blocos da Planilha Semanal que não existem na lista
  for (const [week, days] of weekly.blocks) {
    days.forEach((blocks, d) =>
      blocks.forEach((b, i) => {
        if (!usedWeeklyBlocks.has(`${week}-${d}-${i}`)) {
          out.issues.warn('divergencia', `S${week} ${WEEKDAYS[d]}: "${b.type}" está na Planilha Semanal mas não em Sessões (detalhe).`);
        }
      }),
    );
  }
}

// ───────────────────────── Visão Geral / Periodização ─────────────────────────

function parseDatesLabel(label: string): { start: string | null; end: string | null } {
  const m = label.replace(/\n/g, ' ').match(/(\d{1,2})\/(\d{1,2})\s*(?:–|-|a)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return { start: null, end: null };
  const endYear = m[5] ? (m[5].length === 2 ? 2000 + Number(m[5]) : Number(m[5])) : null;
  if (!endYear) return { start: null, end: null };
  const startYear = Number(m[2]) > Number(m[4]) ? endYear - 1 : endYear;
  const p = (n: string) => n.padStart(2, '0');
  return { start: `${startYear}-${p(m[2])}-${p(m[1])}`, end: `${endYear}-${p(m[4])}-${p(m[3])}` };
}

function parseOverview(book: LoadedWorkbook, out: PlanImport) {
  const sr = reader(book, 'Visão Geral');
  const firstDate = out.sessions.length ? out.sessions.map((s) => s.date).sort()[0] : null;
  const computed = (w: number) => {
    const ss = out.sessions.filter((s) => s.week === w);
    return {
      runKm: round2(ss.reduce((a, s) => a + (s.runKm ?? 0), 0)),
      swimM: round2(ss.reduce((a, s) => a + (s.swimM ?? 0), 0)),
      throws: ss.reduce((a, s) => a + (s.throws ?? 0), 0),
      sessions: ss.filter((s) => s.type !== 'Flexibilidade / mobilidade').length,
    };
  };
  if (!sr) {
    // sem a aba, as semanas são derivadas das sessões
    const weeksNums = [...new Set(out.sessions.map((s) => s.week))].sort((a, b) => a - b);
    for (const w of weeksNums) {
      const start = firstDate ? addDaysISO(firstDate, (w - 1) * 7) : '';
      out.weeks.push({
        number: w,
        startDate: start,
        endDate: start ? addDaysISO(start, 6) : '',
        datesLabel: '',
        mesocycle: '',
        microcycle: '',
        load: null,
        phaseCode: '',
        objective: '',
        observations: null,
        planned: computed(w),
        source: { fileKind: 'plan', fileName: book.fileName, sheet: 'Sessões (detalhe)', status: 'calculado' },
      });
    }
    return;
  }
  const header = sr.find((t) => normalizeName(t) === 'semana', { col: 0 });
  if (!header) return;
  const hm = headerMap(sr, header.r);
  const C = {
    dates: col(hm, 'datas') ?? 1,
    meso: col(hm, 'fase / mesociclo', 'fase/mesociclo') ?? 2,
    micro: col(hm, 'microciclo') ?? 3,
    load: col(hm, 'carga') ?? 4,
    phase: [...hm].find(([k]) => k === 'fase')?.[1] ?? 5,
    objective: col(hm, 'objetivo') ?? 6,
    km: col(hm, 'corrida') ?? 7,
    m: col(hm, 'natacao') ?? 8,
    throws: col(hm, 'lanc') ?? 9,
    sessions: col(hm, 'nº', 'n°', 'no sess', 'n sess', 'numero') ?? 10,
  };
  for (let r = header.r + 1; r <= sr.maxRow; r++) {
    const wm = sr.text(r, 0).match(/^S(\d+)$/);
    if (!wm) continue;
    const w = Number(wm[1]);
    const label = sr.text(r, C.dates);
    const parsed = parseDatesLabel(label);
    const derivedStart = firstDate ? addDaysISO(firstDate, (w - 1) * 7) : null;
    const start = derivedStart ?? parsed.start ?? '';
    if (parsed.start && derivedStart && parsed.start !== derivedStart) {
      out.issues.warn('divergencia', `S${w}: datas "${label}" × sessões (início ${derivedStart}).`, sr.ref(r, C.dates, 'inconsistente', { original: label }));
    }
    const comp = computed(w);
    const cached = {
      runKm: parseDecimal(sr.raw(r, C.km)),
      swimM: parseDecimal(sr.raw(r, C.m)),
      throws: parseDecimal(sr.raw(r, C.throws)),
      sessions: parseDecimal(sr.raw(r, C.sessions)),
    };
    const planned = { ...cached };
    (Object.keys(comp) as (keyof typeof comp)[]).forEach((k) => {
      if (cached[k] === null) {
        planned[k] = comp[k];
        if (sr.formula(r, C[k === 'runKm' ? 'km' : k === 'swimM' ? 'm' : k])) {
          out.issues.info('formula_sem_cache', `S${w}: ${k} sem resultado em cache — recalculado a partir das sessões (${comp[k]}).`, sr.ref(r, C.km, 'calculado'));
        }
      } else if (Math.abs((cached[k] ?? 0) - comp[k]) > 0.01) {
        out.issues.warn('divergencia', `S${w}: ${k} na Visão Geral (${cached[k]}) difere da soma das sessões (${comp[k]}).`, sr.ref(r, C.km, 'inconsistente'));
      }
    });
    out.weeks.push({
      number: w,
      startDate: start,
      endDate: start ? addDaysISO(start, 6) : (parsed.end ?? ''),
      datesLabel: label,
      mesocycle: sr.text(r, C.meso),
      microcycle: sr.text(r, C.micro),
      load: parseDecimal(sr.raw(r, C.load)),
      phaseCode: sr.text(r, C.phase),
      objective: sr.text(r, C.objective),
      observations: out.coachNotes.find((n) => n.week === w)?.text ?? null,
      planned,
      source: sr.ref(r, [0, C.sessions]),
    });
  }
  for (const n of out.coachNotes) {
    const wk = out.weeks.find((w) => w.number === n.week);
    if (wk) n.date = wk.startDate;
  }
}

function parsePeriodization(book: LoadedWorkbook, out: PlanImport) {
  const sr = reader(book, 'Periodização');
  if (!sr) return;
  let order = 0;
  for (let r = 0; r <= sr.maxRow; r++) {
    const a = sr.text(r, 0);
    const fm = a.match(/^FASE\s+(\d+)\s*[–-]\s*(.+)$/i);
    if (fm) {
      const period = sr.text(r, 1);
      const wk = period.match(/S(\d+)\s*[–-]\s*S(\d+)/);
      out.phases.push({
        id: `F${fm[1]}`,
        order: order++,
        code: `F${fm[1]}`,
        name: fm[2].trim(),
        period,
        weeks: wk ? range(Number(wk[1]), Number(wk[2])) : [],
        objectives: sr.text(r, 2),
        characteristics: sr.text(r, 3),
        weeklyVolume: sr.text(r, 4),
        intensity: sr.text(r, 5),
        keySessions: sr.text(r, 6),
        source: sr.ref(r, [0, 6]),
      });
      continue;
    }
    const mm = a.match(/^(M\d+)\s*[–-]\s*(.+)$/);
    if (mm) {
      const weeksText = sr.text(r, 1);
      const wk = weeksText.match(/S(\d+)\s*[–-]\s*S(\d+)/);
      out.mesocycles.push({
        id: mm[1],
        code: mm[1],
        name: mm[2].trim(),
        weeks: wk ? range(Number(wk[1]), Number(wk[2])) : [],
        microcycles: sr
          .text(r, 2)
          .split('→')
          .map((s, i) => ({ order: i + 1, name: s.trim() }))
          .filter((m) => m.name),
        source: sr.ref(r, [0, 2], 'ok', { note: 'Microciclos em célula mesclada C:G' }),
      });
    }
  }
  const vg = out.weeks.reduce((a, w) => a + (w.planned.runKm ?? 0), 0);
  if (vg) out.counts.totalKm = vg;
}

// ───────────────────────── Calendário nutricional ─────────────────────────

function parseCalendar(book: LoadedWorkbook, out: PlanImport, weekly: WeeklyData) {
  const sr = reader(book, 'Dieta_Calendario');
  const firstDate = out.weeks[0]?.startDate || (out.sessions.length ? out.sessions.map((s) => s.date).sort()[0] : null);
  if (!sr || !firstDate) return;
  const header = sr.find((t) => normalizeName(t) === 'semana', { col: 0 });
  if (!header) return;
  const hm = headerMap(sr, header.r);
  const dayCols = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map((d) => hm.get(d) ?? null);
  for (let r = header.r + 1; r <= sr.maxRow; r++) {
    const wm = sr.text(r, 0).match(/^S(\d+)$/);
    if (!wm) continue;
    const w = Number(wm[1]);
    const weekStart = out.weeks.find((x) => x.number === w)?.startDate || addDaysISO(firstDate, (w - 1) * 7);
    dayCols.forEach((c, i) => {
      const date = addDaysISO(weekStart, i);
      const name = c === null ? '' : sr.text(r, c);
      const weeklyName = weekly.diet.get(w)?.[i] ?? null;
      let crossCheck: DayPlan['crossCheck'] = 'sem_conferencia';
      if (weeklyName !== null) crossCheck = normalizeName(weeklyName) === normalizeName(name) ? 'ok' : 'divergente';
      const id = name ? profileIdFromName(name) : null;
      if (name && !id) out.issues.warn('inconsistencia', `S${w} ${WEEKDAYS[i]}: perfil "${name}" não reconhecido.`, sr.ref(r, c ?? 0, 'inconsistente', { original: name }));
      if (crossCheck === 'divergente') {
        out.issues.warn('divergencia', `S${w} ${WEEKDAYS[i]}: Dieta_Calendario "${name}" × Planilha Semanal "${weeklyName}".`, sr.ref(r, c ?? 0, 'inconsistente'));
      }
      out.dayPlans.push({
        date,
        week: w,
        weekday: WEEKDAYS[i],
        profileId: id,
        profileName: name || null,
        profileSource: sr.ref(r, c ?? 0, name ? (crossCheck === 'divergente' ? 'inconsistente' : 'ok') : 'nao_informado', {
          original: name,
          normalized: id,
          note: weeklyName !== null ? `Planilha Semanal: ${weeklyName}` : undefined,
        }),
        crossCheck,
      });
    });
  }
  const pre = out.dayPlans.filter((d) => d.profileId === 'pre_prova');
  if (pre.length > 1) {
    out.issues.info(
      'premissa',
      `Perfil "${pre[0].profileName}" aplicado em ${pre.length} dias (${pre.map((d) => d.date.split('-').reverse().join('/')).join(', ')}): a planilha usa o mesmo perfil para D-2 e D-1.`,
      pre[0].profileSource,
    );
  }
}

// ───────────────────────── Alimentos, perfis e refeições ─────────────────────────

function parseFoods(book: LoadedWorkbook, out: PlanImport) {
  const sr = reader(book, 'Base_Alimentos');
  if (!sr) return;
  const header = sr.find((t) => normalizeName(t) === 'alimento', { col: 0 });
  if (!header) return;
  for (let r = header.r + 1; r <= sr.maxRow; r++) {
    const name = sr.text(r, 0);
    if (!name) continue;
    const measure = sourced(sr.raw(r, 1), SheetReader.addr(r, 1));
    const unitOriginal = sr.text(r, 2);
    const protein = sourced(sr.raw(r, 3), SheetReader.addr(r, 3));
    const carbs = sourced(sr.raw(r, 4), SheetReader.addr(r, 4));
    const fat = sourced(sr.raw(r, 5), SheetReader.addr(r, 5));
    const kcalReported = sourced(sr.raw(r, 6), SheetReader.addr(r, 6));
    const calc = kcal449(protein.value, carbs.value, fat.value);
    const check = compareKcal(kcalReported.value, calc);
    const sourceNote = sr.text(r, 7) || null;
    const fIssues: string[] = [];
    let status: Food['status'] = 'ok';
    if (sourceNote && /conferir|parece/i.test(sourceNote)) {
      status = 'requer_validacao';
      fIssues.push(`Observação da planilha: ${sourceNote}`);
    }
    if (sourceNote && /usda|n[aã]o estava/i.test(sourceNote)) {
      status = 'requer_validacao';
      fIssues.push('Fonte externa — não consta na dieta-base.');
    }
    if (sourceNote && /estimativa/i.test(sourceNote)) {
      status = 'estimativa';
      fIssues.push('Valores estimados pela planilha.');
    }
    if (check.status === 'inconsistente') {
      status = 'inconsistente';
      fIssues.push(`Kcal informada ${check.reported} × calculada ${check.calculated}.`);
      out.issues.warn('nutricional_suspeito', `${name}: kcal ${check.reported} difere de 4/4/9 (${check.calculated}).`, sr.ref(r, 6, 'inconsistente'));
    }
    if (kcalReported.value === null && sr.formula(r, 6)) fIssues.push('Kcal sem resultado em cache — usando valor calculado 4/4/9.');
    out.foods.push({
      id: `plan:${slug(name)}`,
      origin: 'plan',
      originalName: name,
      normalizedName: normalizeName(name),
      category: 'plano',
      baseMeasure: measure,
      unit: unitOriginal.toLowerCase() || '',
      unitOriginal,
      proteinAnimal: null,
      proteinVegetal: null,
      protein,
      carbs,
      fat,
      kcalReported,
      kcalCalculated: calc,
      kcalDifference: check.difference,
      note: null,
      sourceNote,
      status,
      issues: fIssues,
      duplicateGroup: null,
      source: sr.ref(r, [0, 7], status, { original: name }),
    });
  }
}

function parseProfiles(book: LoadedWorkbook, out: PlanImport) {
  const sr = reader(book, 'Dieta_Resumo');
  if (!sr) return;
  const weightCell = sr.find((t) => /^peso/i.test(t), { col: 0 });
  if (weightCell) out.weightKg = sourced(sr.raw(weightCell.r, 1), SheetReader.addr(weightCell.r, 1));
  const header = sr.find((t) => normalizeName(t) === 'perfil', { col: 0 });
  if (!header) return;
  for (let r = header.r + 1; r <= sr.maxRow; r++) {
    const name = sr.text(r, 0);
    if (!name) break;
    const id = profileIdFromName(name);
    if (!id) continue;
    const kcalFormula = sr.formula(r, 1) ?? '';
    const isEstimate = /estimativa/i.test(name) || !/SUMIFS/i.test(kcalFormula);
    const num = (c: number) => parseDecimal(sr.raw(r, c));
    let kcal = num(1);
    if (kcal === null) kcal = kcal449(num(2), num(3), num(4));
    out.dietProfiles.push({
      id,
      name: name.replace(/\s*\(estimativa\)\s*/i, ''),
      planned: { kcal, protein: num(2), carbs: num(3), fat: num(4) },
      perKg: { protein: num(5), carbs: num(6), fat: num(7) },
      whenToUse: sr.text(r, 8),
      isEstimate,
      hasMeals: false,
      source: sr.ref(r, [0, 8], isEstimate ? 'estimativa' : 'ok', { original: name }),
    });
  }
  // comparação com a dieta-base (texto de referência)
  const cmp = sr.find((t) => /compara[cç][aã]o/i.test(t), { col: 0 });
  if (cmp) {
    for (let r = cmp.r + 2; r <= sr.maxRow; r++) {
      const a = sr.text(r, 0);
      if (!a) continue;
      out.guidelines.push({
        id: `resumo-${r}`,
        sheet: sr.name,
        section: 'Comparação com a dieta-base',
        title: a,
        value: [1, 2, 3, 4]
          .map((c) => sr.text(r, c))
          .filter(Boolean)
          .join(' · '),
        detail: sr.text(r, 8),
        source: sr.ref(r, [0, 8]),
      });
    }
  }
}

function mealRelation(name: string): Meal['trainingRelation'] {
  const n = normalizeName(name);
  if (n.includes('intra')) return 'intra_treino';
  if (n.includes('pos')) return 'pos_treino';
  if (n.includes('pre treino') || n.includes('pre jantar')) return 'pre_treino';
  if (n.includes('ceia')) return 'ceia';
  if (n) return 'refeicao';
  return 'nao_informado';
}

function parseMealPlans(book: LoadedWorkbook, out: PlanImport) {
  const sr = reader(book, 'Dieta_Planos');
  if (!sr) return;
  const header = sr.find((t) => normalizeName(t).startsWith('perfil'), { col: 0 });
  if (!header) return;
  const hm = headerMap(sr, header.r);
  const C = {
    profile: 0,
    meal: col(hm, 'refeicao') ?? 1,
    time: col(hm, 'horario') ?? 2,
    food: col(hm, 'alimento') ?? 3,
    qty: col(hm, 'qtd') ?? 4,
    unit: col(hm, 'unid') ?? 5,
    p: col(hm, 'prot') ?? 6,
    c: col(hm, 'carb') ?? 7,
    g: col(hm, 'gord') ?? 8,
    kcal: col(hm, 'kcal') ?? 9,
  };
  const mealsByKey = new Map<string, Meal>();
  const foodsByName = new Map(out.foods.map((f) => [f.originalName, f]));
  const seen = new Map<string, number>();
  for (let r = header.r + 1; r <= sr.maxRow; r++) {
    const profileName = sr.text(r, C.profile);
    if (!profileName) continue;
    const profileId = profileIdFromName(profileName);
    if (!profileId) {
      out.issues.warn('inconsistencia', `Dieta_Planos linha ${r + 1}: perfil "${profileName}" não reconhecido.`, sr.ref(r, 0, 'inconsistente'));
      continue;
    }
    const mealName = sr.text(r, C.meal);
    const om = mealName.match(/^(\d+)\.\s*(.+)$/);
    const order = om ? Number(om[1]) : 0;
    const key = `${profileId}|${order}|${slug(om ? om[2] : mealName)}`;
    let meal = mealsByKey.get(key);
    if (!meal) {
      meal = {
        key,
        profileId,
        order,
        name: om ? om[2] : mealName,
        time: toTimeHHMM(sr.raw(r, C.time)),
        trainingRelation: mealRelation(mealName),
        totals: { protein: 0, carbs: 0, fat: 0, kcal: 0 },
        source: sr.ref(r, [0, 2], 'ok', { original: mealName }),
      };
      mealsByKey.set(key, meal);
    }
    const foodName = sr.text(r, C.food);
    const food = foodsByName.get(foodName) ?? null;
    const iIssues: string[] = [];
    const quantity = sourced(sr.raw(r, C.qty), SheetReader.addr(r, C.qty));
    const cached = { p: parseDecimal(sr.raw(r, C.p)), c: parseDecimal(sr.raw(r, C.c)), g: parseDecimal(sr.raw(r, C.g)), kcal: parseDecimal(sr.raw(r, C.kcal)) };
    // Se as fórmulas não tiverem cache, recalcula com a mesma regra da planilha (Base_Alimentos × qtd ÷ medida-base).
    const factor = food && quantity.value !== null && food.baseMeasure.value ? quantity.value / food.baseMeasure.value : null;
    const recompute = (v: number | null, base: number | null) => (v !== null ? v : factor !== null && base !== null ? round2(base * factor) : null);
    const protein = recompute(cached.p, food?.protein.value ?? null);
    const carbs = recompute(cached.c, food?.carbs.value ?? null);
    const fat = recompute(cached.g, food?.fat.value ?? null);
    const calc = kcal449(protein, carbs, fat);
    const kcal = cached.kcal ?? calc;
    if (!food) {
      iIssues.push('Alimento não encontrado em Base_Alimentos.');
      out.issues.warn('inconsistencia', `Dieta_Planos linha ${r + 1}: "${foodName}" não existe em Base_Alimentos.`, sr.ref(r, C.food, 'inconsistente'));
    }
    if (cached.p === null && sr.formula(r, C.p)) iIssues.push('Macros sem cache — recalculados.');
    const check = compareKcal(cached.kcal, calc);
    if (check.status === 'inconsistente') iIssues.push(`Kcal ${check.reported} × 4/4/9 ${check.calculated}.`);
    const dupKey = `${key}|${normalizeName(foodName)}`;
    const dupN = (seen.get(dupKey) ?? 0) + 1;
    seen.set(dupKey, dupN);
    if (dupN === 2) {
      iIssues.push('Alimento repetido na mesma refeição (possível duplicata — não unida).');
      out.issues.warn('duplicata', `${profileName} / ${mealName}: "${foodName}" aparece mais de uma vez (linha ${r + 1}). Mantido como está.`, sr.ref(r, C.food, 'requer_validacao'));
    }
    const unit = sr.text(r, C.unit) || food?.unitOriginal || '';
    meal.totals = {
      protein: round2((meal.totals.protein ?? 0) + (protein ?? 0)),
      carbs: round2((meal.totals.carbs ?? 0) + (carbs ?? 0)),
      fat: round2((meal.totals.fat ?? 0) + (fat ?? 0)),
      kcal: round2((meal.totals.kcal ?? 0) + (kcal ?? 0)),
    };
    out.mealItems.push({
      id: `${key}|${r}`,
      mealKey: key,
      order: r,
      foodName,
      foodId: food?.id ?? null,
      quantity,
      unit,
      macros: { protein, carbs, fat, kcal },
      kcalCalculated: calc,
      source: sr.ref(r, [0, C.kcal], iIssues.length ? 'requer_validacao' : 'ok'),
      issues: iIssues,
    });
  }
  out.meals = [...mealsByKey.values()];
  // conferência Resumo × soma dos itens
  for (const p of out.dietProfiles) {
    const ms = out.meals.filter((m) => m.profileId === p.id);
    p.hasMeals = ms.length > 0;
    if (!ms.length) {
      out.issues.warn('ausente', `Perfil "${p.name}": nenhuma refeição em Dieta_Planos. Exibir apenas totais estimados e orientações de timing.`, p.source);
      continue;
    }
    const sum = ms.reduce((a, m) => a + (m.totals.kcal ?? 0), 0);
    if (p.planned.kcal !== null && Math.abs(sum - p.planned.kcal) > 1) {
      out.issues.warn('divergencia', `Perfil "${p.name}": Resumo ${p.planned.kcal} kcal × soma das refeições ${round2(sum)} kcal.`, p.source);
    }
  }
}

// ───────────────────────── Zonas, orientações e progressões ─────────────────────────

function parseZones(book: LoadedWorkbook, out: PlanImport) {
  const sr = reader(book, 'Zonas e Paces');
  if (!sr) return;
  const runHeader = sr.find((t) => /^zona \/ refer/i.test(t), { col: 0 });
  if (runHeader) {
    for (let r = runHeader.r + 1; r <= sr.maxRow; r++) {
      const name = sr.text(r, 0);
      if (!name) break;
      out.paceZones.push({ id: `run-${r}`, name, pace: sr.text(r, 1), hrPercent: sr.text(r, 2), use: sr.text(r, 3), source: sr.ref(r, [0, 3]) });
    }
  }
  const swimHeader = sr.find((t) => normalizeName(t) === 'zona', { col: 0 });
  if (swimHeader) {
    for (let r = swimHeader.r + 1; r <= sr.maxRow; r++) {
      const zone = sr.text(r, 0);
      if (!zone) break;
      out.swimZones.push({ id: `swim-${r}`, zone, code: sr.text(r, 1), description: sr.text(r, 2), example: sr.text(r, 3), source: sr.ref(r, [0, 3]) });
    }
  }
  const all = out.paceZones.map((z) => z.hrPercent).join(' ');
  if (!/bpm/i.test(all)) out.issues.info('ausente', 'FC máxima não informada: zonas de corrida guiadas por pace; %FCmáx sem valor absoluto.', sr.ref(0, 0, 'nao_informado'));
}

function parseKeyValue(sr: SheetReader, out: PlanImport, keyCol: number, valCol: number, detailCol: number | null, startRow = 1) {
  let section = 'Geral';
  for (let r = startRow; r <= sr.maxRow; r++) {
    const k = sr.text(r, keyCol);
    const v = sr.text(r, valCol);
    const d = detailCol !== null ? sr.text(r, detailCol) : '';
    if (!k && !v) continue;
    if (k && !v && !d) {
      if (k.length > 60) {
        out.guidelines.push({ id: `${slug(sr.name)}-${r}`, sheet: sr.name, section: 'Nota', title: '', value: k, detail: '', source: sr.ref(r, keyCol) });
      } else section = k;
      continue;
    }
    if (!k && v && detailCol === null) {
      out.guidelines.push({ id: `${slug(sr.name)}-${r}`, sheet: sr.name, section, title: '', value: v, detail: '', source: sr.ref(r, valCol) });
      continue;
    }
    out.guidelines.push({
      id: `${slug(sr.name)}-${r}`,
      sheet: sr.name,
      section,
      title: k,
      value: v,
      detail: d,
      source: sr.ref(r, detailCol !== null ? [keyCol, detailCol] : [keyCol, valCol]),
    });
  }
}

function parseGuidelines(book: LoadedWorkbook, out: PlanImport) {
  const timing = reader(book, 'Dieta_Timing');
  if (timing) {
    parseKeyValue(timing, out, 0, 1, 2, 1);
    const base = timing.find((t) => /^base di[aá]ria/i.test(t), { col: 0 });
    if (base) {
      const text = timing.text(base.r, 1);
      const lm = text.match(/([\d,.]+)\s*[–-]\s*([\d,.]+)\s*L\b/);
      out.hydrationReference = {
        text: `${text}${timing.text(base.r, 2) ? ' — ' + timing.text(base.r, 2) : ''}`,
        minMl: lm ? Math.round((parseDecimal(lm[1]) ?? 0) * 1000) || null : null,
        maxMl: lm ? Math.round((parseDecimal(lm[2]) ?? 0) * 1000) || null : null,
        source: timing.ref(base.r, 1, 'configuravel', { original: text, note: 'Faixa da planilha — não é meta única' }),
      };
    } else {
      out.issues.info('ausente', 'Meta de hidratação não informada na planilha.');
    }
    for (const name of ['Creatina', 'Beta-alanina', 'Beta alanina']) {
      const cell = timing.find((t) => normalizeName(t).startsWith(normalizeName(name)), { col: 0 });
      if (cell) {
        out.supplementReferences.push({
          name,
          text: `${timing.text(cell.r, 0)}: ${timing.text(cell.r, 1)} — ${timing.text(cell.r, 2)}`,
          source: timing.ref(cell.r, [0, 2], 'requer_validacao'),
        });
      }
    }
    if (!out.supplementReferences.some((s) => /beta/i.test(s.name))) {
      out.issues.info('ausente', 'Beta-alanina não é mencionada no planejamento: dose e horário devem ser preenchidos manualmente.');
    }
  }
  const analise = reader(book, 'Dieta_Analise');
  if (analise) {
    const th = analise.find((t) => /^refei[cç][aã]o \(sua dieta\)/i.test(t), { col: 0 });
    let next = 1;
    if (th) {
      let r = th.r + 1;
      for (; r <= analise.maxRow && analise.text(r, 0); r++) {
        const n = (c: number) => analise.text(r, c);
        out.guidelines.push({
          id: `dieta-analise-${r}`,
          sheet: analise.name,
          section: 'Dieta-base analisada pelo plano',
          title: n(0),
          value: `${n(1)} — ${n(2)} kcal · P ${n(3)} · C ${n(4)} · G ${n(5)}`,
          detail: n(6),
          source: analise.ref(r, [0, 6]),
        });
      }
      next = r;
    }
    if (th) out.guidelines.push({ id: 'dieta-analise-nota', sheet: analise.name, section: 'Nota', title: '', value: analise.text(1, 0), detail: '', source: analise.ref(1, 0) });
    parseKeyValue(analise, out, 0, 1, null, next);
  }
  const biblioteca = reader(book, 'Biblioteca');
  if (biblioteca) parseKeyValue(biblioteca, out, 0, 1, null, 1);
  const leia = reader(book, 'LEIA-ME');
  if (leia) parseKeyValue(leia, out, 1, 2, null, 2);
  const analysis = reader(book, 'Análise');
  if (analysis) parseKeyValue(analysis, out, 0, 1, null, 1);
}

const PROGRESSION_SHEETS = ['Corrida', 'Natação', 'Força', 'Granada', 'Tiro', 'Pistas (substitutos)'];

function parseProgressions(book: LoadedWorkbook, out: PlanImport) {
  for (const name of PROGRESSION_SHEETS) {
    const sr = reader(book, name);
    if (!sr) continue;
    const title = sr.text(0, 0);
    const notes: string[] = [];
    let current: ProgressionTable | null = null;
    let colIdx: number[] = [];
    let n = 0;
    const close = () => {
      if (current && current.rows.length) out.progressionTables.push(current);
      current = null;
    };
    for (let r = 1; r <= sr.maxRow; r++) {
      const cells = range(0, sr.maxCol)
        .map((c) => ({ c, t: sr.text(r, c) }))
        .filter((x) => x.t);
      if (!cells.length) {
        close();
        continue;
      }
      if (cells.length === 1 && !current) {
        notes.push(cells[0].t);
        continue;
      }
      if (cells.length === 1 && current) {
        close();
        notes.push(cells[0].t);
        continue;
      }
      if (!current) {
        const headerish = cells.every((x) => x.t.length <= 70 && !x.t.includes('\n'));
        if (!headerish) {
          notes.push(cells.map((x) => x.t).join(' — '));
          continue;
        }
        colIdx = cells.map((x) => x.c);
        current = {
          id: `${slug(name)}-${++n}`,
          sheet: sr.name,
          title: n === 1 ? title : `${title} (${n})`,
          columns: cells.map((x) => x.t),
          rows: [],
          notes: [],
          source: sr.ref(r, [colIdx[0], colIdx[colIdx.length - 1]]),
        };
        continue;
      }
      const row: ProgressionTable['rows'][number] = { week: null, cells: colIdx.map((c) => sr.text(r, c)) };
      const wm = row.cells[0].match(/^S(\d+)$/);
      if (wm) row.week = Number(wm[1]);
      (current as ProgressionTable).rows.push(row);
    }
    close();
    const tables = out.progressionTables.filter((t) => t.sheet === sr.name);
    if (tables[0]) tables[0].notes = notes;
    const weeksIn = new Set(tables.flatMap((t) => t.rows.map((r) => r.week).filter((w): w is number => w !== null)));
    const total = out.weeks.length || 18;
    if (weeksIn.size) {
      const missing = range(1, total).filter((w) => !weeksIn.has(w));
      if (missing.length) {
        out.issues.info(
          'ausente',
          `Aba "${sr.name}": tabela de progressão sem ${missing.map((w) => 'S' + w).join(', ')} (as sessões dessas semanas existem em Sessões (detalhe)).`,
          sr.ref(0, 0, 'nao_informado'),
        );
      }
    }
  }
}

function parseCompetition(book: LoadedWorkbook, out: PlanImport) {
  const comp = out.sessions.find((s) => s.modality === 'competicao' && /^competi[cç][aã]o\s*[–-]/i.test(s.type)) ?? out.sessions.find((s) => s.modality === 'competicao');
  const leia = reader(book, 'LEIA-ME');
  let premise: { text: string; ref: SourceReference } | null = null;
  let track: { date: string | null; ref: SourceReference } | null = null;
  if (leia) {
    const c = leia.find((t) => /data da competi/i.test(t));
    if (c) premise = { text: leia.text(c.r, c.c + 1), ref: leia.ref(c.r, c.c + 1, 'configuravel', { original: leia.text(c.r, c.c + 1) }) };
    const t = leia.find((x) => /acesso [aà]s pistas/i.test(x));
    if (t) {
      const txt = leia.text(t.r, t.c + 1);
      const dm = txt.match(/(\d{2}\/\d{2}\/\d{4})/);
      track = { date: dm ? toISODate(dm[1]) : null, ref: leia.ref(t.r, t.c + 1, 'requer_validacao', { original: txt }) };
    }
  }
  const premiseDate = premise ? toISODate(premise.text.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? '') : null;
  const date = comp?.date ?? premiseDate;
  if (!date) {
    out.issues.warn('ausente', 'Data da competição não encontrada no plano — usar Configurações para definir.');
    return;
  }
  if (comp && premiseDate && comp.date !== premiseDate) {
    out.issues.warn('divergencia', `Data da competição: sessão ${comp.date} × LEIA-ME ${premiseDate}.`, premise?.ref);
  }
  out.issues.warn(
    'premissa',
    `Data da competição ${date.split('-').reverse().join('/')} é uma PREMISSA do planejamento ("${premise?.text.slice(0, 80) ?? 'sessão de competição'}…"). Campo configurável.`,
    premise?.ref ?? comp?.source,
  );
  const second = out.sessions.find((s) => s.modality === 'competicao' && s !== comp);
  if (second) out.issues.info('premissa', `${second.date.split('-').reverse().join('/')}: "${second.type}" é condicional ("se houver 2º dia de provas").`, second.source);
  out.competition = {
    date,
    source: comp ? { ...comp.source, status: 'configuravel', note: premise?.text } : premise!.ref,
    trackAccessFrom: track?.date ?? null,
    trackAccessSource: track?.ref,
  };
}

/** Para testes e diagnóstico. */
export const __internal = { parseDatesLabel, mealRelation, similarityKey };
