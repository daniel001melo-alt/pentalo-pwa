import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB, getSettings, setDB, uid } from '../src/db/db';
import { addWater, applyShift, changeCompetitionDate, previewShift, saveWellness, setSupplementEntry, updateSupplement, upsertMealLog, upsertSessionLog } from '../src/domain/actions';
import { buildBackup, previewBackup, restoreBackup } from '../src/domain/backup';
import { computeDay, loadSnapshot, mealLogId } from '../src/domain/snapshot';
import { commitImport, prepareImport } from '../src/import/pipeline';
import { pwaOptions } from '../src/pwa/pwaOptions';
import { baseDietWorkbook, planWorkbook, toBuffer } from './fixtures';

let db: AppDB;
const planFile = (opts = {}) => ({ name: 'Plano.xlsx', bytes: toBuffer(planWorkbook(opts)) });
const baseFile = () => ({ name: 'DIETA.xls', bytes: toBuffer(baseDietWorkbook()) });

async function importBoth() {
  const p = await prepareImport({ plan: planFile(), base: baseFile() }, db);
  return commitImport(p, {}, db);
}

beforeEach(() => {
  db = new AppDB(`test-${uid()}`);
  setDB(db);
});

describe('importação para o banco local', () => {
  it('grava plano e dieta-base, guarda os arquivos e o relatório', async () => {
    await importBoth();
    expect(await db.sessions.count()).toBe(12);
    expect(await db.foods.where('origin').equals('baseDiet').count()).toBeGreaterThan(10);
    expect((await db.importBlobs.toArray()).map((b) => b.id).sort()).toEqual(['baseDiet', 'plan']);
    expect((await db.reports.get('last'))?.report.blocking).toBe(0);
    const s = await getSettings(db);
    expect(s).toMatchObject({ competitionDate: '2026-11-07', competitionDateOrigin: 'planilha' });
    expect(s.hydration.dailyMl).toBeNull(); // faixa da planilha não vira meta automaticamente
    expect((await db.supplements.toArray()).map((x) => [x.id, x.active, x.dose])).toEqual([
      ['beta-alanina', false, ''],
      ['creatina', false, ''],
    ]);
  });

  it('reimportação não apaga progresso pessoal e lista órfãos', async () => {
    await importBoth();
    const snap = await loadSnapshot(db);
    const target = snap.sessions.find((x) => x.date === '2026-10-27' && x.period === 'AM')!;
    const other = snap.sessions.find((x) => x.date === '2026-10-31')!;
    await upsertSessionLog(target.key, { status: 'concluido', rpe: 7, notes: 'ok' }, db);
    await upsertSessionLog(other.key, { status: 'parcial', painNote: 'canela' }, db);
    const meal = snap.mealsByProfile.get('moderado')![0];
    await upsertMealLog('2026-10-27', meal.key, { status: 'conforme', notes: 'nota' }, db);
    await addWater('2026-10-27', 500, db);
    await saveWellness('2026-10-27', { energy: 4 }, db);
    await updateSupplement('creatina', { active: true, dose: 'definida pelo nutricionista' }, db);
    await setSupplementEntry('2026-10-27', 'creatina', 'tomado', '', db);
    await changeCompetitionDate('2026-11-14', db);

    // plano revisado: a sessão de 31/10 muda de nome
    const p2 = await prepareImport({ plan: planFile({ renameSessionOn: '2026-10-31' }) }, db);
    expect(p2.writes).toEqual({ plan: true, base: false });
    const r = await commitImport(p2, {}, db);

    expect(r.autoBackupId).toBeTruthy();
    expect(await db.sessionLogs.get(target.key)).toMatchObject({ status: 'concluido', rpe: 7, notes: 'ok' });
    expect(await db.sessionLogs.get(other.key)).toMatchObject({ status: 'parcial' }); // preservado
    expect(r.orphans.sessionLogs).toEqual([other.key]);
    expect(await db.mealLogs.get(mealLogId('2026-10-27', meal.key))).toMatchObject({ status: 'conforme', notes: 'nota' });
    expect(await db.hydration.count()).toBe(1);
    expect(await db.wellness.get('2026-10-27')).toMatchObject({ energy: 4 });
    expect(await db.supplements.get('creatina')).toMatchObject({ active: true, dose: 'definida pelo nutricionista' });
    expect(await db.supplementEntries.count()).toBe(1);
    const s = await getSettings(db);
    expect(s).toMatchObject({ competitionDate: '2026-11-14', competitionDateOrigin: 'usuario' }); // escolha do usuário mantida
    expect(await db.foods.where('origin').equals('baseDiet').count()).toBeGreaterThan(10); // base não reimportada continua
  });

  it('importação com erro bloqueador não grava nada', async () => {
    const p = await prepareImport({ plan: { name: 'x.xlsx', bytes: new TextEncoder().encode('não sou planilha').buffer as ArrayBuffer } }, db);
    expect(p.report.blocking).toBeGreaterThan(0);
    await expect(commitImport(p, {}, db)).rejects.toThrow(/bloqueada/);
    expect(await db.sessions.count()).toBe(0);
  });
});

