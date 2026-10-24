import type { Exercise, Modality, TrainingSession } from '../domain/schemas';
import { normalizeName } from './normalize';

/**
 * Extração de campos a partir dos textos das sessões. Tudo aqui é DERIVADO do texto
 * original (que é sempre preservado em `detail`); quando nada é encontrado, o campo fica null
 * e a interface mostra "Não informado".
 */

export function stripMarker(type: string): { type: string; marker: '»' | '◦' | null } {
  const t = type.trim();
  if (t.startsWith('◦')) return { type: t.slice(1).trim(), marker: '◦' };
  if (t.startsWith('»')) return { type: t.slice(1).trim(), marker: '»' };
  return { type: t, marker: null };
}

const MODALITY_RULES: [RegExp, Modality][] = [
  [/competi[cç][aã]o/i, 'competicao'],
  [/\bPNU\b/, 'pnu'],
  [/nata[cç][aã]o/i, 'natacao'],
  [/granada/i, 'granada'],
  [/tiro a seco|\btiro\b/i, 'tiro'],
  [/\bPPM\b/, 'ppm'],
  [/flexibilidade|mobilidade/i, 'mobilidade'],
  [/for[cç]a|fortalecimento|\bRML\b|calistenia|ativa[cç][aã]o MI/i, 'forca'],
  [/corrida|rodagem|limiar|vo2|ladeira|tempo cont|intervalado|velocidade|ritmo|teste 3 km|shake-out|soltura|sprint/i, 'corrida'],
];

export function deriveModality(type: string, km: number | null, m: number | null, throws: number | null): Modality {
  for (const [re, mod] of MODALITY_RULES) if (re.test(type)) return mod;
  if (km && km > 0) return 'corrida';
  if (m && m > 0) return 'natacao';
  if (throws && throws > 0) return 'granada';
  return 'outro';
}

export const MODALITY_LABEL: Record<Modality, string> = {
  corrida: 'Corrida',
  natacao: 'Natação',
  forca: 'Força',
  granada: 'Granada',
  tiro: 'Tiro',
  ppm: 'PPM',
  pnu: 'PNU',
  mobilidade: 'Mobilidade',
  competicao: 'Competição',
  outro: 'Outro',
};

export function deriveIntensityLevel(text: string | null): TrainingSession['intensityLevel'] {
  if (!text) return 'nao_informado';
  const t = text;
  if (/\bprova\b/i.test(t) && !/ritmo de prova/i.test(t)) return 'prova';
  if (/t[eé]cnic/i.test(t)) return 'tecnica';
  if (/Z5|VO2|M[aá]x|\bAlta\b|~8\d%|~9\d%|\bAT\b|Z4|limiar|ritmo de prova/i.test(t)) return 'alta';
  if (/Z3|Moderad|~7\d%|A1[–-]A2/i.test(t)) return 'moderada';
  if (/Z1|Z2|A1|A2|leve|baixa|~6\d%|~5\d%/i.test(t)) return 'leve';
  return 'nao_informado';
}

export const INTENSITY_LABEL: Record<TrainingSession['intensityLevel'], string> = {
  leve: 'Leve',
  moderada: 'Moderada',
  alta: 'Alta',
  tecnica: 'Técnica',
  prova: 'Prova',
  nao_informado: 'Não informado',
};

export function extractZones(...texts: (string | null)[]): string | null {
  const found: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\b(Z[1-5]\+?|A1|A2|AT|VO2|LP|LT|Speed)\b/g)) {
      if (!found.includes(m[1])) found.push(m[1]);
    }
    if (found.length) break; // prioriza a intensidade; o detalhe só se a intensidade não tiver zona
  }
  return found.length ? found.join(' / ') : null;
}

export function extractPace(intensity: string | null, detail: string): string | null {
  const perKm = /(\d:\d{2}(?:\s*[–-]\s*\d:\d{2})?)\s*\/km/;
  const fromInt = intensity?.match(perKm);
  if (fromInt) return `${fromInt[1].replace(/\s/g, '')}/km`;
  const fromDetail = detail.match(perKm);
  if (fromDetail) return `${fromDetail[1].replace(/\s/g, '')}/km`;
  const at = detail.match(/\ba\s(\d:\d{2})(?!\s*\/\s*\d)/);
  if (at) return `${at[1]}/km`;
  return null;
}

export function extractIntervals(detail: string): string[] {
  const out: string[] = [];
  for (const m of detail.matchAll(/\bi:\s*([^;,)\n]+?)(?=\s*(?:[;,)\n]|$| trote|\(|\+ ))/g)) {
    const v = m[1].trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export function extractContacts(detail: string): number | null {
  const m = detail.match(/≈?\s?(\d+)\s*contatos/);
  return m ? Number(m[1]) : null;
}

const SKIP_LINE = /^(aquec|desaquec|checagem|registrar|total|coach:|ao final|hidratar)/i;

/** Quebra o detalhe em exercícios (linhas "- ..." e séries "N x ..."). O texto original fica em `raw`. */
export function parseExercises(detail: string): Exercise[] {
  const out: Exercise[] = [];
  for (const rawLine of detail.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const bulleted = line.startsWith('- ');
    const text = bulleted ? line.slice(2).trim() : line;
    if (SKIP_LINE.test(text)) continue;
    const sets = text.match(/(\d+)\s?x\s?(\d+(?:[–-]\d+)?(?:\s?(?:m\b|"|'|\/lado|\/perna))*|¼|½|⅓)/);
    if (!bulleted && !sets) continue;
    const load = text.match(/\((~?\d+%[^)]*)\)/)?.[1] ?? text.match(/\b(?:a|≈)\s?(\d:\d{2}(?:–\d:\d{2})?)/)?.[1] ?? null;
    const rest = text.match(/\bi:\s*([^;,)\n]+)/)?.[1]?.trim() ?? null;
    let name = sets ? text.slice(0, sets.index).trim() : text;
    name = name.replace(/[:–-]\s*$/, '').trim();
    if (!name) name = sets ? text.split(/[(;]/)[0].trim() : text;
    out.push({
      raw: text,
      name,
      sets: sets ? sets[1] : null,
      reps: sets ? sets[2] : null,
      load,
      rest,
    });
  }
  return out;
}

export function sessionKey(date: string, period: string, type: string): string {
  return `${date}|${normalizeName(period)}|${normalizeName(type).replace(/[^a-z0-9]+/g, '-')}`;
}
