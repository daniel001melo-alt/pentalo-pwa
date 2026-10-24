import { createAutoBackup } from '../domain/backup';
import type { DataConflict, ImportFile, ImportReport, Supplement } from '../domain/schemas';
import { getDB, getSettings, PLAN_TABLES, saveSettings, type AppDB } from '../db/db';
import { buildReport, crossCheck, type CrossCheckResult } from './crossCheck';
import { profileIdFromName, parsePlanWorkbook, type PlanImport } from './parsePlan';
import { parseBaseDietWorkbook, type BaseDietImport } from './parseBaseDiet';
import { readWorkbook, sha256Hex } from './workbook';

export interface IncomingFile {
  name: string;
  bytes: ArrayBuffer;
}

export interface PreparedImport {
  plan: PlanImport | null;
  base: BaseDietImport | null;
  /** quais arquivos serão gravados nesta operação (o outro pode ter sido lido só para o cruzamento) */
  writes: { plan: boolean; base: boolean };
  files: { plan?: ImportFile & { bytes: ArrayBuffer }; base?: ImportFile & { bytes: ArrayBuffer } };
  cross: CrossCheckResult;
  report: ImportReport;
  fatal: string[];
}

async function toImportFile(kind: 'plan' | 'baseDiet', f: IncomingFile, format: 'xlsx' | 'xls', sheetNames: string[]) {
  return {
    id: kind,
    fileName: f.name,
    size: f.bytes.byteLength,
    format,
    sha256: await sha256Hex(f.bytes),
    importedAt: new Date().toISOString(),
    sheetNames,
    bytes: f.bytes,
  };
}

/**
 * Lê e analisa os arquivos SEM gravar nada. O arquivo que não foi enviado é carregado da
 * cópia local (se existir) apenas para o cruzamento de dados.
 */
export async function prepareImport(input: { plan?: IncomingFile; base?: IncomingFile }, db: AppDB = getDB()): Promise<PreparedImport> {
  const fatal: string[] = [];
  let plan: PlanImport | null = null;
  let base: BaseDietImport | null = null;
  const files: PreparedImport['files'] = {};

  const planSrc = input.plan ?? (await db.importBlobs.get('plan').then((b) => (b ? { name: b.fileName, bytes: b.bytes } : undefined)));
  const baseSrc = input.base ?? (await db.importBlobs.get('baseDiet').then((b) => (b ? { name: b.fileName, bytes: b.bytes } : undefined)));

  if (planSrc) {
    try {
      const book = readWorkbook(planSrc.bytes, planSrc.name, 'plan');
      plan = parsePlanWorkbook(book);
      if (input.plan) files.plan = await toImportFile('plan', input.plan, book.format, book.wb.SheetNames);
    } catch (e) {
      fatal.push(`Planejamento: ${(e as Error).message}`);
    }
  }
  if (baseSrc) {
    try {
      const book = readWorkbook(baseSrc.bytes, baseSrc.name, 'baseDiet');
      base = parseBaseDietWorkbook(book);
      if (input.base) files.base = await toImportFile('baseDiet', input.base, book.format, book.wb.SheetNames);
    } catch (e) {
      fatal.push(`Dieta-base: ${(e as Error).message}`);
    }
  }
  const cross = crossCheck(plan, base);
  const report = buildReport(plan, base, cross);
  report.blocking += fatal.length;
  for (const msg of fatal) report.issues.unshift({ id: `fatal-${report.issues.length}`, severity: 'bloqueador', category: 'estrutura', message: msg });
  return { plan, base, writes: { plan: !!input.plan && !!plan, base: !!input.base && !!base }, files, cross, report, fatal };
}

export interface CommitResult {
  orphans: { sessionLogs: string[]; mealLogs: string[] };
  autoBackupId: string | null;
}

/**
 * Grava a importação. Regras:
 * - só substitui os dados de origem do(s) arquivo(s) importado(s);
 * - nunca escreve nas tabelas de progresso pessoal (logs, água, suplementos, bem-estar, dor, notas);
 * - não sobrescreve configurações escolhidas pelo usuário;
 * - cria backup automático antes de substituir dados existentes.
 */
