import { useState } from 'react';
import type { DataConflict, ImportIssue, ImportReport } from '../domain/schemas';
import { describeSource } from '../import/crossCheck';
import { Card, cx, SourceInfo } from '../ui/kit';

const COUNT_LABELS: [string, string][] = [
  ['plano.semanas', 'Semanas'],
  ['plano.fases', 'Fases'],
  ['plano.mesociclos', 'Mesociclos'],
  ['plano.sessoes', 'Sessões'],
  ['plano.sessoesPrincipais', 'Sessões principais (»)'],
  ['plano.sessoesOpcionais', 'Sessões opcionais (◦)'],
  ['plano.perfis', 'Perfis nutricionais'],
  ['plano.refeicoes', 'Refeições planejadas'],
  ['plano.itensRefeicao', 'Itens de refeição'],
  ['plano.alimentosPlano', 'Alimentos (plano)'],
  ['plano.alimentosValidos', 'Alimentos do plano sem ressalvas'],
  ['plano.diasComPerfil', 'Dias com perfil'],
  ['base.refeicoes', 'Refeições da dieta-base'],
  ['base.refeicoesPreenchidas', '…preenchidas'],
  ['base.refeicoesVazias', '…vazias'],
  ['base.porcoesListas', 'Porções nas listas de equivalência'],
  ['base.nomesDistintos', 'Alimentos distintos (dieta-base)'],
  ['base.registrosValidos', 'Registros válidos (dieta-base)'],
  ['base.registrosIncompletos', 'Registros incompletos'],
  ['base.possiveisDuplicatas', 'Registros em grupos de possível duplicata'],
  ['base.valoresSuspeitos', 'Valores nutricionais suspeitos'],
  ['divergencias', 'Divergências entre arquivos'],
  ['formulasSemResultado', 'Fórmulas sem resultado'],
  ['camposVazios', 'Avisos de campos vazios'],
];

const CATEGORY_LABEL: Record<ImportIssue['category'], string> = {
  estrutura: 'Estrutura',
  formula_sem_cache: 'Fórmulas sem resultado',
  campo_vazio: 'Campos vazios',
  numero_texto: 'Números como texto',
  unidade: 'Unidades',
  duplicata: 'Possíveis duplicatas',
  nutricional_suspeito: 'Valores nutricionais suspeitos',
  divergencia: 'Divergências',
  ausente: 'Informações ausentes',
  premissa: 'Premissas a validar',
  inconsistencia: 'Inconsistências',
};

