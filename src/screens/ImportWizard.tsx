import { useState } from 'react';
import { commitImport, prepareImport, type IncomingFile, type PreparedImport } from '../import/pipeline';
import { Card, cx } from '../ui/kit';
import { ReportView } from './ReportView';

const STEPS = ['Planejamento', 'Dieta-base', 'Análise', 'Prévia', 'Confirmar'];

async function readFile(f: File): Promise<IncomingFile> {
  return { name: f.name, bytes: await f.arrayBuffer() };
}

export function ImportWizard({ firstRun, onDone, onCancel }: { firstRun: boolean; onDone: () => void; onCancel?: () => void }) {
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<IncomingFile | null>(null);
  const [base, setBase] = useState<IncomingFile | null>(null);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    setStep(2);
    try {
      const p = await prepareImport({ plan: plan ?? undefined, base: base ?? undefined });
      setPrepared(p);
      setStep(3);
    } catch (e) {
      setError((e as Error).message);
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    try {
      await commitImport(prepared, resolutions);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pendingChoices = prepared?.report.conflicts.filter((c) => c.requiresChoice && !resolutions[c.id]).length ?? 0;
  const canAnalyze = firstRun ? !!plan : !!plan || !!base;

  return (
    <div className="pt-safe mx-auto min-h-full max-w-xl px-4 pb-16">
      <header className="mb-4 mt-2">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-accent">{firstRun ? 'Configuração inicial' : 'Reimportação'}</p>
        <h1 className="font-display text-[26px] font-extrabold leading-tight">Importar planilhas</h1>
        <p className="mt-1 text-[14px] text-muted">
          Os arquivos são lidos só neste aparelho. Nada é enviado para servidor. Depois da importação, o app funciona offline com os dados salvos localmente.
        </p>
      </header>

      <ol className="mb-4 flex gap-1" aria-label="Passos">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={cx('h-1.5 rounded-full', i <= step ? 'bg-accent' : 'bg-surface2')} />
            <span className={cx('mt-1 block text-center text-[11px] font-semibold', i === step ? 'text-ink' : 'text-muted')} aria-current={i === step ? 'step' : undefined}>
              {i + 1}. {s}
            </span>
          </li>
        ))}
      </ol>

      {error && (
        <div role="alert" className="card mb-4 border-bad/50 text-bad">
          {error}
        </div>
      )}

      {step === 0 && (
        <Card>
          <h2 className="text-[18px] font-bold">Passo 1 — Planejamento de treino e nutrição</h2>
          <p className="mt-1 text-[14px] text-muted">Arquivo principal (ex.: Plano_Pentatlo_Militar_Daniel_2026-27.xlsx). Fonte primária de datas, sessões, perfis e refeições.</p>
          <FilePick file={plan} onPick={setPlan} id="plan-file" />
          {!firstRun && <p className="mt-2 text-[13px] text-muted">Deixe em branco para manter o planejamento atual e reimportar só a dieta-base.</p>}
          <div className="mt-4 flex gap-2">
            {onCancel && (
              <button className="btn-ghost flex-1" onClick={onCancel}>
                Cancelar
              </button>
            )}
            <button className="btn-primary flex-1" disabled={firstRun && !plan} onClick={() => setStep(1)}>
              Continuar
            </button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <h2 className="text-[18px] font-bold">Passo 2 — Dieta-base original</h2>
          <p className="mt-1 text-[14px] text-muted">Arquivo histórico (ex.: DIETA BASE - MASCULINA.xls). Usado como referência e base de alimentos — nunca substitui o plano atual.</p>
          <FilePick file={base} onPick={setBase} id="base-file" />
          <p className="mt-2 text-[13px] text-muted">{firstRun ? 'Opcional: sem ele, a aba “Dieta-base” e as equivalências ficam vazias.' : 'Deixe em branco para manter a dieta-base atual.'}</p>
          <div className="mt-4 flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setStep(0)}>
              Voltar
            </button>
            <button className="btn-primary flex-1" disabled={!canAnalyze || busy} onClick={() => void analyze()}>
              Analisar
            </button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <p role="status" className="text-center font-semibold">
            Lendo células, fórmulas e mesclagens… cruzando os dois arquivos…
          </p>
        </Card>
      )}

      {step === 3 && prepared && (
        <>
          <h2 className="mb-2 text-[18px] font-bold">Passo 4 — Prévia e relatório de importação</h2>
          <ReportView report={prepared.report} resolutions={resolutions} onResolve={(id, v) => setResolutions((r) => ({ ...r, [id]: v }))} />
          <div className="sticky bottom-0 mt-4 flex gap-2 bg-bg/90 py-3 backdrop-blur">
            <button className="btn-ghost flex-1" onClick={() => setStep(1)}>
              Voltar
            </button>
            <button className="btn-primary flex-1" disabled={prepared.report.blocking > 0 || pendingChoices > 0} onClick={() => setStep(4)}>
              {prepared.report.blocking > 0 ? 'Há erros bloqueadores' : pendingChoices ? `Escolha ${pendingChoices} item(ns)` : 'Continuar'}
            </button>
          </div>
        </>
      )}

      {step === 4 && prepared && (
        <Card>
          <h2 className="text-[18px] font-bold">Passo 5 — Confirmar importação</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
            {prepared.writes.plan && <li>Planejamento: {prepared.files.plan?.fileName} — substitui sessões, perfis, refeições e alimentos do plano.</li>}
            {prepared.writes.base && <li>Dieta-base: {prepared.files.base?.fileName} — substitui a referência histórica e as listas de equivalência.</li>}
            <li>
              <b>Não são alterados:</b> treinos concluídos, RPE, observações, dor, bem-estar, refeições marcadas, hidratação, suplementação, notas, configurações e histórico de aderência.
            </li>
            {!firstRun && <li>Um backup automático completo é criado antes da gravação.</li>}
          </ul>
          <div className="mt-4 flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setStep(3)} disabled={busy}>
              Voltar
            </button>
            <button className="btn-primary flex-1" onClick={() => void confirm()} disabled={busy}>
              {busy ? 'Gravando…' : 'Confirmar e salvar'}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

function FilePick({ file, onPick, id }: { file: IncomingFile | null; onPick: (f: IncomingFile | null) => void; id: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-3">
      <label htmlFor={id} className="btn-ghost w-full cursor-pointer">
        {file ? `✓ ${file.name}` : 'Escolher arquivo .xlsx ou .xls'}
      </label>
      <input
        id={id}
        type="file"
        className="sr-only"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setErr(null);
          if (!f) return onPick(null);
          if (f.size > 20 * 1024 * 1024) return setErr('Arquivo maior que 20 MB.');
          onPick(await readFile(f));
        }}
      />
      {file && <p className="mt-1 text-[12px] text-muted">{(file.bytes.byteLength / 1024).toFixed(0)} KB — o formato real (XLS/XLSX) é verificado pelo conteúdo, não pela extensão.</p>}
      {err && <p className="mt-1 text-[13px] text-bad">{err}</p>}
    </div>
  );
}
