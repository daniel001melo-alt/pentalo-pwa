import { useState } from 'react';
import { pct } from '../domain/adherence';
import { addDaysISO, formatLong, mondayOf, monthLabel, realDateFor, todayISO } from '../domain/dates';
import { computeDay, cycleStart, type DayView, type Snapshot } from '../domain/snapshot';
import { navigate } from '../hooks';
import { cx, ModalityTag, Segmented, MOD_CLASS } from '../ui/kit';
import { ProfileBadge } from './DietScreen';

type Mode = 'combinado' | 'treinos' | 'nutricao';
type View = 'mes' | 'semana';

const PROFILE_ABBR: Record<string, string> = { intenso: 'INT', moderado: 'MOD', leve: 'LEV', recuperacao: 'REC', pre_prova: 'PRÉ', dia_prova: 'PROVA' };

function alerts(d: DayView): string[] {
  const out: string[] = [];
  if (d.pains.length) out.push(`dor ${Math.max(...d.pains.map((p) => p.intensity))}/10`);
  if (d.sessions.some((s) => s.modality === 'competicao')) out.push('competição');
  if (d.dayPlan?.crossCheck === 'divergente') out.push('perfil divergente');
  if (d.sessions.some((s) => s.issues.some((i) => /difere|inconsist/i.test(i)))) out.push('dado a validar');
  return out;
}

export function CalendarScreen({ snap }: { snap: Snapshot }) {
  const today = todayISO();
  const start = cycleStart(snap);
  const initial = start && today < realDateFor(start, snap.settings.planShiftDays) ? realDateFor(start, snap.settings.planShiftDays) : today;
  const [cursor, setCursor] = useState(initial);
  const [mode, setMode] = useState<Mode>('combinado');
  const [view, setView] = useState<View>('mes');
  const [y, m] = cursor.split('-').map(Number);

  return (
    <div className="space-y-4 pt-2">
      <h1 className="font-display text-[26px] font-extrabold">Calendário</h1>
      <Segmented<Mode>
        label="Conteúdo do calendário"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'combinado', label: 'Combinado' },
          { value: 'treinos', label: 'Treinos' },
          { value: 'nutricao', label: 'Nutrição' },
        ]}
      />
      <Segmented<View>
        label="Visão"
        value={view}
        onChange={setView}
        options={[
          { value: 'mes', label: 'Mês' },
          { value: 'semana', label: 'Semana' },
        ]}
      />
      <div className="flex items-center justify-between">
        <button
          className="btn-ghost min-h-[40px] px-3"
          aria-label="Anterior"
          onClick={() => setCursor(view === 'mes' ? `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01` : addDaysISO(cursor, -7))}
        >
          ‹
        </button>
        <p className="font-bold">{view === 'mes' ? monthLabel(y, m - 1) : `Semana de ${formatLong(mondayOf(cursor))}`}</p>
        <button
          className="btn-ghost min-h-[40px] px-3"
          aria-label="Próximo"
          onClick={() => setCursor(view === 'mes' ? `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01` : addDaysISO(cursor, 7))}
        >
          ›
        </button>
      </div>
      {view === 'mes' ? <Month snap={snap} year={y} month={m} mode={mode} today={today} /> : <Week snap={snap} monday={mondayOf(cursor)} mode={mode} today={today} />}
      <Legend />
    </div>
  );
}

