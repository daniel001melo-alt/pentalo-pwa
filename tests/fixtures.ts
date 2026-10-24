import * as XLSX from 'xlsx';

/**
 * Planilhas SINTÉTICAS com a mesma estrutura dos arquivos reais (abas, cabeçalhos, blocos,
 * mesclagens, fórmulas, números como texto). Os arquivos pessoais do atleta não entram no repositório.
 */

type Cell = string | number | null | { v?: string | number; f?: string; t?: 's' | 'n'; z?: string };

function sheet(rows: Cell[][], merges: string[] = []): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxC = 0;
  rows.forEach((row, r) => {
    row.forEach((v, c) => {
      if (v === null || v === undefined || v === '') return;
      const addr = XLSX.utils.encode_cell({ r, c });
      if (typeof v === 'object') {
        const cell: XLSX.CellObject = { t: v.t ?? (typeof v.v === 'number' ? 'n' : 's'), v: v.v } as XLSX.CellObject;
        if (v.f) cell.f = v.f;
        if (v.z) cell.z = v.z;
        if (v.v === undefined) delete (cell as { v?: unknown }).v;
        ws[addr] = cell;
      } else ws[addr] = { t: typeof v === 'number' ? 'n' : 's', v } as XLSX.CellObject;
      maxC = Math.max(maxC, c);
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxC } });
  ws['!merges'] = merges.map((m) => XLSX.utils.decode_range(m));
  return ws;
}

const serial = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000) + 25569;
const D = (iso: string) => ({ v: serial(iso), t: 'n' as const, z: 'dd/mm/yyyy' });

export interface PlanFixtureOptions {
  /** altera o tipo de uma sessão (para simular reimportação de plano modificado) */
  renameSessionOn?: string;
  /** remove o cache das fórmulas de macros em Dieta_Planos */
  dropMealCache?: boolean;
  /** altera o total da Visão Geral para gerar divergência */
  wrongOverviewKm?: boolean;
  /** perfil da Planilha Semanal diferente do calendário */
  divergentProfile?: boolean;
}

const SESSIONS: [number, string, string, string, string, string, string, number | null, number | null, number | null, string][] = [
  [1, '2026-10-26', 'SEG', 'Único', 'Natação regenerativa', "≈35'", 'A1 (muito leve)', null, 1000, null, '- 300 m solto A1\n- 6 x 50 m A1 i: 15"\nTotal ≈ 1000 m'],
  [1, '2026-10-27', 'TER', 'AM', 'Corrida regenerativa', "30'", 'Z1 >5:10/km a Z2 leve', 6.5, null, null, '6,5 km contínuos leves + 4 acelerações de 20 m ao final (i: 40").'],
  [1, '2026-10-27', 'TER', 'PM', 'Força MI + core', "≈65'", "~60% 1RM / 1'", null, null, null, "Aquec 10' mobilidade.\n- Agachamento com barra 3x15 (~60% 1RM) i: 1'\n- Stiff 3x15 i: 1'"],
  [1, '2026-10-27', 'TER', 'Casa', 'Tiro a seco – T1 técnica/posição', "≈25'", 'Técnica (baixa carga fisiológica)', null, null, null, 'Checagem de segurança.\n- 10 tiros lentos'],
  [1, '2026-10-30', 'SEX', 'PM', '◦ Granada G2 – potência rotacional + core', "≈45'", 'Alta (velocidade)', null, null, 12, 'Med ball 3 kg: arremesso rotacional 3x5/lado'],
  [1, '2026-10-31', 'SÁB', 'AM', 'Rodagem longa', "≈58'", 'Z2 4:45–4:15/km (FC 60–70%)', 13, null, null, '13 km contínuos em Z2.'],
  [1, '2026-11-01', 'DOM', 'Único', 'Flexibilidade / mobilidade', "30'", 'Z1 / muito leve', null, null, null, 'Alongamento ativo + mobilidade.'],
  [2, '2026-11-02', 'SEG', 'AM', 'Limiar (Z4)', "≈60'", 'Z4 / limiar', 10, null, null, '5 x 1000 m Z4 (≈3:43) i: 90" trote.'],
  [2, '2026-11-04', 'QUA', 'PM', 'PPM – ativação', "≈45'", 'Ritmo de prova', null, null, null, "2 x ¼ de pista + 4 x 20 m. ≤25'."],
  [2, '2026-11-06', 'SEX', 'Único', 'D-1 – Shake-out', "≈25'", 'Z1 + pontual', 4, null, null, "20' Z1 + 6 x 100 m progressivos."],
  [2, '2026-11-07', 'SÁB', 'Único', 'COMPETIÇÃO – dia de prova', 'conforme programação', 'Prova', null, null, null, 'Provas do Pentatlo Militar.'],
  [2, '2026-11-08', 'DOM', 'Único', 'Competição (2º dia) / recuperação', '—', 'Z1', null, null, null, 'Se houver 2º dia de provas, repetir rotina.'],
];

