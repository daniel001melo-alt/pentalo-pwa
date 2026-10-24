import { describe, expect, it } from 'vitest';
import {
  compareKcal,
  excelSerialToISO,
  kcal449,
  normalizeName,
  normalizeUnit,
  parseDecimal,
  parseDurationMinutes,
  parseQuantity,
  similarityKey,
  sourced,
  toISODate,
  toTimeHHMM,
} from '../src/import/normalize';

describe('vírgula decimal e números como texto', () => {
  it('converte com segurança', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal(' 8,5 ')).toBe(8.5);
    expect(parseDecimal('1.234,5')).toBe(1234.5);
    expect(parseDecimal('1.5')).toBe(1.5);
    expect(parseDecimal(42)).toBe(42);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('—')).toBeNull();
    expect(parseDecimal(Number.NaN)).toBeNull();
  });
  it('preserva o original e marca o status', () => {
    expect(sourced('1,5', 'G20')).toEqual({ original: '1,5', value: 1.5, cell: 'G20', status: 'requer_validacao' });
    expect(sourced(13.8).status).toBe('ok');
    expect(sourced(null).status).toBe('nao_informado');
    expect(sourced('x').status).toBe('inconsistente');
  });
});

describe('normalização de unidades', () => {
  it('g, kg, ml, L e unidade', () => {
    expect(parseQuantity('100g')).toMatchObject({ value: 100, unit: 'g' });
    expect(parseQuantity('100 ml')).toMatchObject({ value: 100, unit: 'ml' });
    expect(parseQuantity('2g ')).toMatchObject({ value: 2, unit: 'g' });
    expect(parseQuantity('1,5 kg')).toMatchObject({ value: 1500, unit: 'g', unitOriginal: 'kg' });
    expect(parseQuantity('1 L')).toMatchObject({ value: 1000, unit: 'ml' });
    expect(parseQuantity('3 un')).toMatchObject({ value: 3, unit: 'un' });
    expect(normalizeUnit('Unid.'.replace('.', ''))).toBe('un');
  });
  it('quantidade sem unidade fica sem unidade (quem chama decide)', () => {
    expect(parseQuantity(1)).toMatchObject({ value: 1, unit: null });
    expect(parseQuantity('100')).toMatchObject({ value: 100, unit: null });
    expect(parseQuantity('Carne vermelhas* patinho')).toMatchObject({ value: null });
  });
});

describe('nomes e possíveis duplicatas', () => {
  it('normaliza caixa, acentos, espaços e parênteses', () => {
    expect(normalizeName('  Ovos Inteiros (cozido, omelete, mexido) ')).toBe('ovos inteiros');
    expect(normalizeName('Maçã Fuji')).toBe('maca fuji');
    expect(normalizeName('Carne vermelha crua *')).toBe('carne vermelha crua');
  });
  it('"ovo inteiro" ≈ "ovos inteiros" (só como possível duplicata)', () => {
    expect(similarityKey('Ovo inteiro')).toBe(similarityKey('Ovos Inteiros (cozido, omelete, mexido)'));
    expect(similarityKey('Banana nanica')).toBe(similarityKey('banana nanica'));
    expect(similarityKey('Arroz branco')).not.toBe(similarityKey('Arroz integral'));
  });
});

describe('calorias 4/4/9', () => {
  it('calcula só para conferência', () => {
    expect(kcal449(13.8, 34, 4.2)).toBe(229);
    expect(kcal449(null, null, null)).toBeNull();
    expect(kcal449(23, 5, null)).toBe(112);
  });
  it('compara informada × calculada', () => {
    expect(compareKcal(229, 229).status).toBe('ok');
    expect(compareKcal(300, 229)).toMatchObject({ status: 'inconsistente', difference: 71 });
    expect(compareKcal(null, 229).status).toBe('calculado');
  });
});

describe('datas e horários do Excel', () => {
  it('número de série → data sem fuso', () => {
    expect(excelSerialToISO(46321)).toBe('2026-10-26');
    expect(excelSerialToISO(46445)).toBe('2027-02-27');
    expect(toISODate(46321.75)).toBe('2026-10-26');
  });
  it('Date criada em horário local, texto dd/mm/aaaa e ISO', () => {
    expect(toISODate(new Date(2026, 9, 26))).toBe('2026-10-26');
    expect(toISODate('27/02/2027')).toBe('2027-02-27');
    expect(toISODate('2027-02-27T00:00:00')).toBe('2027-02-27');
    expect(toISODate('')).toBeNull();
  });
  it('horários', () => {
    expect(toTimeHHMM(0.2291666667)).toBe('05:30');
    expect(toTimeHHMM('5:30')).toBe('05:30');
    expect(toTimeHHMM('20:00')).toBe('20:00');
  });
  it('duração', () => {
    expect(parseDurationMinutes("≈35'")).toEqual({ minutes: 35, approximate: true });
    expect(parseDurationMinutes("30'")).toEqual({ minutes: 30, approximate: false });
    expect(parseDurationMinutes('conforme programação').minutes).toBeNull();
    expect(parseDurationMinutes('—').minutes).toBeNull();
  });
});
