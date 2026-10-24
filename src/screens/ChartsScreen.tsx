import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getDB } from '../db/db';
import { average } from '../domain/adherence';
import { addDaysISO, formatShort, realDateFor, temporalProgress, todayISO } from '../domain/dates';
import { computeDay, cycleDates, cycleStart, type Snapshot } from '../domain/snapshot';
import { Card, Empty, ProgressBar } from '../ui/kit';

function readColors() {
  const s = getComputedStyle(document.documentElement);
  const c = (v: string) => `rgb(${s.getPropertyValue(v).trim().split(/\s+/).join(',')})`;
  return {
    accent: c('--accent'),
    ink: c('--ink'),
    muted: c('--muted'),
    line: c('--line'),
    ok: c('--ok'),
    warn: c('--warn'),
    bad: c('--bad'),
    natacao: c('--m-natacao'),
    corrida: c('--m-corrida'),
    forca: c('--m-forca'),
    ppm: c('--m-ppm'),
  };
}

function useColors(theme: string) {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const up = () => requestAnimationFrame(() => setColors(readColors()));
    up();
    mq.addEventListener('change', up);
    return () => mq.removeEventListener('change', up);
  }, [theme]);
  return colors;
}

const pctFmt = (v: number) => `${Math.round(v)}%`;

function ChartCard({ title, note, children, empty }: { title: string; note?: string; children: ReactNode; empty?: string | false }) {
  return (
    <Card>
      <h3 className="font-bold">{title}</h3>
      {note && <p className="text-[12px] text-muted">{note}</p>}
      <div className="mt-2">{empty ? <Empty title={empty} /> : <div className="h-56 w-full">{children}</div>}</div>
    </Card>
  );
}