export function ReportView({
  report,
  resolutions,
  onResolve,
  orphans,
}: {
  report: ImportReport;
  resolutions?: Record<string, string>;
  onResolve?: (id: string, v: string) => void;
  orphans?: { sessionLogs: string[]; mealLogs: string[] };
}) {
  const [sev, setSev] = useState<'todos' | ImportIssue['severity']>('todos');
  const groups = new Map<string, ImportIssue[]>();
  for (const i of report.issues.filter((x) => sev === 'todos' || x.severity === sev)) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
  const infos = report.issues.filter((i) => i.severity === 'info').length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat n={report.blocking} label="Erros bloqueadores" tone={report.blocking ? 'bad' : 'ok'} />
        <Stat n={report.warnings} label="Avisos" tone={report.warnings ? 'warn' : 'ok'} />
        <Stat n={infos} label="Informações" tone="muted" />
      </div>

      <Card>
        <h3 className="mb-2 font-bold">Arquivos reconhecidos</h3>
        <ul className="space-y-2 text-[14px]">
          {report.files.map((f) => (
            <li key={f.kind}>
              <b>{f.kind === 'plan' ? 'Planejamento' : 'Dieta-base'}:</b> {f.fileName} — formato {f.format.toUpperCase()} (assinatura verificada), {f.sheets.length} abas, {f.formulas} fórmulas
              {f.formulasWithoutCache ? `, ${f.formulasWithoutCache} sem resultado` : ', todas com resultado'}, {f.mergedRanges} células mescladas.
              <details className="mt-1 text-[13px] text-muted">
                <summary>Abas encontradas</summary>
                {f.sheets.join(' · ')}
              </details>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3 className="mb-2 font-bold">Contagens</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[14px]">
          {COUNT_LABELS.filter(([k]) => report.counts[k] !== undefined).map(([k, l]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-line/60 py-1">
              <dt className="text-muted">{l}</dt>
              <dd className="font-semibold tabular-nums">{report.counts[k]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {orphans && (orphans.sessionLogs.length > 0 || orphans.mealLogs.length > 0) && (
        <Card className="border-warn/50">
          <h3 className="font-bold">Progresso preservado sem correspondência</h3>
          <p className="text-[14px] text-muted">
            {orphans.sessionLogs.length} registro(s) de treino e {orphans.mealLogs.length} de refeição não correspondem a nenhuma sessão/refeição do plano atual. Eles NÃO foram apagados e voltam a
            aparecer se o plano anterior for reimportado.
          </p>
        </Card>
      )}

      {report.conflicts.length > 0 && (
        <Card>
          <h3 className="mb-1 font-bold">Divergências entre os arquivos ({report.conflicts.length})</h3>
          <p className="mb-3 text-[13px] text-muted">Valor operacional = plano atual. O valor da dieta-base é preservado como referência histórica.</p>
          <ul className="space-y-3">
            {report.conflicts.map((c) => (
              <ConflictRow key={c.id} c={c} value={resolutions?.[c.id]} onResolve={onResolve} />
            ))}
          </ul>
        </Card>
      )}

      <div>
        <div className="mb-2 flex gap-1 overflow-x-auto">
          {(['todos', 'bloqueador', 'aviso', 'info'] as const).map((s) => (
            <button key={s} className={cx('chip', sev === s && 'border-accent bg-accent text-accentInk')} onClick={() => setSev(s)} aria-pressed={sev === s}>
              {s === 'todos' ? 'Todos' : s === 'bloqueador' ? 'Bloqueadores' : s === 'aviso' ? 'Avisos' : 'Informações'}
            </button>
          ))}
        </div>
        {[...groups].map(([cat, items]) => (
          <details key={cat} className="card mb-2" open={items.some((i) => i.severity === 'bloqueador')}>
            <summary className="cursor-pointer font-semibold">
              {CATEGORY_LABEL[cat as ImportIssue['category']]} <span className="text-muted">({items.length})</span>
            </summary>
            <ul className="mt-2 space-y-2 text-[14px]">
              {items.map((i) => (
                <li key={i.id} className="border-l-4 pl-2" style={{ borderColor: i.severity === 'bloqueador' ? 'rgb(var(--bad))' : i.severity === 'aviso' ? 'rgb(var(--warn))' : 'rgb(var(--line))' }}>
                  <span className="mr-1 text-[11px] font-bold uppercase text-muted">{i.severity === 'bloqueador' ? 'Bloqueador' : i.severity === 'aviso' ? 'Aviso' : 'Info'}</span>
                  {i.message}
                  {i.source && (
                    <div>
                      <SourceInfo source={i.source} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const c = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', muted: 'text-muted' }[tone];
  return (
    <div className="card p-3">
      <div className={cx('text-[26px] font-extrabold tabular-nums', c)}>{n}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </div>
  );
}

function ConflictRow({ c, value, onResolve }: { c: DataConflict; value?: string; onResolve?: (id: string, v: string) => void }) {
  return (
    <li className="rounded-xl bg-surface2 p-3 text-[14px]">
      <div className="font-semibold">
        {c.subject} · {c.field}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase text-muted">Plano (operacional)</div>
          <div className="font-semibold">{String(c.planValue ?? '—')}</div>
          <div className="text-[11px] text-muted">{describeSource(c.planSource)}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase text-muted">{c.baseSource ? 'Dieta-base (histórico)' : 'Outra fonte'}</div>
          <div className="font-semibold">{String(c.baseValue ?? '—')}</div>
          <div className="text-[11px] text-muted">{describeSource(c.baseSource)}</div>
        </div>
      </div>
      {c.note && <p className="mt-1 text-[12px] text-muted">{c.note}</p>}
      {c.requiresChoice && onResolve && (
        <div className="mt-2 flex flex-wrap gap-2">
          {[String(c.planValue), String(c.baseValue).replace(/^Planilha Semanal: /, '')].map((opt) => (
            <button key={opt} className={cx('chip', value === opt && 'border-accent bg-accent text-accentInk')} onClick={() => onResolve(c.id, opt)} aria-pressed={value === opt}>
              Usar “{opt}”
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