export async function commitImport(prepared: PreparedImport, resolutions: Record<string, string> = {}, db: AppDB = getDB()): Promise<CommitResult> {
  if (prepared.report.blocking > 0) throw new Error('Importação bloqueada: corrija os erros bloqueadores primeiro.');
  const { plan, base } = prepared;
  const hasExisting = (await db.importFiles.count()) > 0;
  const autoBackupId = hasExisting ? await createAutoBackup('Antes de reimportar planilhas', db) : null;

  // aplica escolhas do usuário em conflitos que exigem decisão
  if (plan && prepared.writes.plan) {
    for (const c of prepared.cross.conflicts.filter((x) => x.requiresChoice && resolutions[x.id])) {
      const date = c.subject.replace('Perfil do dia ', '');
      const dp = plan.dayPlans.find((d) => d.date === date);
      if (dp) {
        dp.profileName = resolutions[c.id];
        dp.profileId = profileIdFromName(resolutions[c.id]);
        dp.profileSource = { ...dp.profileSource, fileKind: 'user', status: 'configuravel', note: `Escolha do usuário na importação (${dp.profileSource.note ?? ''})` };
      }
      c.resolution = resolutions[c.id];
      c.operational = 'user';
    }
  }

  const tables = [db.importFiles, db.importBlobs, db.reports, db.conflicts, db.foods, db.baseDiet, db.coachNotes, db.supplements, db.meta, ...PLAN_TABLES.map((t) => db[t])];
  await db.transaction('rw', tables, async () => {
    if (plan && prepared.writes.plan && prepared.files.plan) {
      for (const t of PLAN_TABLES) await db[t].clear();
      await db.foods.where('origin').equals('plan').delete();
      await db.coachNotes.where('origin').equals('planilha').delete();
      await db.phases.bulkPut(plan.phases);
      await db.mesocycles.bulkPut(plan.mesocycles);
      await db.weeks.bulkPut(plan.weeks);
      await db.sessions.bulkPut(plan.sessions);
      await db.dayPlans.bulkPut(plan.dayPlans);
      await db.dietProfiles.bulkPut(plan.dietProfiles);
      await db.meals.bulkPut(plan.meals);
      await db.mealItems.bulkPut(plan.mealItems);
      await db.paceZones.bulkPut(plan.paceZones);
      await db.swimZones.bulkPut(plan.swimZones);
      await db.guidelines.bulkPut(plan.guidelines);
      await db.progressionTables.bulkPut(plan.progressionTables);
      await db.foods.bulkPut(plan.foods);
      await db.coachNotes.bulkPut(plan.coachNotes);
      const { bytes, ...meta } = prepared.files.plan;
      await db.importFiles.put(meta);
      await db.importBlobs.put({ id: 'plan', fileName: meta.fileName, bytes });
      await db.meta.put({
        key: 'planMeta',
        value: { competition: plan.competition, hydrationReference: plan.hydrationReference, supplementReferences: plan.supplementReferences, weightKg: plan.weightKg },
      });
    }
    if (base && prepared.writes.base && prepared.files.base) {
      await db.baseDiet.clear();
      await db.foods.where('origin').equals('baseDiet').delete();
      if (base.baseDiet) await db.baseDiet.put(base.baseDiet);
      await db.foods.bulkPut(base.foods);
      const { bytes, ...meta } = prepared.files.base;
      await db.importFiles.put(meta);
      await db.importBlobs.put({ id: 'baseDiet', fileName: meta.fileName, bytes });
    }
    await db.conflicts.clear();
    await db.conflicts.bulkPut(prepared.cross.conflicts as DataConflict[]);
    await ensureSupplements(db, plan);
  });

  // configurações: só preenche o que o usuário ainda não escolheu
  const settings = await getSettings(db);
  const patch: Parameters<typeof saveSettings>[0] = {};
  if (plan?.competition && settings.competitionDateOrigin !== 'usuario') {
    patch.competitionDate = plan.competition.date;
    patch.competitionDateOrigin = 'planilha';
  }
  if (plan?.hydrationReference) patch.hydration = { ...settings.hydration, planReference: plan.hydrationReference.text, planSource: plan.hydrationReference.source };
  if (Object.keys(patch).length) await saveSettings(patch, db);

  const orphans = await findOrphans(db);
  await db.reports.put({ id: 'last', report: prepared.report, orphans });
  return { orphans, autoBackupId };
}

async function ensureSupplements(db: AppDB, plan: PlanImport | null) {
  const defaults: Supplement[] = [
    { id: 'creatina', name: 'Creatina', active: false, time: null, dose: '', notes: '', planReference: null },
    { id: 'beta-alanina', name: 'Beta-alanina', active: false, time: null, dose: '', notes: '', planReference: null },
  ];
  for (const d of defaults) {
    const ref = plan?.supplementReferences.find((s) => s.name.toLowerCase().startsWith(d.name.toLowerCase().slice(0, 4)));
    const existing = await db.supplements.get(d.id);
    if (!existing) await db.supplements.put({ ...d, planReference: ref?.text ?? null });
    // atualiza só a referência textual da planilha; dose/horário/ativo continuam do usuário
    else if (ref && existing.planReference !== ref.text) await db.supplements.update(d.id, { planReference: ref.text });
  }
}

/** Registros de progresso cuja sessão/refeição não existe mais no plano importado (preservados). */
export async function findOrphans(db: AppDB = getDB()) {
  const sessionKeys = new Set(await db.sessions.toCollection().primaryKeys());
  const mealKeys = new Set(await db.meals.toCollection().primaryKeys());
  const logs = await db.sessionLogs.toArray();
  const mlogs = await db.mealLogs.toArray();
  return {
    sessionLogs: logs.filter((l) => !sessionKeys.has(l.sessionKey)).map((l) => l.sessionKey),
    mealLogs: mlogs.filter((l) => !mealKeys.has(l.mealKey)).map((l) => l.id),
  };
}