describe('dia, aderência e calendário', () => {
  it('computa o dia com treino, perfil, refeições e aderência', async () => {
    await importBoth();
    await upsertSessionLog((await loadSnapshot(db)).sessionsByDate.get('2026-10-27')![0].key, { status: 'concluido' }, db);
    const snap = await loadSnapshot(db);
    const day = computeDay(snap, '2026-10-27');
    expect(day.week?.number).toBe(1);
    expect(day.phase?.code).toBe('F1');
    expect(day.profile?.id).toBe('moderado');
    expect(day.sessions).toHaveLength(3);
    expect(day.meals).toHaveLength(2);
    expect(day.scores.training).toBeCloseTo(1 / 3);
    expect(day.scores.diet).toBe(0);
    expect(day.scores.supplements).toBeNull();
    expect(day.scores.hydration).toBeNull();
  });

  it('mudar a competição não desloca treinos; deslocar é operação separada com backup', async () => {
    await importBoth();
    await changeCompetitionDate('2026-11-14', db);
    let snap = await loadSnapshot(db);
    expect(computeDay(snap, '2026-11-07').sessions[0].type).toMatch(/COMPETIÇÃO/);
    const prev = previewShift(snap, 7, '2026-10-20');
    expect(prev).toMatchObject({ newStart: '2026-11-02', alignedWithCompetition: true });
    const r = await applyShift(7, db);
    expect(await db.autoBackups.get(r.backupId)).toBeTruthy();
    snap = await loadSnapshot(db);
    expect(computeDay(snap, '2026-11-07').sessions.some((s) => /COMPETIÇÃO/.test(s.type))).toBe(false);
    expect(computeDay(snap, '2026-11-14').sessions[0].type).toMatch(/COMPETIÇÃO/);
    expect(computeDay(snap, '2026-11-14').planDate).toBe('2026-11-07');
  });
});

describe('backup', () => {
  it('exporta completo com a origem dos dados e restaura sem duplicar', async () => {
    await importBoth();
    await addWater('2026-10-27', 250, db);
    const full = await buildBackup('completo', db);
    expect(full.tables.importFiles).toHaveLength(2);
    expect((full.tables.importBlobs[0] as { encoding: string }).encoding).toBe('base64');
    expect((full.tables.sessions[0] as { source: { sheet: string } }).source.sheet).toBe('Sessões (detalhe)');

    const json = JSON.stringify(await buildBackup('progresso', db));
    const pv = await previewBackup(json, db);
    expect(pv.ok).toBe(true);
    expect(pv.tables.find((t) => t.name === 'hydration')).toMatchObject({ rows: 1, duplicates: 1 });
    const res = await restoreBackup(pv.backup!, 'mesclar', db);
    expect(res.written).toBe(0); // mesma chave e mesma data → não duplica
    expect(await db.hydration.count()).toBe(1);
    expect(await db.autoBackups.get(res.autoBackupId)).toBeTruthy();
  });

  it('restaura em outro aparelho (banco vazio) e substitui', async () => {
    await importBoth();
    await addWater('2026-10-27', 250, db);
    const full = await buildBackup('completo', db);
    const db2 = new AppDB(`test-${uid()}`);
    const res = await restoreBackup(full, 'substituir', db2);
    expect(res.written).toBeGreaterThan(50);
    expect(await db2.sessions.count()).toBe(12);
    expect(await db2.hydration.count()).toBe(1);
    const blob = await db2.importBlobs.get('plan');
    expect(blob?.bytes.byteLength).toBeGreaterThan(1000);
  });

  it('valida formato e versão', async () => {
    expect((await previewBackup('{"a":1}', db)).ok).toBe(false);
    expect((await previewBackup('não é json', db)).errors[0]).toMatch(/JSON/);
    const b = await buildBackup('progresso', db);
    const future = await previewBackup(JSON.stringify({ ...b, version: 99 }), db);
    expect(future.ok).toBe(false);
    expect(future.errors[0]).toMatch(/mais novo/);
  });
});

describe('offline', () => {
  it('o service worker pré-carrega todos os assets e responde navegação offline', () => {
    expect(pwaOptions.workbox?.globPatterns?.[0]).toContain('js');
    expect(pwaOptions.workbox?.globPatterns?.[0]).toContain('html');
    expect(pwaOptions.workbox?.navigateFallback).toBe('index.html');
    expect(pwaOptions.registerType).toBe('prompt'); // atualização segura, sem recarregar no meio do uso
    expect(pwaOptions.manifest && typeof pwaOptions.manifest === 'object' && pwaOptions.manifest.display).toBe('standalone');
  });
  it('importar, ler e registrar progresso não usa rede (fetch lança erro nos testes)', async () => {
    await importBoth();
    await upsertSessionLog((await db.sessions.toCollection().first())!.key, { status: 'concluido' }, db);
    const snap = await loadSnapshot(db);
    expect(computeDay(snap, '2026-10-26').sessions).toHaveLength(1);
  });
});
