import type { SourcedNumber, ValidationStatus } from '../domain/schemas';

/**
 * Funções puras de normalização. Nunca alteram o valor original: devolvem um valor
 * normalizado separado, e quem chama guarda os dois.
 */

/** Converte número do Excel ou texto com vírgula decimal ("1,5", " 8,5 ") com segurança. */
export function parseDecimal(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'boolean') return null;
  let s = String(input).trim();
  if (s === '' || s === '—' || s === '-') return null;
  s = s.replace(/\s+/g, '');
  // "1.234,5" (pt-BR com milhar) → 1234.5 ; "1,5" → 1.5 ; "1.5" → 1.5
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Cria um SourcedNumber preservando o original. Vazio vira "Não informado". */
export function sourced(original: unknown, cell?: string, emptyStatus: ValidationStatus = 'nao_informado'): SourcedNumber {
  const value = parseDecimal(original);
  let status: ValidationStatus = 'ok';
  if (original === null || original === undefined || String(original).trim() === '') status = emptyStatus;
  else if (value === null) status = 'inconsistente';
  else if (typeof original === 'string') status = 'requer_validacao'; // número armazenado como texto
  return { original: original ?? null, value, cell, status };
}

export type CanonicalUnit = 'g' | 'ml' | 'un';

const UNIT_ALIASES: Record<string, CanonicalUnit> = {
  g: 'g',
  gr: 'g',
  grs: 'g',
  grama: 'g',
  gramas: 'g',
  kg: 'g',
  ml: 'ml',
  l: 'ml',
  lt: 'ml',
  litro: 'ml',
  litros: 'ml',
  un: 'un',
  und: 'un',
  unid: 'un',
  unidade: 'un',
  unidades: 'un',
};
const UNIT_FACTOR: Record<string, number> = { kg: 1000, l: 1000, lt: 1000, litro: 1000, litros: 1000 };

export interface ParsedQuantity {
  original: unknown;
  value: number | null;
  unit: CanonicalUnit | null;
  unitOriginal: string;
  /** a unidade não veio escrita e foi deduzida (ex.: "1" ovo = 1 unidade) */
  unitInferred: boolean;
}

/**
 * Lê quantidades como "100g", "100 ml", "2g ", "1,5 kg", "1 L", 1 (número puro).
 * Número puro sem unidade → unidade null (quem chama decide se pode inferir).
 */
export function parseQuantity(input: unknown): ParsedQuantity {
  const base: ParsedQuantity = { original: input ?? null, value: null, unit: null, unitOriginal: '', unitInferred: false };
  if (input === null || input === undefined) return base;
  if (typeof input === 'number') return { ...base, value: input };
  const s = String(input).trim();
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Zçã]+)?\.?$/);
  if (!m) return base;
  const num = parseDecimal(m[1]);
  if (num === null) return base;
  if (!m[2]) return { ...base, value: num };
  const raw = m[2];
  const key = raw.toLowerCase();
  const unit = UNIT_ALIASES[key] ?? null;
  if (!unit) return { ...base, value: num, unitOriginal: raw };
  return { ...base, value: num * (UNIT_FACTOR[key] ?? 1), unit, unitOriginal: raw };
}

export function normalizeUnit(raw: string | null | undefined): CanonicalUnit | null {
  if (!raw) return null;
  return UNIT_ALIASES[raw.trim().toLowerCase()] ?? null;
}

/** Remove acentos, caixa, espaços extras, asteriscos e parênteses descritivos. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[*]/g, ' ')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SINGULAR_EXCEPTIONS = new Set(['arroz', 'mais', 'gras', 'pires', 'lapis', 'pais', 'atlas', 'bis', 'cuscuz']);

/** Chave para detectar POSSÍVEIS duplicatas ("ovo inteiro" ≈ "ovos inteiros"). Nunca usada para unir dados. */
export function similarityKey(name: string): string {
  return normalizeName(name)
    .split(' ')
    .filter((w) => !['de', 'do', 'da', 'em', 'c', 'com', 'e'].includes(w))
    .map((w) => {
      if (w.length <= 3 || SINGULAR_EXCEPTIONS.has(w)) return w;
      if (w.endsWith('oes')) return w.slice(0, -3) + 'ao';
      if (w.endsWith('aes')) return w.slice(0, -3) + 'ao';
      if (w.endsWith('is') && !w.endsWith('ois')) return w.slice(0, -2) + 'l';
      if (w.endsWith('s')) return w.slice(0, -1);
      return w;
    })
    .join(' ');
}

/** Calorias de conferência pela regra 4/4/9 (nunca substitui o valor informado). */
export function kcal449(protein: number | null, carbs: number | null, fat: number | null): number | null {
  if (protein === null && carbs === null && fat === null) return null;
  return round2(4 * (protein ?? 0) + 4 * (carbs ?? 0) + 9 * (fat ?? 0));
}

export interface KcalCheck {
  reported: number | null;
  calculated: number | null;
  difference: number | null;
  status: ValidationStatus;
}

/** Compara kcal informada × calculada. Tolerância: 2 kcal ou 3 %. */
export function compareKcal(reported: number | null, calculated: number | null): KcalCheck {
  if (reported === null || calculated === null) {
    return { reported, calculated, difference: null, status: reported === null ? 'calculado' : 'nao_informado' };
  }
  const difference = round2(reported - calculated);
  const tol = Math.max(2, Math.abs(calculated) * 0.03);
  return { reported, calculated, difference, status: Math.abs(difference) <= tol ? 'ok' : 'inconsistente' };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ───────────────────────── Datas e horários ─────────────────────────

/** Série do Excel (sistema 1900) → "AAAA-MM-DD", sem fuso horário. */
export function excelSerialToISO(serial: number): string {
  // 25569 = 1970-01-01. Serial 60 (29/02/1900 fictício) não ocorre em datas reais modernas.
  const ms = Math.round((Math.floor(serial) - 25569) * 86400000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Aceita série numérica, Date (criada pelo leitor em horário local) ou texto dd/mm/aaaa. */
export function toISODate(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return input > 0 ? excelSerialToISO(input) : null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    // SheetJS cria a data em horário local à meia-noite; usar componentes locais preserva o dia.
    return `${input.getFullYear()}-${pad(input.getMonth() + 1)}-${pad(input.getDate())}`;
  }
  const s = String(input).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Fração do dia do Excel (0.229…) ou texto "05:30" → "HH:MM". */
export function toTimeHHMM(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number' && input >= 0 && input < 1) {
    const total = Math.round(input * 24 * 60);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }
  if (input instanceof Date) return `${pad(input.getHours())}:${pad(input.getMinutes())}`;
  const m = String(input)
    .trim()
    .match(/^(\d{1,2})[:h](\d{2})/);
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "≈35'" → {35, aproximado}; "30'" → 30; "conforme programação"/"—" → null. */
export function parseDurationMinutes(text: unknown): { minutes: number | null; approximate: boolean } {
  if (text === null || text === undefined) return { minutes: null, approximate: false };
  const s = String(text);
  const m = s.match(/(\d+)\s*'/) ?? s.match(/(\d+)\s*min/i);
  if (!m) return { minutes: null, approximate: false };
  return { minutes: Number(m[1]), approximate: s.includes('≈') || s.includes('~') };
}

/** Diferença em dias entre datas ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function slug(s: string): string {
  return normalizeName(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
