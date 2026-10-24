import { useEffect, useMemo, useState } from 'react';
import { average, pct } from '../domain/adherence';
import { addDaysISO, daysBetween, formatBR, formatLong, minutesOf, mondayOf, nowHHMM, PERIOD_TIME, realDateFor, temporalProgress } from '../domain/dates';
import type { Meal, TrainingSession } from '../domain/schemas';
import { computeDay, cycleStart, mealLogId, nextSession, type Snapshot } from '../domain/snapshot';
import { navigate, useNow, type Route } from '../hooks';
import { Card, fmtNum, ProgressBar, Ring, SectionTitle } from '../ui/kit';
import { MacroLine, MealCard, MealSheet } from './meal';
import { SessionCard, SessionSheet } from './session';
import { CoachNotesCard, PersonalNoteInput, SupplementsCard, WaterCard, WellnessCard } from './widgets';
import { todayISO } from '../domain/dates';

export function TodayScreen({ snap, route }: { snap: Snapshot; route: Route }) {
  const now = useNow();
  const today = todayISO(now);
  const date = route.params.get('d') ?? today;
  const day = useMemo(() => computeDay(snap, date), [snap, date]);
  const action = route.params.get('acao');
  useEffect(() => {
    // atalho do app "Registrar água"
    if (action === 'agua') document.getElementById('agua')?.scrollIntoView({ block: 'start' });
  }, [action]);
  const [openSession, setOpenSession] = useState<{ s: TrainingSession; date: string } | null>(null);
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const nowMin = minutesOf(nowHHMM(now)) ?? 0;
  const next = nextSession(snap, today, nowMin, PERIOD_TIME);
  const start = cycleStart(snap);
  const realStart = start ? realDateFor(start, snap.settings.planShiftDays) : null;
  const comp = snap.settings.competitionDate;
  const tp = realStart ? temporalProgress(realStart, comp, today) : null;
  const daysToComp = daysBetween(today, comp);

  // aderência semanal: dias passados (até hoje) da semana corrente
  const monday = mondayOf(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i)).filter((d) => d <= today);
  const weekScores = weekDays.map((d) => computeDay(snap, d).scores.overall);
  const weekAdh = average(weekScores);

  const nextMeal = date === today ? (day.meals.find((m) => (day.mealLogs.get(m.key)?.status ?? 'pendente') === 'pendente' && (minutesOf(m.time) ?? 0) >= nowMin - 30) ?? null) : null;
  const weight = snap.planMeta?.weightKg?.value ?? null;

  // metas semanais: planejado × concluído (sessões marcadas como concluídas/parciais)
  const wk = day.week;
  const weekSessions = wk ? snap.sessions.filter((s) => s.week === wk.number) : [];
  const doneOf = (sel: (s: TrainingSession) => number | null) =>
    weekSessions.reduce((a, s) => {
      const st = snap.sessionLogs.get(s.key)?.status;
      return a + (st === 'concluido' ? (sel(s) ?? 0) : 0);
    }, 0);

  const tasksDone = day.counts.sessions.done + day.counts.meals.done + day.counts.supplements.done;
  const tasksPlanned = day.counts.sessions.planned + day.counts.meals.planned + day.counts.supplements.planned;

  return (
    <div className="space-y-4 pt-2">
      <header>
        <div className="flex items-center justify-between gap-2">
          <button className="btn-ghost min-h-[40px] px-3" aria-label="Dia anterior" onClick={() => navigate(`/hoje?d=${addDaysISO(date, -1)}`)}>
            ‹
          </button>
          <div className="min-w-0 text-center">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-accent">{date === today ? 'Hoje' : date < today ? 'Dia passado' : 'Dia futuro'}</p>
            <h1 className="font-display text-[20px] font-extrabold leading-tight">{formatLong(date)}</h1>
          </div>
          <button className="btn-ghost min-h-[40px] px-3" aria-label="Próximo dia" onClick={() => navigate(`/hoje?d=${addDaysISO(date, 1)}`)}>
            ›
          </button>
        </div>
        {date !== today && (
          <div className="mt-1 text-center">
            <button className="text-[13px] font-semibold text-accent underline" onClick={() => navigate('/hoje')}>
              voltar para hoje
            </button>
          </div>
        )}
      </header>

      {/* Card de progresso (substitui o widget nativo, que um PWA não tem) */}
      <Card className="bg-gradient-to-br from-surface to-surface2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-wide text-muted">
              {day.week ? `Semana S${day.week.number} de ${snap.weeks.length}` : realStart && date < realStart ? 'Antes do ciclo' : 'Fora do ciclo'}
            </p>
            <p className="font-bold leading-snug">{day.phase ? `${day.phase.code} – ${day.phase.name}` : (day.mesocycle?.name ?? '—')}</p>
            {day.week && (
              <p className="text-[13px] text-muted">
                {day.week.microcycle} · carga {day.week.load ?? '—'}/5
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="font-display text-[30px] font-black leading-none tabular-nums">{daysToComp >= 0 ? daysToComp : 0}</p>
            <p className="text-[12px] font-semibold text-muted">{daysToComp >= 0 ? 'dias para a prova' : 'prova realizada'}</p>
            <p className="text-[11px] text-muted">{formatBR(comp)}</p>
          </div>
        </div>
        {tp && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[12px] text-muted">
              <span>Progresso temporal do ciclo</span>
              <span className="tabular-nums">
                {tp.elapsed}/{tp.total} dias · {fmtNum(tp.percent)}%
              </span>
            </div>
            <ProgressBar value={tp.percent / 100} label="Progresso temporal" />
            {realStart && today < realStart && (
              <p className="mt-1 text-[12px] text-muted">
                O ciclo começa em {daysBetween(today, realStart)} dia(s): {formatLong(realStart)}.
              </p>
            )}
          </div>
        )}
        {day.week?.objective && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[14px] font-semibold">Objetivo da semana</summary>
            <p className="mt-1 text-[14px] leading-relaxed">{day.week.objective}</p>
          </details>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-around">
          <Ring value={day.scores.overall} label="Aderência do dia" />
          <Ring value={weekAdh} label="Aderência da semana" sub={`${weekScores.filter((x) => x !== null).length} dia(s) com dados`} />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[12px]">
          {(
            [
              ['Treino', day.scores.training],
              ['Dieta', day.scores.diet],
              ['Suplem.', day.scores.supplements],
              ['Água', day.scores.hydration],
            ] as const
          ).map(([l, v]) => (
            <div key={l} className="rounded-lg bg-surface2 py-1.5">
              <div className="font-bold tabular-nums">{v === null ? 'n/a' : pct(v)}</div>
              <div className="text-muted">{l}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Tarefas concluídas hoje: <b className="text-ink">{tasksDone}</b> de {tasksPlanned}. {day.scores.formula}.
        </p>
      </Card>

      {next && (
        <>
          <SectionTitle>Próximo treino</SectionTitle>
          <SessionCard
            s={next.session}
            log={snap.sessionLogs.get(next.session.key)}
            date={next.date !== date ? next.date : undefined}
            isToday={next.date === today}
            highlight
            onOpen={() => setOpenSession({ s: next.session, date: next.date })}
          />
        </>
      )}

      <SectionTitle
        action={
          <button className="text-[13px] font-semibold text-accent" onClick={() => navigate('/treinos')}>
            ver todos
          </button>
        }
      >
        Treinos do dia ({day.sessions.length})
      </SectionTitle>
      {day.sessions.length === 0 ? (
        <Card>
          <p className="text-[14px] text-muted">Nenhuma sessão planejada para este dia. Dias sem treino não reduzem a aderência.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {day.sessions.map((s) => (
            <SessionCard key={s.key} s={s} log={snap.sessionLogs.get(s.key)} isToday={date === today} highlight={next?.session.key === s.key} onOpen={() => setOpenSession({ s, date })} />
          ))}
        </div>
      )}

      <SectionTitle
        action={
          <button className="text-[13px] font-semibold text-accent" onClick={() => navigate(`/dieta?d=${date}`)}>
            detalhes
          </button>
        }
      >
        Nutrição do dia
      </SectionTitle>
      <Card>
        {day.profile ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[12px] font-bold uppercase text-muted">Perfil do dia</p>
                <p className="text-[20px] font-extrabold">{day.profile.name}</p>
              </div>
              {day.profile.isEstimate && <span className="chip border-warn text-warn">≈ estimativa da planilha</span>}
            </div>
            <MacroLine p={day.profile.planned.protein} c={day.profile.planned.carbs} g={day.profile.planned.fat} kcal={day.profile.planned.kcal} />
            <p className="text-[12px] text-muted">
              Por kg (planilha): P {fmtNum(day.profile.perKg.protein, 2)} · C {fmtNum(day.profile.perKg.carbs, 2)} · G {fmtNum(day.profile.perKg.fat, 2)} g/kg
              {weight ? ` · peso de referência ${weight} kg` : ''}
            </p>
            <p className="mt-1 text-[13px]">
              Refeições: <b>{day.counts.meals.done}</b> de {day.counts.meals.planned} registradas como realizadas
            </p>
            {!day.profile.hasMeals && <p className="mt-2 rounded-lg bg-warn/10 p-2 text-[13px] text-warn">A planilha não traz refeições para este perfil. Use as orientações de timing (aba Dieta).</p>}
          </>
        ) : (
          <p className="text-[14px] text-muted">Perfil nutricional não informado para este dia.</p>
        )}
      </Card>
      {nextMeal && (
        <>
          <SectionTitle>Próxima refeição</SectionTitle>
          <MealCard meal={nextMeal} log={day.mealLogs.get(nextMeal.key)} dayKey={day.planDate} isToday={date === today} next onOpen={() => setOpenMeal(nextMeal)} />
        </>
      )}
      {day.meals.length > 0 && (
        <details className="space-y-2" open={date !== today || !nextMeal}>
          <summary className="cursor-pointer px-1 text-[14px] font-semibold">Todas as refeições do dia ({day.meals.length})</summary>
          <div className="mt-2 space-y-2">
            {day.meals.map((m) => (
              <MealCard key={m.key} meal={m} log={day.mealLogs.get(m.key)} dayKey={day.planDate} isToday={date === today} onOpen={() => setOpenMeal(m)} />
            ))}
          </div>
        </details>
      )}

      <div id="agua" className="scroll-mt-4">
        <WaterCard day={day} snap={snap} />
      </div>
      <SupplementsCard day={day} snap={snap} />
      <WellnessCard day={day} />
      <CoachNotesCard day={day} snap={snap} />

      {wk && (
        <>
          <SectionTitle>Metas da semana S{wk.number}</SectionTitle>
          <Card>
            <ul className="space-y-3 text-[14px]">
              <Goal label="Corrida" done={doneOf((s) => s.runKm)} planned={wk.planned.runKm} unit="km" />
              <Goal label="Natação" done={doneOf((s) => s.swimM)} planned={wk.planned.swimM} unit="m" />
              <Goal label="Lançamentos de granada" done={doneOf((s) => s.throws)} planned={wk.planned.throws} unit="" />
              <Goal
                label="Sessões principais concluídas"
                done={weekSessions.filter((s) => s.priority === 'principal' && snap.sessionLogs.get(s.key)?.status === 'concluido').length}
                planned={weekSessions.filter((s) => s.priority === 'principal').length}
                unit=""
              />
            </ul>
            <p className="mt-2 text-[12px] text-muted">Planejado = Visão Geral da planilha. Concluído = soma das sessões marcadas como concluídas (parciais não somam volume).</p>
          </Card>
        </>
      )}

      <SectionTitle>Nota pessoal</SectionTitle>
      <PersonalNoteInput date={date} />

      <SessionSheet s={openSession?.s ?? null} date={openSession?.date} snap={snap} onClose={() => setOpenSession(null)} />
      <MealSheet
        meal={openMeal}
        items={openMeal ? (snap.itemsByMeal.get(openMeal.key) ?? []) : []}
        log={openMeal ? snap.mealLogs.get(mealLogId(day.planDate, openMeal.key)) : undefined}
        dayKey={day.planDate}
        profileName={day.profile?.name ?? ''}
        isToday={date === today}
        onClose={() => setOpenMeal(null)}
      />
      <p className="pb-2 text-center text-[11px] text-muted">Kcal/macros exibidos são planejados. Ingestão real não é estimada a partir de marcações.</p>
    </div>
  );
}

function Goal({ label, done, planned, unit }: { label: string; done: number; planned: number | null; unit: string }) {
  return (
    <li>
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums">
          <b>{fmtNum(done)}</b> / {planned === null ? '—' : fmtNum(planned)} {unit}
        </span>
      </div>
      <ProgressBar value={planned ? done / planned : null} label={label} />
    </li>
  );
}