const CAL: string[][] = [
  ['Leve', 'Moderado', 'Leve', 'Leve', 'Moderado', 'Intenso', 'Recuperação'],
  ['Intenso', 'Leve', 'Moderado', 'Leve', 'Pré-prova (D-1)', 'Dia de prova', 'Recuperação'],
];

export function planWorkbook(opts: PlanFixtureOptions = {}): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      ['Planejamento Pentatlo Militar – Teste'],
      ['Linha de apresentação'],
      [],
      [null, 'COMO USAR'],
      [null, 'Planilha Semanal', 'Visão SEMANA | OBJETIVO | SEG–DOM. » = sessão principal; ◦ = sessão secundária/opcional.'],
      [null, 'PREMISSAS ADOTADAS'],
      [null, 'Data da competição', 'Assumi sábado 07/11/2026 (semana 2). A semana 1 começa em 26/10/2026.'],
      [null, 'Acesso às pistas', 'PPM e PNU liberadas a partir de 02/11/2026 (semana 2).'],
    ]),
    'LEIA-ME',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [
        ['2. Periodização'],
        [],
        [],
        ['Fase', 'Período', 'Objetivos', 'Características', 'Volume semanal', 'Intensidade', 'Sessões-chave'],
        ['FASE 1 – Base', '26/10 – 01/11 (S1–S1)', 'Base', 'Descarga', '20 km', 'Baixa', 'Z2'],
        ['FASE 2 – Polimento', '02/11 – 08/11 (S2–S2)', 'Prova', 'Polimento', '14 km', 'Curta', 'Ativações'],
        [],
        ['Mesociclos × microciclos'],
        ['Mesociclo', 'Semanas', 'Microciclos'],
        ['M1 – Base', 'S1–S1', 'Base 1'],
        ['M2 – Polimento', 'S2–S2', 'Polimento → competição'],
      ],
      ['C10:G10', 'C11:G11'],
    ),
    'Periodização',
  );
  const sum = (w: number, idx: number) => SESSIONS.filter((s) => s[0] === w).reduce((a, s) => a + ((s[idx] as number | null) ?? 0), 0);
  const nSes = (w: number) => SESSIONS.filter((s) => s[0] === w && s[4] !== 'Flexibilidade / mobilidade').length;
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      ['3. Visão geral'],
      [],
      [],
      ['Semana', 'Datas', 'Fase / Mesociclo', 'Microciclo', 'Carga (1–5)', 'Fase', 'Objetivo da semana', 'Corrida (km)', 'Natação (m)', 'Lançam. granada', 'Nº sessões'],
      [
        'S1',
        '26/10 – 01/11/26',
        'M1 – Base',
        'Recuperação ativa',
        1,
        'F1',
        'Descarregar.',
        { v: opts.wrongOverviewKm ? 99 : sum(1, 7), f: "SUMIFS('Sessões (detalhe)'!$H$5:$H$20,'Sessões (detalhe)'!$A$5:$A$20,1)" },
        { v: sum(1, 8), f: 'SUMIFS(x)' },
        { v: sum(1, 9), f: 'SUMIFS(x)' },
        { v: nSes(1), f: 'COUNTIFS(x)' },
      ],
      [
        'S2',
        '02/11 – 08/11/26',
        'M2 – Polimento',
        'Polimento + COMPETIÇÃO',
        2,
        'F2',
        'Ativações e prova.',
        { v: sum(2, 7), f: 'SUMIFS(x)' },
        { v: sum(2, 8), f: 'SUMIFS(x)' },
        { v: sum(2, 9), f: 'SUMIFS(x)' },
        { v: nSes(2), f: 'COUNTIFS(x)' },
      ],
    ]),
    'Visão Geral',
  );
  // Planilha Semanal: células multilinha com marcadores e linha DIETA
  const days = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];
  const weekly: Cell[][] = [
    ['4. Planilha'],
    ['» principal | ◦ opcional'],
    [],
    ['Semana', 'Datas', 'Fase / microciclo', 'OBJETIVO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO'],
  ];
  const merges: string[] = [];
  for (const w of [1, 2]) {
    const row: Cell[] = [`S${w}`, 'datas', 'M', 'objetivo'];
    days.forEach((d, i) => {
      const ss = SESSIONS.filter((s) => s[0] === w && s[2] === d);
      const blocks = ss.map((s) => {
        const marker = s[4].startsWith('◦') ? '◦' : '»';
        const type = s[4].replace(/^◦\s*/, '');
        const tag = s[3] === 'Único' ? '' : `[${s[3]}] `;
        return `${tag}${marker} ${type} | ${s[5]} | ${s[6]}\n${s[10]}`;
      });
      let prof = CAL[w - 1][i];
      if (opts.divergentProfile && w === 1 && i === 0) prof = 'Intenso';
      row.push([...blocks, `DIETA: ${prof}`].join('\n\n'));
    });
    weekly.push(row);
    weekly.push([null, null, `Observações S${w}`, `Observação da semana ${w}.`]);
    merges.push(`D${weekly.length}:K${weekly.length}`);
  }
  XLSX.utils.book_append_sheet(wb, sheet(weekly, merges), 'Planilha Semanal');
  const sesRows: Cell[][] = [
    ['Sessões'],
    ['nota'],
    [],
    ['Semana', 'Data', 'Dia', 'Período', 'Tipo', 'Duração', 'Intensidade', 'Corrida (km)', 'Natação (m)', 'Lançam.', 'Detalhe (séries, reps, intervalos, pace, zona)'],
  ];
  for (const s of SESSIONS) {
    const type = opts.renameSessionOn === s[1] ? s[4] + ' – versão 2' : s[4];
    sesRows.push([s[0], D(s[1]), s[2], s[3], type, s[5], s[6], s[7], s[8], s[9], s[10]]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(sesRows), 'Sessões (detalhe)');
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      ['Zonas e paces'],
      ['Fonte'],
      [],
      ['Zona / referência', 'Pace (min/km)', 'FC (% FCmáx)', 'Uso'],
      ['Z1 – Recuperação ativa', '>5:10', '50–60%', 'Aquecimento'],
      ['Z4 – Limiar de lactato (T)', '3:43', '80–90%', 'Séries de limiar'],
      [],
      ['Natação'],
      ['Zona', 'Sigla', 'Descrição', 'Exemplo'],
      ['Zona 1', 'A1 / A2', 'Aeróbio', 'Soltos'],
    ]),
    'Zonas e Paces',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      ['Timing nutricional'],
      ['Valores calculados para 64 kg.'],
      [],
      ['Hidratação'],
      ['Base diária', '35–45 ml/kg ≈2,3–2,9 L', 'Urina cor 1–3.'],
      [],
      ['Suplementos (opcionais – só com avaliação)'],
      ['Creatina monohidratada', '3–5 g/dia', 'Apoia força.'],
    ]),
    'Dieta_Timing',
  );
  // Base_Alimentos (kcal = fórmula 4/4/9)
  const foods: [string, number, string, number, number, number, string][] = [
    ['Pão de forma', 100, 'g', 13.8, 34, 4.2, 'sua tabela – carboidrato parece baixo. Conferir rótulo.'],
    ['Ovo inteiro', 1, 'un', 6, 0.5, 5, 'sua tabela'],
    ['Whey protein', 30, 'g', 23, 5, 1.5, 'sua tabela'],
    ['Banana nanica', 100, 'g', 1.4, 23.8, 0.1, 'sua tabela'],
    ['Arroz branco cozido', 100, 'g', 2.5, 28, 0.2, 'sua tabela'],
    ['Macarrão cozido', 100, 'g', 5.8, 30.9, 0.9, 'USDA (não estava na sua tabela)'],
    ['Leite integral', 100, 'ml', 2.9, 5, 3, 'sua tabela'],
  ];
  const baRows: Cell[][] = [['Base de alimentos'], ['nota'], [], ['Alimento', 'Medida base', 'Unid.', 'Prot (g)', 'Carb (g)', 'Gord (g)', 'Kcal', 'Fonte / observação']];
  foods.forEach((f, i) => baRows.push([f[0], f[1], f[2], f[3], f[4], f[5], { v: Math.round((4 * f[3] + 4 * f[4] + 9 * f[5]) * 100) / 100, f: `4*D${i + 5}+4*E${i + 5}+9*F${i + 5}` }, f[6]]));
  XLSX.utils.book_append_sheet(wb, sheet(baRows), 'Base_Alimentos');
  // Dieta_Planos: 2 refeições por perfil (exceto Dia de prova, sem refeições)
  const plans: [string, string, string, string, number][] = [];
  for (const p of ['Intenso', 'Moderado', 'Leve', 'Recuperação', 'Pré-prova (D-1)']) {
    plans.push([p, '1. Café da manhã', '06:30', 'Pão de forma', 50]);
    plans.push([p, '1. Café da manhã', '06:30', 'Ovo inteiro', 2]);
    plans.push([p, '2. Pós-treino', '18:00', 'Whey protein', 30]);
    plans.push([p, '2. Pós-treino', '18:00', 'Banana nanica', 100]);
  }
  plans.push(['Recuperação', '2. Pós-treino', '18:00', 'Banana nanica', 100]); // duplicata intencional
  const foodBy = new Map(foods.map((f) => [f[0], f]));
  const dpRows: Cell[][] = [['Plano nutricional'], ['nota'], [], ['Perfil do dia', 'Refeição', 'Horário', 'Alimento', 'Qtd (g/ml/un)', 'Unid.', 'Prot (g)', 'Carb (g)', 'Gord (g)', 'Kcal']];
  const profTot = new Map<string, number[]>();
  plans.forEach((pl, i) => {
    const f = foodBy.get(pl[3])!;
    const k = pl[4] / f[1];
    const p = Math.round(f[3] * k * 100) / 100;
    const c = Math.round(f[4] * k * 100) / 100;
    const g = Math.round(f[5] * k * 100) / 100;
    const kcal = Math.round((4 * p + 4 * c + 9 * g) * 100) / 100;
    const r = i + 5;
    const t = profTot.get(pl[0]) ?? [0, 0, 0, 0];
    profTot.set(pl[0], [t[0] + kcal, t[1] + p, t[2] + c, t[3] + g]);
    const fx = (v: number, f2: string) => (opts.dropMealCache ? { f: f2, t: 'n' as const } : { v, f: f2 });
    dpRows.push([pl[0], pl[1], pl[2], pl[3], pl[4], { v: f[2], f: `INDEX(C)` }, fx(p, `INDEX(D)*E${r}`), fx(c, `INDEX(E)*E${r}`), fx(g, `INDEX(F)*E${r}`), fx(kcal, `4*G${r}+4*H${r}+9*I${r}`)]);
  });
  XLSX.utils.book_append_sheet(wb, sheet(dpRows), 'Dieta_Planos');
  const resRows: Cell[][] = [['Resumo'], ['nota'], ['Peso (kg)', 64, '← edite'], [], ['Perfil', 'Kcal', 'Prot (g)', 'Carb (g)', 'Gord (g)', 'Prot g/kg', 'Carb g/kg', 'Gord g/kg', 'Quando usar']];
  for (const p of ['Intenso', 'Moderado', 'Leve', 'Recuperação', 'Pré-prova (D-1)']) {
    const t = profTot.get(p)!;
    resRows.push([
      p,
      { v: Math.round(t[0] * 100) / 100, f: 'SUMIFS(Dieta_Planos!$J$5:$J$131,Dieta_Planos!$A$5:$A$131,$A6)' },
      { v: t[1], f: 'SUMIFS(x)' },
      { v: t[2], f: 'SUMIFS(x)' },
      { v: t[3], f: 'SUMIFS(x)' },
      t[1] / 64,
      t[2] / 64,
      t[3] / 64,
      `uso ${p}`,
    ]);
  }
  resRows.push(['Dia de prova (estimativa)', { v: 2820, f: '4*C11+4*D11+9*E11' }, 120, 450, 60, 1.875, 7.03, 0.94, 'Estimativa']);
  resRows.push([]);
  resRows.push(['Comparação com a sua dieta base']);
  resRows.push(['Item', 'Kcal', 'Prot (g)', 'Carb (g)', 'Gord (g)']);
  resRows.push(['Dieta base atual (4 refeições)', 511.7, 44.2, 62.8, 9.3]);
  resRows.push(['Gasto diário da sua planilha (TMB x FA 1,6)', 2637.9]);
  XLSX.utils.book_append_sheet(wb, sheet(resRows), 'Dieta_Resumo');
  const calRows: Cell[][] = [['Calendário'], ['nota'], [], ['Semana', 'Datas', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM', 'kcal/dia (média)']];
  CAL.forEach((w, i) => calRows.push([`S${i + 1}`, 'datas', ...w, 0]));
  XLSX.utils.book_append_sheet(wb, sheet(calRows), 'Dieta_Calendario');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Dieta-base em XLS (BIFF8) real, com refeições em blocos, listas e número com vírgula como texto. */
export function baseDietWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      ['', '', '', '', '', '', '', '', 'Peso: utilize seu peso real somente quando estiver próximo do seu "peso ideal". Quando estiver muito acima use o peso ideal.'],
      [null, 'Gasto Calórico Diário'],
      [null, 'Peso', 64, 'Kilos'],
      [null, 'Altura', 169, 'Centimetros'],
      [null, 'Idade', 21, 'Anos'],
      [null, 'FA', 1.6, 'Coeficiente'],
      [null, 'GCD', { v: 2637.872, f: 'C6*(66.47+(13.75*C3)+(5*C4)-(6.8*C5))' }, 'Kcals'],
    ]),
    'TMB',
  );
  const R: Cell[][] = Array.from({ length: 60 }, () => []);
  const put = (addr: string, v: Cell) => {
    const { r, c } = XLSX.utils.decode_cell(addr);
    R[r][c] = v;
  };
  put('A1', 'DIETA BASE - Teste');
  put('B2', 'Refeição 1');
  put('K2', 'Refeição 2');
  for (const [pa, pv, cb, ft] of [
    ['E3', 'F3', 'G3', 'H3'],
    ['N3', 'O3', 'P3', 'Q3'],
  ])
    [pa, pv, cb, ft].forEach((a, i) => put(a, ['Ptn (A)', 'Ptn (V)', 'Carb', 'Fat'][i]));
  // Refeição 1
  put('C4', '100g');
  put('D4', 'pão de forma ');
  put('E4', 13.8);
  put('G4', 34);
  put('H4', 4.2);
  put('C5', 1);
  put('D5', 'Ovos Inteiros (cozido, omelete, mexido)');
  put('E5', 6);
  put('H5', 5);
  put('C6', '50g');
  put('D6', 'queijo muç');
  put('E6', 14);
  put('G6', '1,5');
  put('H6', '8,5');
  put('C12', 'Kcal');
  put('E12', 33.8);
  put('F12', 0);
  put('G12', 35.5);
  put('H12', 17.7);
  put('C13', 4 * 33.8 + 4 * 35.5 + 9 * 17.7);
  // Refeição 2 vazia
  put('L12', 'kcals');
  put('N12', 0);
  put('L13', 0);
  // totais do dia
  put('AD3', 'Protein (A)');
  put('AE3', 33.8);
  put('AD4', 'Protein (V)');
  put('AE4', 0);
  put('AD5', 'Carbs');
  put('AE5', 35.5);
  put('AD6', 'Fat');
  put('AE6', 17.7);
  put('AF7', 'Total');
  put('AG7', 4 * 33.8 + 4 * 35.5 + 9 * 17.7);
  put('AF8', 'Excedente');
  // listas
  put('C20', 'CARBO PARA CUTTING ');
  put('C21', '100g ');
  put('D21', 'Banana nanica');
  put('F21', 1.4);
  put('G21', 23.8);
  put('H21', 0.1);
  put('C22', '300g ');
  put('D22', 'Banana nanica');
  put('F22', 3.2);
  put('G22', 71.4);
  put('H22', 0.3);
  put('C23', 100);
  put('D23', 'Requeijão Light');
  put('E23', 22);
  put('H23', 12);
  put('C24', '200g');
  put('D24', 'leite integral');
  put('E24', 5.8);
  put('G24', 10);
  put('H24', 6);
  put('C25', '100g');
  put('D25', 'Batata doce crua');
  put('L20', 'PROTEINAS');
  put('L21', '30g');
  put('M21', 'Whey Protein');
  put('N21', 23);
  put('P21', 5);
  put('L22', 1);
  put('M22', 'Ovos Inteiros (cozido, omelete, mexido)');
  put('N22', 6);
  put('Q22', 5);
  put('L23', 2);
  put('M23', 'Ovos Inteiros (cozido, omelete, mexido)');
  put('N23', 12);
  put('P23', 1);
  put('Q23', 10);
  put('L25', 'Carne vermelhas*                    patinho, coxão mole');
  put('L26', '100g ');
  put('M26', 'Carne vermelha crua *');
  put('N26', 22);
  put('Q26', 5);
  put('C40', 'CARBO PARA BULKING');
  put('C41', '100g');
  put('D41', 'banana nanica');
  put('F41', 1.4);
  put('G41', 24);
  put('H41', 0.1);
  XLSX.utils.book_append_sheet(wb, sheet(R, ['A1:AB1', 'B2:D2', 'K2:M2', 'C20:H20', 'L20:Q20', 'U20:Z20', 'L25:Q25']), 'DIETA');
  XLSX.utils.book_append_sheet(wb, sheet([['MEDIDAS', 'DATA', 'DATA'], [], ['OMBRO'], ['PEITO']]), 'MEDIDAS');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer);
}

export const toBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
