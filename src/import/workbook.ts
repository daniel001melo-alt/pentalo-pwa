import * as XLSX from 'xlsx';
import type { FileKind, SourceReference, ValidationStatus } from '../domain/schemas';

export type WorkbookFormat = 'xlsx' | 'xls';

/**
 * Detecta o formato pelos bytes (não pela extensão):
 * XLSX = ZIP "PK\x03\x04"; XLS (BIFF8) = OLE2 "D0 CF 11 E0 A1 B1 1A E1".
 */
export function detectFormat(bytes: Uint8Array): WorkbookFormat | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'xlsx';
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length >= 8 && ole.every((b, i) => bytes[i] === b)) return 'xls';
  return null;
}

export interface LoadedWorkbook {
  wb: XLSX.WorkBook;
  format: WorkbookFormat;
  fileName: string;
  kind: FileKind;
  size: number;
  formulas: number;
  formulasWithoutCache: string[];
  /** células com erro do Excel (#VALOR!, #REF!…) */
  errorCells: string[];
  mergedRanges: number;
}

export function readWorkbook(data: ArrayBuffer | Uint8Array, fileName: string, kind: FileKind): LoadedWorkbook {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const format = detectFormat(bytes);
  if (!format) {
    throw new Error(`"${fileName}" não é uma planilha XLS ou XLSX válida (assinatura de arquivo não reconhecida). ` + 'Renomear a extensão não converte o arquivo.');
  }
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true, cellDates: false, cellStyles: false });
  let formulas = 0;
  const formulasWithoutCache: string[] = [];
  const errorCells: string[] = [];
  let mergedRanges = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    mergedRanges += (ws['!merges'] ?? []).length;
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const c = ws[addr] as XLSX.CellObject;
      const noValue = c.v === undefined || c.v === null || c.t === 'z';
      if (c.f) {
        formulas++;
        if (noValue) formulasWithoutCache.push(`${name}!${addr}`);
      }
      if (c.t === 'e' && !noValue) errorCells.push(`${name}!${addr} (${c.w ?? 'erro'})`);
    }
  }
  return { wb, format, fileName, kind, size: bytes.byteLength, formulas, formulasWithoutCache, errorCells, mergedRanges };
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback (FNV-1a) — só identifica o arquivo; não é usado para segurança.
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return 'fnv1a-' + h.toString(16);
}

/** Acesso a células com resolução de mesclagens e referência de origem. */
export class SheetReader {
  readonly ws: XLSX.WorkSheet;
  readonly range: XLSX.Range;
  private readonly merges: XLSX.Range[];

  constructor(
    readonly book: LoadedWorkbook,
    readonly name: string,
  ) {
    const ws = book.wb.Sheets[name];
    if (!ws) throw new Error(`Aba "${name}" não encontrada em ${book.fileName}`);
    this.ws = ws;
    this.range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
    this.merges = ws['!merges'] ?? [];
  }

  static addr(r: number, c: number): string {
    return XLSX.utils.encode_cell({ r, c });
  }

  static col(c: number): string {
    return XLSX.utils.encode_col(c);
  }

  static decodeCol(col: string): number {
    return XLSX.utils.decode_col(col);
  }

  get maxRow(): number {
    return this.range.e.r;
  }

  get maxCol(): number {
    return this.range.e.c;
  }

  cell(r: number, c: number): XLSX.CellObject | undefined {
    return this.ws[SheetReader.addr(r, c)] as XLSX.CellObject | undefined;
  }

  /** Valor bruto (cache da fórmula, número, texto, Date). Células mescladas devolvem o valor da célula de origem. */
  raw(r: number, c: number): unknown {
    const direct = this.cell(r, c);
    // erro do Excel: o "valor" é um código numérico interno — nunca usá-lo como dado
    if (direct?.t === 'e') return null;
    if (direct && direct.v !== undefined && direct.v !== null && direct.v !== '') return direct.v;
    const m = this.merges.find((mr) => r >= mr.s.r && r <= mr.e.r && c >= mr.s.c && c <= mr.e.c);
    if (m && (m.s.r !== r || m.s.c !== c)) {
      const origin = this.cell(m.s.r, m.s.c);
      return origin?.v ?? null;
    }
    return direct?.v ?? null;
  }

  text(r: number, c: number): string {
    const v = this.raw(r, c);
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    return String(v).replace(/\r\n/g, '\n').trim();
  }

  formula(r: number, c: number): string | null {
    return this.cell(r, c)?.f ?? null;
  }

  isMerged(r: number, c: number): boolean {
    return this.merges.some((mr) => r >= mr.s.r && r <= mr.e.r && c >= mr.s.c && c <= mr.e.c);
  }

  mergeCount(): number {
    return this.merges.length;
  }

  /** Procura a primeira célula cujo texto satisfaça o predicado (varredura por linhas). */
  find(pred: (text: string) => boolean, opts: { fromRow?: number; toRow?: number; col?: number } = {}): { r: number; c: number } | null {
    const r0 = opts.fromRow ?? this.range.s.r;
    const r1 = opts.toRow ?? this.range.e.r;
    for (let r = r0; r <= r1; r++) {
      const cols = opts.col !== undefined ? [opts.col] : range(this.range.s.c, this.range.e.c);
      for (const c of cols) {
        const t = this.text(r, c);
        if (t && pred(t)) return { r, c };
      }
    }
    return null;
  }

  rowTexts(r: number): string[] {
    return range(0, this.range.e.c).map((c) => this.text(r, c));
  }

  ref(r: number, c: number | [number, number], status: ValidationStatus = 'ok', extra: Partial<SourceReference> = {}): SourceReference {
    const cell = Array.isArray(c) ? `${SheetReader.addr(r, c[0])}:${SheetReader.addr(r, c[1])}` : SheetReader.addr(r, c);
    return {
      fileKind: this.book.kind,
      fileName: this.book.fileName,
      sheet: this.name,
      cell,
      status,
      ...extra,
    };
  }
}

export function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function hasSheet(book: LoadedWorkbook, name: string): boolean {
  return book.wb.SheetNames.includes(name);
}

/** Encontra aba por nome tolerando acentos/caixa ("Sessoes (detalhe)" ≈ "Sessões (detalhe)"). */
export function findSheet(book: LoadedWorkbook, wanted: string): string | null {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const w = norm(wanted);
  return book.wb.SheetNames.find((n) => norm(n) === w) ?? null;
}