export default function ChartsScreen({ snap }: { snap: Snapshot }) {
  const C = useColors(snap.settings.theme);
  const today = todayISO();
  const base = useLiveQuery(async () => (await getDB().baseDiet.get('base')) ?? null, []);
  const axis = { stroke: C.muted, fontSize: 11 };
  const tip = { contentStyle: { background: 'rgb(var(--surface))', border: `1px solid ${C.line}`, borderRadius: 12, color: C.ink, fontSize: 12 } };

  const data = useMemo(() => {
    const dates = cycleDates(snap).filter((d) => d <= today);
    const days = dates.map((d) => computeDay(snap, d));
    const daily = days.map((v) => ({
      d: formatShort(v.date),
      geral: v.scores.overall === null ? null : v.scores.overall * 100,
      dieta: v.scores.diet === null ? null : v.scores.diet * 100,
    }));
    const weeks = snap.weeks.map((w) => {
      const ds = days.filter((v) => v.week?.number === w.number);
      const sessions = snap.sessions.filter((s) => s.week === w.number);
      const mealsPlanned = ds.reduce((a, v) => a + v.counts.meals.planned, 0);
      return {
        s: `S${w.number}`,
        aderencia: average(ds.map((v) => v.scores.overall)),
        planejados: sessions.filter((s) => s.priority === 'principal').length,
        concluidos: sessions.filter((s) => snap.sessionLogs.get(s.key)?.status === 'concluido').length,
        parciais: sessions.filter((s) => snap.sessionLogs.get(s.key)?.status === 'parcial').length,
        refeicoesPlanejadas: mealsPlanned,
        refeicoesRealizadas: ds.reduce((a, v) => a + v.counts.meals.done, 0),
      };
    });
    const phases = snap.phases.map((p) => ({ f: p.code, aderencia: average(days.filter((v) => v.phase?.id === p.id).map((v) => v.scores.overall)) }));
    const rpe = snap.sessions
      .map((s) => ({ s, l: snap.sessionLogs.get(s.key) }))
      .filter((x) => x.l?.rpe !== null && x.l?.rpe !== undefined)
      .map((x) => ({ d: formatShort(realDateFor(x.s.date, snap.settings.planShiftDays)), rpe: x.l!.rpe, tipo: x.s.type }));
    const last7 = Array.from({ length: 7 }, (_, i) => addDaysISO(today, i - 6)).map((d) => ({
      d: formatShort(d),
      litros: snap.hydration.filter((h) => h.date === d).reduce((a, h) => a + h.ml, 0) / 1000,
    }));
    const counts = new Map<string, number>();
    for (const dp of snap.dayPlans.values()) if (dp.profileId) counts.set(dp.profileId, (counts.get(dp.profileId) ?? 0) + 1);
    const profiles = [...snap.profiles.values()].map((p) => ({
      p: p.name.replace(' (D-1)', ''),
      dias: counts.get(p.id) ?? 0,
      kcal: p.planned.kcal,
      P: p.planned.protein,
      C: p.planned.carbs,
      G: p.planned.fat,
      estimativa: p.isEstimate,
    }));
    return { days, daily, weeks, phases, rpe, last7, profiles };
  }, [snap, today]);

  const hasLogs = data.days.some((v) => v.scores.overall !== null);
  const start = cycleStart(snap);
  const tp = start ? temporalProgress(realDateFor(start, snap.settings.planShiftDays), snap.settings.competitionDate, today) : null;
  const goal = snap.settings.hydration.dailyMl;
  const baseCmp = base
    ? [
        {
          p: 'Dieta-base',
          kcal: base.dayTotals.kcal.value,
          P: (base.dayTotals.proteinAnimal.value ?? 0) + (base.dayTotals.proteinVegetal.value ?? 0),
          C: base.dayTotals.carbs.value,
          G: base.dayTotals.fat.value,
        },
        ...data.profiles.map((p) => ({ p: p.p, kcal: p.kcal, P: p.P, C: p.C, G: p.G })),
      ]
    : [];

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">Gráficos de ingestão mostram somente valores PLANEJADOS. Nenhum gráfico estima consumo real a partir de marcações de refeição.</p>
      {tp && (
        <Card>
          <h3 className="font-bold">Progresso temporal</h3>
          <p className="text-[13px] text-muted">
            {tp.elapsed} de {tp.total} dias do ciclo ({tp.percent}%) — mede o tempo decorrido, não o treino realizado.
          </p>
          <div className="mt-2">
            <ProgressBar value={tp.percent / 100} label="Progresso temporal" />
          </div>
        </Card>
      )}
      <ChartCard title="Aderência diária" note="Geral e nutricional, por dia (0–100%)." empty={!hasLogs && 'Sem registros ainda'}>
        <ResponsiveContainer>
          <LineChart data={data.daily}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="d" tick={axis} minTickGap={16} />
            <YAxis domain={[0, 100]} tick={axis} tickFormatter={pctFmt} width={36} />
            <Tooltip {...tip} formatter={(v: number) => pctFmt(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="geral" name="Geral" stroke={C.accent} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="dieta" name="Dieta" stroke={C.natacao} strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Aderência semanal" empty={!hasLogs && 'Sem registros ainda'}>
        <ResponsiveContainer>
          <BarChart data={data.weeks.map((w) => ({ ...w, aderencia: w.aderencia === null ? null : w.aderencia * 100 }))}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="s" tick={axis} />
            <YAxis domain={[0, 100]} tick={axis} tickFormatter={pctFmt} width={36} />
            <Tooltip {...tip} formatter={(v: number) => pctFmt(v)} />
            <Bar dataKey="aderencia" name="Aderência" fill={C.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Aderência por fase" empty={!hasLogs && 'Sem registros ainda'}>
        <ResponsiveContainer>
          <BarChart data={data.phases.map((p) => ({ ...p, aderencia: p.aderencia === null ? null : p.aderencia * 100 }))}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="f" tick={axis} />
            <YAxis domain={[0, 100]} tick={axis} tickFormatter={pctFmt} width={36} />
            <Tooltip {...tip} formatter={(v: number) => pctFmt(v)} />
            <Bar dataKey="aderencia" name="Aderência" fill={C.forca} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Treinos principais: planejados × concluídos" note="Por semana. Parciais aparecem separados.">
        <ResponsiveContainer>
          <BarChart data={data.weeks}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="s" tick={axis} />
            <YAxis tick={axis} width={28} allowDecimals={false} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="planejados" name="Planejados" fill={C.line} isAnimationActive={false} />
            <Bar dataKey="concluidos" name="Concluídos" fill={C.ok} isAnimationActive={false} />
            <Bar dataKey="parciais" name="Parciais" fill={C.warn} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="RPE registrado" note="Somente sessões com RPE informado." empty={!data.rpe.length && 'Nenhum RPE registrado'}>
        <ResponsiveContainer>
          <LineChart data={data.rpe}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="d" tick={axis} minTickGap={16} />
            <YAxis domain={[0, 10]} tick={axis} width={28} />
            <Tooltip {...tip} formatter={(v: number, _n, p) => [`${v}`, (p.payload as { tipo: string }).tipo]} />
            <Line dataKey="rpe" name="RPE" stroke={C.corrida} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Hidratação — últimos 7 dias" note={goal ? `Meta: ${(goal / 1000).toFixed(1)} L` : 'Meta não definida'}>
        <ResponsiveContainer>
          <BarChart data={data.last7}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="d" tick={axis} />
            <YAxis tick={axis} width={32} unit=" L" />
            <Tooltip {...tip} formatter={(v: number) => `${v.toFixed(2)} L`} />
            {goal && <ReferenceLine y={goal / 1000} stroke={C.natacao} strokeDasharray="4 3" label={{ value: 'meta', fill: C.muted, fontSize: 11 }} />}
            <Bar dataKey="litros" name="Litros" fill={C.natacao} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Refeições planejadas × realizadas" note="Realizadas = conforme, parcial ou substituída (marcadas por você).">
        <ResponsiveContainer>
          <BarChart data={data.weeks}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="s" tick={axis} />
            <YAxis tick={axis} width={28} allowDecimals={false} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="refeicoesPlanejadas" name="Planejadas (até hoje)" fill={C.line} isAnimationActive={false} />
            <Bar dataKey="refeicoesRealizadas" name="Realizadas" fill={C.accent} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Distribuição de perfis nutricionais" note="Dias por perfil nas 18 semanas (Dieta_Calendario).">
        <ResponsiveContainer>
          <BarChart data={data.profiles} layout="vertical">
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis type="number" tick={axis} allowDecimals={false} />
            <YAxis type="category" dataKey="p" tick={axis} width={92} />
            <Tooltip {...tip} />
            <Bar dataKey="dias" name="Dias" fill={C.ppm} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Calorias planejadas por perfil" note="“Dia de prova” é estimativa da própria planilha.">
        <ResponsiveContainer>
          <BarChart data={data.profiles}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="p" tick={axis} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis tick={axis} width={40} />
            <Tooltip {...tip} />
            <Bar dataKey="kcal" name="kcal" fill={C.corrida} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Proteína, carboidrato e gordura planejados (g)">
        <ResponsiveContainer>
          <BarChart data={data.profiles}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="p" tick={axis} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis tick={axis} width={36} />
            <Tooltip {...tip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="P" name="Proteína" stackId="m" fill={C.forca} isAnimationActive={false} />
            <Bar dataKey="C" name="Carboidrato" stackId="m" fill={C.ppm} isAnimationActive={false} />
            <Bar dataKey="G" name="Gordura" stackId="m" fill={C.natacao} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Dieta-base × plano atual (kcal/dia)" empty={!base && 'Dieta-base não importada'}>
        <ResponsiveContainer>
          <BarChart data={baseCmp}>
            <CartesianGrid stroke={C.line} strokeDasharray="3 3" />
            <XAxis dataKey="p" tick={axis} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis tick={axis} width={40} />
            <Tooltip {...tip} />
            <Bar dataKey="kcal" name="kcal" fill={C.accent} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