function Month({ snap, year, month, mode, today }: { snap: Snapshot; year: number; month: number; mode: Mode; today: string }) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const gridStart = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDaysISO(gridStart, i));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-muted">
        {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const inMonth = Number(d.slice(5, 7)) === month;
          const v = computeDay(snap, d);
          const main = v.sessions.filter((s) => s.priority === 'principal').length;
          const opt = v.sessions.length - main;
          const al = alerts(v);
          return (
            <button
              key={d}
              onClick={() => navigate(`/hoje?d=${d}`)}
              aria-label={`${formatLong(d)}: ${main} sessões principais, ${opt} opcionais, perfil ${v.profile?.name ?? 'não informado'}${al.length ? ', alertas: ' + al.join(', ') : ''}`}
              className={cx(
                'min-h-[78px] rounded-lg border p-1 text-left align-top',
                inMonth ? 'border-line bg-surface' : 'border-transparent bg-surface2/40 opacity-60',
                d === today && 'ring-2 ring-accent',
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cx('text-[12px] font-bold', d === today && 'text-accent')}>{Number(d.slice(8))}</span>
                {al.length > 0 && (
                  <span className="text-[10px] font-black text-bad" aria-hidden>
                    !
                  </span>
                )}
              </div>
              {v.inPlan && (
                <>
                  {mode !== 'nutricao' && v.sessions.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      {v.sessions.map((s) => (
                        <span key={s.key} className={cx('h-1.5 w-1.5 rounded-full', MOD_CLASS[s.modality].dot, s.priority === 'opcional' && 'opacity-40')} aria-hidden />
                      ))}
                    </div>
                  )}
                  {mode !== 'nutricao' && v.sessions.length > 0 && (
                    <div className="text-[10px] leading-tight">
                      »{main}
                      {opt ? ` ◦${opt}` : ''}
                    </div>
                  )}
                  {mode !== 'treinos' && v.profile && (
                    <div className="mt-0.5">
                      <ProfileBadge id={v.profile.id} name={PROFILE_ABBR[v.profile.id]} />
                    </div>
                  )}
                  {d <= today && v.scores.overall !== null && <div className="text-[10px] font-semibold tabular-nums">{pct(v.scores.overall)}</div>}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Week({ snap, monday, mode, today }: { snap: Snapshot; monday: string; mode: Mode; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i));
  return (
    <div className="space-y-2">
      {days.map((d) => {
        const v = computeDay(snap, d);
        const al = alerts(v);
        const waterGoal = snap.settings.hydration.dailyMl;
        return (
          <section key={d} aria-label={formatLong(d)} className={cx('card block w-full p-3 text-left', d === today && 'border-2 border-accent')}>
            <div className="flex items-center justify-between gap-2">
              <b>{formatLong(d)}</b>
              <button className="text-[13px] font-semibold text-accent underline" onClick={() => navigate(`/hoje?d=${d}`)}>
                abrir {v.week ? `· S${v.week.number}` : ''}
              </button>
            </div>
            {mode !== 'nutricao' && (
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {v.sessions.length === 0 && <li className="text-muted">Sem sessões</li>}
                {v.sessions.map((s) => {
                  const st = snap.sessionLogs.get(s.key)?.status;
                  return (
                    <li key={s.key} className="flex items-center gap-1.5">
                      <span className="font-black">{s.marker}</span>
                      <ModalityTag modality={s.modality} small />
                      <span className={cx(s.priority === 'opcional' && 'text-muted')}>{s.type}</span>
                      {st && st !== 'nao_iniciado' && <span className="ml-auto text-[11px] font-bold">{st === 'concluido' ? '✓' : st === 'parcial' ? '◑' : st === 'ignorado' ? '⊘' : '◐'}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
              {mode !== 'treinos' && (
                <span className="flex items-center gap-1">
                  Perfil: <ProfileBadge id={v.profile?.id} name={v.profile?.name} />
                </span>
              )}
              {mode !== 'treinos' && v.counts.meals.planned > 0 && (
                <span>
                  Refeições {v.counts.meals.done}/{v.counts.meals.planned}
                </span>
              )}
              {d <= today && <span>Aderência {pct(v.scores.overall)}</span>}
              {d <= today && (
                <span>
                  Água {(v.hydrationMl / 1000).toFixed(1)} L{waterGoal ? ` / ${(waterGoal / 1000).toFixed(1)} L` : ''}
                </span>
              )}
              {d <= today && v.activeSupplements.length > 0 && (
                <span>
                  Supl. {v.counts.supplements.done}/{v.counts.supplements.planned}
                </span>
              )}
              {al.map((a) => (
                <span key={a} className="font-bold text-bad">
                  ! {a}
                </span>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <details className="card text-[13px]">
      <summary className="cursor-pointer font-semibold">Legenda</summary>
      <ul className="mt-2 space-y-1">
        <li>» número de sessões principais · ◦ número de opcionais</li>
        <li>Pontos coloridos: uma marca por sessão (opcional = mais clara); a modalidade também aparece por nome na visão semanal.</li>
        <li>INT/MOD/LEV/REC/PRÉ/PROVA = perfil nutricional (texto, além da cor).</li>
        <li>% = aderência geral do dia (só dias até hoje). “!” = alerta (dor, competição, dado a validar).</li>
        <li>✓ concluído · ◑ parcial · ⊘ ignorado · ◐ em andamento</li>
      </ul>
    </details>
  );
}
