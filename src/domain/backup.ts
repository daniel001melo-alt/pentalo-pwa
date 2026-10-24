import { getDB, PROGRESS_TABLES, SETTINGS_KEY, uid, type AppDB } from '../db/db';
import { BACKUP_FORMAT, BACKUP_VERSION, backupFile, type BackupFile } from './schemas';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

/** Tabelas gravadas no backup completo (autoBackups fica de fora para não crescer recursivamente). */
const FULL_TABLES = [
  'meta',
  'importFiles',
  'importBlobs',
  'reports',
  'phases',
  'mesocycles',
  'weeks',
  'sessions',
  'dayPlans',
  'dietProfiles',
  'meals',
  'mealItems',
  'paceZones',
  'swimZones',
  'guidelines',
  'progressionTables',
  'conflicts',
  'foods',
  'baseDiet',
  'coachNotes',
  ...PROGRESS_TABLES,
] as const;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export async function buildBackup(kind: BackupFile['kind'], db: AppDB = getDB()): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  if (kind === 'completo') {
    for (const t of FULL_TABLES) {
      const rows = await db.table(t).toArray();
      tables[t] = t === 'importBlobs' ? rows.map((r) => ({ ...r, bytes: toBase64(r.bytes as ArrayBuffer), encoding: 'base64' })) : rows;
    }
  } else {
    for (const t of PROGRESS_TABLES) tables[t] = await db.table(t).toArray();
    tables.coachNotes = await db.coachNotes.where('origin').equals('usuario').toArray();
    tables.meta = (await db.meta.toArray()).filter((m) => m.key === SETTINGS_KEY);
    // origem dos dados importados (metadados, sem os bytes)
    tables.importFiles = await db.importFiles.toArray();
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, appVersion: APP_VERSION, kind, createdAt: new Date().toISOString(), tables };
}

export function backupFileName(b: BackupFile): string {
  return `pentatlo-backup-${b.kind}-${b.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
}

export interface BackupPreview {
  ok: boolean;
  errors: string[];
  backup: BackupFile | null;
  tables: { name: string; rows: number; existing: number; duplicates: number; known: boolean }[];
}

/** Valida formato e versão e conta registros/duplicatas, sem gravar nada. */
export async function previewBackup(json: string, db: AppDB = getDB()): Promise<BackupPreview> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, errors: ['Arquivo não é um JSON válido.'], backup: null, tables: [] };
  }
  const res = backupFile.safeParse(parsed);
  if (!res.success) {
    return { ok: false, errors: ['Não é um backup deste app: ' + res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')], backup: null, tables: [] };
  }
  const backup = res.data;
  const errors: string[] = [];
  if (backup.version > BACKUP_VERSION) errors.push(`Backup de versão ${backup.version} é mais novo que o app (suporta até ${BACKUP_VERSION}). Atualize o app.`);
  const known = new Set(db.tables.map((t) => t.name));
  const tables: BackupPreview['tables'] = [];
  for (const [name, rows] of Object.entries(backup.tables)) {
    if (!known.has(name)) {
      tables.push({ name, rows: rows.length, existing: 0, duplicates: 0, known: false });
      continue;
    }
    const table = db.table(name);
    const pk = table.schema.primKey.keyPath as string;
    const keys = rows.map((r) => (r as Record<string, unknown>)[pk]).filter((k) => k !== undefined) as string[];
    const existing = await table.count();
    const found = keys.length ? await table.bulkGet(keys) : [];
    tables.push({ name, rows: rows.length, existing, duplicates: found.filter(Boolean).length, known: true });
  }
  return { ok: errors.length === 0, errors, backup, tables };
}

export type RestoreMode = 'mesclar' | 'substituir';

/**
 * Restaura um backup. Sempre cria um backup automático do estado atual antes.
 * - mesclar: registros novos entram; registros com a mesma chave só são trocados se o do backup for mais recente.
 * - substituir: as tabelas presentes no backup são limpas e recarregadas.
 */
export async function restoreBackup(backup: BackupFile, mode: RestoreMode, db: AppDB = getDB()): Promise<{ autoBackupId: string; written: number }> {
  const autoBackupId = await createAutoBackup(`Antes de restaurar backup de ${backup.createdAt.slice(0, 10)} (${mode})`, db);
  const known = new Set(db.tables.map((t) => t.name));
  const names = Object.keys(backup.tables).filter((n) => known.has(n) && n !== 'autoBackups');
  let written = 0;
  await db.transaction(
    'rw',
    names.map((n) => db.table(n)),
    async () => {
      for (const name of names) {
        const table = db.table(name);
        const pk = table.schema.primKey.keyPath as string;
        let rows = backup.tables[name] as Record<string, unknown>[];
        if (name === 'importBlobs') rows = rows.map((r) => (r.encoding === 'base64' ? { id: r.id, fileName: r.fileName, bytes: fromBase64(r.bytes as string) } : r));
        if (mode === 'substituir') {
          if (name === 'coachNotes' && backup.kind === 'progresso') await table.where('origin').equals('usuario').delete();
          else if (name === 'meta' && backup.kind === 'progresso') await table.delete(SETTINGS_KEY);
          else await table.clear();
          await table.bulkPut(rows);
          written += rows.length;
          continue;
        }
        for (const row of rows) {
          const key = row[pk] as string;
          const current = (await table.get(key)) as Record<string, unknown> | undefined;
          if (current) {
            const a = String(current.updatedAt ?? current.createdAt ?? current.at ?? '');
            const b = String(row.updatedAt ?? row.createdAt ?? row.at ?? '');
            if (!b || b <= a) continue; // mantém o mais recente; evita duplicar
          }
          await table.put(row);
          written++;
        }
      }
    },
  );
  return { autoBackupId, written };
}

/** Guarda um backup completo no próprio aparelho (mantém os 5 mais recentes). */
export async function createAutoBackup(reason: string, db: AppDB = getDB()): Promise<string> {
  const data = await buildBackup('completo', db);
  const id = uid('auto');
  await db.autoBackups.put({ id, createdAt: data.createdAt, reason, data });
  const all = await db.autoBackups.orderBy('createdAt').reverse().primaryKeys();
  if (all.length > 5) await db.autoBackups.bulkDelete(all.slice(5));
  return id;
}
