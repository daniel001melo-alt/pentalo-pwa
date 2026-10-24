import { useEffect, useState } from 'react';
import { autoSessionTime, upsertSessionLog } from '../domain/actions';
import { formatLong, todayISO } from '../domain/dates';
import type { Guideline, SessionLog, SessionStatus, TrainingSession } from '../domain/schemas';
import type { Snapshot } from '../domain/snapshot';
import { INTENSITY_LABEL } from '../import/sessionText';
import { cx, Field, ModalityTag, NotInformed, Sheet, SourceInfo, useToast } from '../ui/kit';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '../db/db';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  nao_iniciado: 'Não iniciado',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  parcial: 'Parcial',
  ignorado: 'Ignorado',
};

const STATUS_ICON: Record<SessionStatus, string> = { nao_iniciado: '○', em_andamento: '◐', concluido: '●', parcial: '◑', ignorado: '⊘' };
const STATUS_TONE: Record<SessionStatus, string> = {
  nao_iniciado: 'text-muted',
  em_andamento: 'text-m-natacao',
  concluido: 'text-ok',
  parcial: 'text-warn',
  ignorado: 'text-bad',
};

export function StatusPill({ status }: { status: SessionStatus }) {
  return (
    <span className={cx('inline-flex items-center gap-1 text-[12px] font-bold', STATUS_TONE[status])}>
      <span aria-hidden>{STATUS_ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function SessionCard({ s, log, date, highlight, isToday, onOpen }: { s: TrainingSession; log?: SessionLog; date?: string; highlight?: boolean; isToday?: boolean; onOpen: () => void }) {
  const toast = useToast();
  const status = log?.status ?? 'nao_iniciado';
  const set = async (st: SessionStatus) => {
    const prev = status;
    await upsertSessionLog(s.key, { status: st, ...autoSessionTime(!!isToday, st, log) });
    toast(`${s.type}: ${STATUS_LABEL[st]}`, { label: 'Desfazer', run: () => void upsertSessionLog(s.key, { status: prev }) });
  };
  return (
    <div className={cx('card p-3', highlight && 'border-2 border-accent', s.priority === 'opcional' && 'border-dashed')}>
      <button className="block w-full text-left" onClick={onOpen} aria-label={`Abrir ${s.type}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-[18px] font-black leading-none"
            title={s.priority === 'principal' ? 'Sessão principal' : 'Sessão opcional'}
            aria-label={s.priority === 'principal' ? 'Principal' : 'Opcional'}
          >
            {s.marker}
          </span>
          <ModalityTag modality={s.modality} small />
          <span className="text-[12px] font-semibold text-muted">{s.period}</span>
          {s.priority === 'opcional' && <span className="rounded bg-surface2 px-1.5 text-[11px] font-bold text-muted">OPCIONAL</span>}
          <span className="ml-auto">
            <StatusPill status={status} />
          </span>
        </div>
        <div className="mt-1 text-[16px] font-bold leading-snug">{s.type}</div>
        <div className="mt-0.5 text-[13px] text-muted">
          {date && <>{formatLong(date)} · </>}
          {s.durationText ?? 'duração não informada'} · {s.intensityText ?? 'intensidade não informada'}
        </div>
      </button>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button
          className={cx('btn-ghost min-h-[40px] px-2 text-[13px]', status === 'concluido' && 'border-ok bg-ok/15 text-ok')}
          onClick={() => void set('concluido')}
          aria-pressed={status === 'concluido'}
        >
          ✓ Concluído
        </button>
        <button
          className={cx('btn-ghost min-h-[40px] px-2 text-[13px]', status === 'parcial' && 'border-warn bg-warn/15 text-warn')}
          onClick={() => void set('parcial')}
          aria-pressed={status === 'parcial'}
        >
          ◑ Parcial
        </button>
        <button className={cx('btn-ghost min-h-[40px] px-2 text-[13px]', status === 'ignorado' && 'border-bad bg-bad/15 text-bad')} onClick={onOpen}>
          ⋯ Registrar
        </button>
      </div>
    </div>
  );
}

/** Orientações da planilha relacionadas à sessão (biblioteca, segurança, timing). */
function relatedGuidelines(s: TrainingSession, guidelines: Guideline[]): Guideline[] {
  const text = `${s.type} ${s.detail}`;
  const want: RegExp[] = [];
  if (/PPM-A/.test(text)) want.push(/^PPM-A/);
  if (/PPM-B/.test(text)) want.push(/^PPM-B/);
  if (/PPM-C/.test(text)) want.push(/^PPM-C/);
  if (/pista real|PPM \(pista|PPM –/i.test(text)) want.push(/^PPM-D/);
  if (/apneia|submerso/i.test(text)) want.push(/^Apneia$/);
  if (/clean|LPO|snatch|jerk/i.test(text)) want.push(/^LPO/);
  if (s.modality === 'granada') want.push(/^Ombro\/granada$/, /^Pré-lançamento/);
  if (/pliometria|drop jump|depth jump|box jump/i.test(text)) want.push(/^Pliometria$/);
  if (s.modality === 'corrida') want.push(/^Aquecimento padrão de corrida$/);
  if (/mobilidade/i.test(text)) want.push(/^Rotina diária de mobilidade/);
  if (s.runKm && s.runKm >= 14) want.push(/^Corrida longa\/intervalado/);
  want.push(/^Controle de carga$/);
  return guidelines.filter((g) => want.some((re) => re.test(g.title)));
}

export function SessionSheet({ s, date, snap, onClose }: { s: TrainingSession | null; date?: string; snap: Snapshot; onClose: () => void }) {
  const log = s ? snap.sessionLogs.get(s.key) : undefined;
  const guidelines = useLiveQuery(() => getDB().guidelines.toArray(), []) ?? [];
  const toast = useToast();
  const [form, setForm] = useState<Partial<SessionLog>>({});
  useEffect(() => {
    setForm(log ?? {});
  }, [log, s?.key]);
  if (!s) return null;
  const save = async (patch: Partial<SessionLog>) => {
    await upsertSessionLog(s.key, patch);
    toast('Registro salvo');
  };
  const status = (form.status ?? 'nao_iniciado') as SessionStatus;
  const related = relatedGuidelines(s, guidelines);
  return (
    <Sheet open={!!s} onClose={onClose} title={`${s.marker} ${s.type}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ModalityTag modality={s.modality} />
          <span className="chip">{s.priority === 'principal' ? '» Principal' : '◦ Opcional / secundária'}</span>
          <span className="chip">
            S{s.week} · {s.weekday} · {s.period}
          </span>
        </div>
        {date && <p className="text-[14px] text-muted">{formatLong(date)}</p>}
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Duração" value={s.durationText} />
          <Field label="Intensidade" value={s.intensityText ? `${s.intensityText}` : null} />
          <Field label="Zona" value={s.zone} />
          <Field label="Pace" value={s.pace} />
          <Field
            label="Volume"
            value={
              [s.runKm ? `${s.runKm} km` : '', s.swimM ? `${s.swimM} m` : '', s.throws ? `${s.throws} lançamentos` : '', s.contacts ? `≈${s.contacts} contatos` : ''].filter(Boolean).join(' · ') ||
              null
            }
          />
          <Field label="Intervalos" value={s.intervals.length ? s.intervals.join(' · ') : null} />
          <Field label="Nível (derivado)" value={INTENSITY_LABEL[s.intensityLevel]} />
          <Field label="Objetivo da semana" value={snap.weeks.find((w) => w.number === s.week)?.objective} />
        </dl>

        {s.exercises.length > 0 && (
          <div>
            <h3 className="section-title mt-0">Séries e repetições</h3>
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {s.exercises.map((e, i) => (
                <li key={i} className="px-3 py-2 text-[14px]">
                  <div className="font-semibold">{e.name}</div>
                  <div className="text-[13px] text-muted">
                    {e.sets ? `${e.sets} séries` : 'séries não informadas'} · {e.reps ? `${e.reps} rep./dist.` : 'repetições não informadas'}
                    {e.load && ` · ${e.load}`}
                    {e.rest && ` · intervalo ${e.rest}`}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="section-title mt-0">Detalhes (texto original da planilha)</h3>
          <p className="whitespace-pre-line-safe rounded-xl bg-surface2 p-3 text-[14px] leading-relaxed">{s.detail || <NotInformed />}</p>
          <SourceInfo source={s.source} />
          {s.issues.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[13px] text-warn">
              {s.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>

        {related.length > 0 && (
          <details className="card">
            <summary className="cursor-pointer font-semibold">Orientações relacionadas ({related.length})</summary>
            <ul className="mt-2 space-y-2 text-[14px]">
              {related.map((g) => (
                <li key={g.id}>
                  <b>{g.title}:</b> {g.value} {g.detail && <span className="text-muted">— {g.detail}</span>}
                  <div className="text-[11px] text-muted">{g.sheet}</div>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="card space-y-3">
          <h3 className="font-bold">Registro</h3>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Status">
            {(Object.keys(STATUS_LABEL) as SessionStatus[]).map((st) => (
              <button
                key={st}
                role="radio"
                aria-checked={status === st}
                className={cx('btn-ghost min-h-[40px] px-1 text-[13px]', status === st && 'border-accent bg-accent text-accentInk')}
                onClick={() => {
                  const auto = autoSessionTime(date === todayISO(), st, log);
                  setForm((f) => ({ ...f, status: st, ...auto }));
                  void save({ status: st, ...auto });
                }}
              >
                {STATUS_ICON[st]} {STATUS_LABEL[st]}
              </button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="rpe">
              RPE (0–10): <b className="text-ink">{form.rpe ?? '—'}</b>
            </label>
            <input
              id="rpe"
              type="range"
              min={0}
              max={10}
              step={1}
              value={form.rpe ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, rpe: Number(e.target.value) }))}
              onPointerUp={() => void save({ rpe: form.rpe ?? 0 })}
              onKeyUp={() => void save({ rpe: form.rpe ?? 0 })}
              className="w-full accent-[rgb(var(--accent))]"
            />
            <div className="flex justify-between text-[11px] text-muted">
              <span>0 repouso</span>
              <span>10 máximo</span>
            </div>
            {form.rpe !== null && form.rpe !== undefined && (
              <button className="text-[12px] text-muted underline" onClick={() => (setForm((f) => ({ ...f, rpe: null })), void save({ rpe: null }))}>
                limpar RPE
              </button>
            )}
          </div>
          <div>
            <label className="label" htmlFor="when">
              Data e hora realizadas
            </label>
            <input
              id="when"
              type="datetime-local"
              className="input"
              value={form.performedAt ? toLocalInput(form.performedAt) : ''}
              onChange={(e) => setForm((f) => ({ ...f, performedAt: e.target.value ? new Date(e.target.value).toISOString() : null }))}
              onBlur={() => void save({ performedAt: form.performedAt ?? null })}
            />
          </div>
          <TextArea id="obs" label="Observações" value={form.notes ?? ''} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} onBlur={() => void save({ notes: form.notes ?? '' })} />
          <TextArea
            id="dor"
            label="Dor ou desconforto (opcional)"
            value={form.painNote ?? ''}
            onChange={(v) => setForm((f) => ({ ...f, painNote: v }))}
            onBlur={() => void save({ painNote: form.painNote ?? '' })}
          />
          {status === 'ignorado' && (
            <TextArea
              id="motivo"
              label="Motivo (opcional)"
              value={form.skipReason ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, skipReason: v }))}
              onBlur={() => void save({ skipReason: form.skipReason ?? '' })}
            />
          )}
          <p className="text-[12px] text-muted">O app não diagnostica lesões. Dor persistente: interrompa e procure avaliação profissional (regra da própria planilha).</p>
        </div>
      </div>
    </Sheet>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TextArea({ id, label, value, onChange, onBlur, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="input min-h-[72px] py-2" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
  );
}
