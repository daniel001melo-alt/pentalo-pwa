import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { getDB } from '../db/db';
import { pct } from '../domain/adherence';
import { addDaysISO, formatLong, formatShort, PERIOD_TIME, realDateFor, todayISO } from '../domain/dates';
import { scaleFood } from '../domain/nutrition';
import { FOOD_CATEGORY_LABEL, type BaseDiet, type DietProfile, type Food, type FoodCategory, type Meal, type SourcedNumber, type ValidationStatus } from '../domain/schemas';
import { computeDay, mealLogId, type Snapshot } from '../domain/snapshot';
import { navigate, type Route } from '../hooks';
import { similarityKey } from '../import/normalize';
import { Card, cx, Empty, fmtNum, ModalityTag, Segmented, SourceInfo, StatusBadge } from '../ui/kit';
import { MacroLine, MealCard, MealSheet } from './meal';

type Tab = 'hoje' | 'calendario' | 'base' | 'alimentos';

export function DietScreen({ snap, route }: { snap: Snapshot; route: Route }) {
  const [tab, setTab] = useState<Tab>((route.params.get('tab') as Tab) || 'hoje');
  return (
    <div className="space-y-4 pt-2">
      <h1 className="font-display text-[26px] font-extrabold">Dieta</h1>
      <Segmented<Tab>
        label="Visualização da dieta"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'hoje', label: 'Do dia' },
          { value: 'calendario', label: 'Calendário' },
          { value: 'base', label: 'Dieta-base' },
          { value: 'alimentos', label: 'Alimentos' },
        ]}
      />
      {tab === 'hoje' && <DietDay snap={snap} date={route.params.get('d') ?? todayISO()} />}
      {tab === 'calendario' && <DietCalendar snap={snap} />}
      {tab === 'base' && <BaseDietView snap={snap} />}
      {tab === 'alimentos' && <FoodsView />}
    </div>
  );
}

const PROFILE_ABBR: Record<string, string> = { intenso: 'INT', moderado: 'MOD', leve: 'LEV', recuperacao: 'REC', pre_prova: 'PRÉ', dia_prova: 'PROVA' };
const PROFILE_TONE: Record<string, string> = {
  intenso: 'bg-m-corrida/15 text-m-corrida',
  moderado: 'bg-m-ppm/15 text-m-ppm',
  leve: 'bg-m-mobilidade/15 text-m-mobilidade',
  recuperacao: 'bg-m-natacao/15 text-m-natacao',
  pre_prova: 'bg-m-forca/15 text-m-forca',
  dia_prova: 'bg-m-competicao/20 text-m-competicao',
};

export function ProfileBadge({ id, name }: { id: string | null | undefined; name?: string | null }) {
  if (!id) return <span className="text-[12px] italic text-muted">não informado</span>;
  return <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-bold', PROFILE_TONE[id])}>{name ?? PROFILE_ABBR[id]}</span>;
}

function DietDay({ snap, date }: { snap: Snapshot; date: string }) {
  const day = computeDay(snap, date);
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const guidelines = useLiveQuery(() => getDB().guidelines.where('sheet').equals('Dieta_Timing').toArray(), []) ?? [];
  const p = day.profile;
  // linha do tempo: refeições + sessões (horário aproximado do período, premissa da planilha)
  const timeline = [
    ...day.meals.map((m) => ({ t: m.time ?? '99:99', kind: 'meal' as const, m })),
    ...day.sessions.map((s) => ({ t: PERIOD_TIME[s.period] ?? '99:99', kind: 'session' as const, s })),
  ].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.kind === 'session' ? -1 : 1));
  const sections = new Map<string, typeof guidelines>();
  for (const g of guidelines) sections.set(g.section, [...(sections.get(g.section) ?? []), g]);
  const relevant = (sec: string) =>
    (p?.id === 'dia_prova' && /dia de prova/i.test(sec)) || (p?.id === 'pre_prova' && /pr[eé]-competi/i.test(sec)) || /pr[eé]-treino|p[oó]s-treino|intra|hidrata/i.test(sec);
  const weight = snap.planMeta?.weightKg?.value ?? null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button className="btn-ghost min-h-[40px] px-3" aria-label="Dia anterior" onClick={() => navigate(`/dieta?d=${addDaysISO(date, -1)}`)}>
          ‹
        </button>
        <p className="text-center font-bold">{formatLong(date)}</p>
        <button className="btn-ghost min-h-[40px] px-3" aria-label="Próximo dia" onClick={() => navigate(`/dieta?d=${addDaysISO(date, 1)}`)}>
          ›
        </button>
      </div>
      {!p ? (
        <Empty title="Perfil nutricional não informado para este dia" />
      ) : (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-bold uppercase text-muted">Perfil associado à carga do dia</p>
              <p className="text-[22px] font-extrabold">{p.name}</p>
            </div>
            <ProfileBadge id={p.id} />
          </div>
          <p className="mt-1 text-[13px] text-muted">{p.whenToUse}</p>
          <div className="mt-2 grid grid-cols-4 gap-1 text-center">
            {(
              [
                ['kcal', p.planned.kcal, 0],
                ['Prot g', p.planned.protein, 1],
                ['Carb g', p.planned.carbs, 1],
                ['Gord g', p.planned.fat, 1],
              ] as const
            ).map(([l, v, d]) => (
              <div key={l} className="rounded-lg bg-surface2 py-2">
                <div className="font-bold tabular-nums">{fmtNum(v, d)}</div>
                <div className="text-[11px] text-muted">{l}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">
            g/kg informados no plano: P {fmtNum(p.perKg.protein, 2)} · C {fmtNum(p.perKg.carbs, 2)} · G {fmtNum(p.perKg.fat, 2)}
            {weight ? ` (peso ${weight} kg, Dieta_Resumo)` : ''}. Dieta: {day.counts.meals.done}/{day.counts.meals.planned} refeições · aderência {pct(day.scores.diet)}.
          </p>
          {p.isEstimate && <p className="mt-1 text-[12px] text-warn">≈ Totais marcados como estimativa na planilha.</p>}
          <SourceInfo source={p.source} />
        </Card>
      )}
      {p && !p.hasMeals && <Card className="border-warn/50 text-[14px]">A planilha não define refeições para “{p.name}”. Abaixo, as orientações de timing do próprio plano.</Card>}

      {timeline.length > 0 && (
        <div className="space-y-2">
          {timeline.map((x) =>
            x.kind === 'meal' ? (
              <MealCard key={x.m.key} meal={x.m} log={day.mealLogs.get(x.m.key)} dayKey={day.planDate} isToday={date === todayISO()} onOpen={() => setOpenMeal(x.m)} />
            ) : (
              <div key={x.s.key} className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-[13px]">
                <span className="tabular-nums text-muted">≈{x.t}</span>
                <ModalityTag modality={x.s.modality} small />
                <span className="font-semibold">
                  {x.s.marker} {x.s.type}
                </span>
                <span className="ml-auto text-muted">{x.s.period}</span>
              </div>
            ),
          )}
        </div>
      )}
      {day.meals.length > 0 && (
        <Card>
          <h3 className="font-bold">Total diário planejado</h3>
          <MacroLine
            p={day.meals.reduce((a, m) => a + (m.totals.protein ?? 0), 0)}
            c={day.meals.reduce((a, m) => a + (m.totals.carbs ?? 0), 0)}
            g={day.meals.reduce((a, m) => a + (m.totals.fat ?? 0), 0)}
            kcal={day.meals.reduce((a, m) => a + (m.totals.kcal ?? 0), 0)}
          />
          <p className="mt-1 text-[11px] text-muted">Horário das sessões ≈ premissa da planilha (AM ≈06:00, PM ≈16:00). Ajuste registrando o horário real.</p>
        </Card>
      )}

      <h2 className="section-title">Orientações da planilha (Dieta_Timing)</h2>
      {[...sections].map(([sec, items]) => (
        <details key={sec} className="card" open={relevant(sec) && (p?.id === 'dia_prova' || p?.id === 'pre_prova')}>
          <summary className="cursor-pointer font-semibold">{sec}</summary>
          <ul className="mt-2 space-y-2 text-[14px]">
            {items.map((g) => (
              <li key={g.id}>
                {g.title && <b>{g.title}: </b>}
                {g.value}
                {g.detail && <div className="text-[13px] text-muted">{g.detail}</div>}
              </li>
            ))}
          </ul>
        </details>
      ))}
      <MealSheet
        meal={openMeal}
        items={openMeal ? (snap.itemsByMeal.get(openMeal.key) ?? []) : []}
        log={openMeal ? snap.mealLogs.get(mealLogId(day.planDate, openMeal.key)) : undefined}
        dayKey={day.planDate}
        profileName={p?.name ?? ''}
        isToday={date === todayISO()}
        onClose={() => setOpenMeal(null)}
      />
    </div>
  );
}

function DietCalendar({ snap }: { snap: Snapshot }) {
  const today = todayISO();
  const shift = snap.settings.planShiftDays;
  const counts = new Map<string, number>();
  for (const d of snap.dayPlans.values()) if (d.profileId) counts.set(d.profileId, (counts.get(d.profileId) ?? 0) + 1);
  return (
    <div className="space-y-3">
      <Card>
        <h3 className="font-bold">Legenda (texto + cor)</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {[...snap.profiles.values()].map((p) => (
            <span key={p.id} className="flex items-center gap-1 text-[13px]">
              <ProfileBadge id={p.id} /> {p.name} · {fmtNum(p.planned.kcal, 0)} kcal · {counts.get(p.id) ?? 0} dias
            </span>
          ))}
        </div>
      </Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-1 text-center text-[12px]">
          <thead>
            <tr className="text-muted">
              <th className="text-left">Sem</th>
              {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((d) => (
                <th key={d}>{d}</th>
              ))}
              <th>kcal/dia</th>
            </tr>
          </thead>
          <tbody>
            {snap.weeks.map((w) => {
              const days = Array.from({ length: 7 }, (_, i) => addDaysISO(w.startDate, i));
              const kcals = days.map((d) => snap.profiles.get(snap.dayPlans.get(d)?.profileId ?? '')?.planned.kcal ?? 0);
              return (
                <tr key={w.number}>
                  <td className="text-left font-bold">S{w.number}</td>
                  {days.map((d) => {
                    const dp = snap.dayPlans.get(d);
                    const real = realDateFor(d, shift);
                    const v = computeDay(snap, real);
                    return (
                      <td key={d}>
                        <button
                          className={cx('w-full rounded-lg border border-line px-0.5 py-1', real === today && 'ring-2 ring-accent')}
                          onClick={() => navigate(`/dieta?d=${real}`)}
                          aria-label={`${formatLong(real)}: perfil ${dp?.profileName ?? 'não informado'}`}
                        >
                          <div className="text-[10px] text-muted">{formatShort(real)}</div>
                          <ProfileBadge id={dp?.profileId} name={PROFILE_ABBR[dp?.profileId ?? '']} />
                          {real <= today && v.counts.meals.planned > 0 && (
                            <div className="text-[10px] tabular-nums">
                              {v.counts.meals.done}/{v.counts.meals.planned}
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="tabular-nums">{fmtNum(kcals.reduce((a, b) => a + b, 0) / 7, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted">Perfil do dia: Dieta_Calendario, conferido com a linha “DIETA:” da Planilha Semanal. Números “x/y” = refeições registradas como realizadas.</p>
    </div>
  );
}

function BaseDietView({ snap }: { snap: Snapshot }) {
  const bd = useLiveQuery(async () => (await getDB().baseDiet.get('base')) ?? null, []);
  const profiles = [...snap.profiles.values()];
  if (bd === undefined) return <p className="text-muted">Carregando…</p>;
  if (bd === null) return <Empty title="Dieta-base não importada">Importe o arquivo .xls em Mais › Importação.</Empty>;
  return <BaseDietContent bd={bd} profiles={profiles} />;
}

function BaseDietContent({ bd, profiles }: { bd: BaseDiet; profiles: DietProfile[] }) {
  const a = bd.athlete;
  const t = bd.dayTotals;
  const prot = (t.proteinAnimal.value ?? 0) + (t.proteinVegetal.value ?? 0);
  return (
    <div className="space-y-3">
      <Card className="border-m-natacao/40">
        <p className="text-[13px]">
          <b>Referência histórica.</b> A dieta-base não é usada no lugar do plano atual. Valores exibidos exatamente como no arquivo, com a origem de cada um.
        </p>
      </Card>
      <Card>
        <h3 className="font-bold">Dados físicos usados no arquivo (aba TMB)</h3>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-[14px]">
          <SN label="Peso" v={a.weightKg} unit="kg" />
          <SN label="Altura" v={a.heightCm} unit="cm" />
          <SN label="Idade" v={a.ageYears} unit="anos" />
          <SN label="Fator de atividade (original)" v={a.activityFactor} unit="" />
          <SN label="Gasto calórico calculado no arquivo" v={a.dailyExpenditureKcal} unit="kcal" digits={1} />
        </dl>
        {a.expenditureFormula && <p className="mt-2 text-[12px] text-muted">Fórmula do arquivo: ={a.expenditureFormula} (Harris-Benedict × FA)</p>}
        {a.notes.length > 0 && (
          <details className="mt-2 text-[13px]">
            <summary className="cursor-pointer font-semibold">Notas do arquivo</summary>
            {a.notes.map((n, i) => (
              <p key={i} className="mt-1 text-muted">
                {n}
              </p>
            ))}
          </details>
        )}
      </Card>

      <h2 className="section-title">Refeições originais</h2>
      {bd.meals.map((m) => (
        <Card key={m.number} className={cx(m.isEmpty && 'border-dashed')}>
          <div className="flex items-center justify-between">
            <h3 className="font-bold">{m.title}</h3>
            {m.isEmpty ? (
              <span className="chip text-muted">vazia no arquivo</span>
            ) : (
              <span className="text-[13px] font-semibold tabular-nums">{fmtNum(m.totalsReported.kcal.value, 1)} kcal (arquivo)</span>
            )}
          </div>
          {!m.isEmpty && (
            <>
              <ul className="mt-2 divide-y divide-line text-[14px]">
                {m.items.map((f) => (
                  <li key={f.id} className="py-1.5">
                    <div className="flex justify-between gap-2">
                      <span>
                        <b>{String(f.baseMeasure.original ?? '').trim()}</b> {f.originalName}
                      </span>
                      <StatusBadge status={f.status} />
                    </div>
                    <div className="text-[12px] tabular-nums text-muted">
                      Ptn A {raw(f.proteinAnimal?.original)} · Ptn V {raw(f.proteinVegetal?.original)} · Carb {raw(f.carbs.original)} · Gord {raw(f.fat.original)} · kcal (4/4/9, conferência){' '}
                      {fmtNum(f.kcalCalculated, 1)}
                    </div>
                    {f.issues.length > 0 && <div className="text-[12px] text-warn">{f.issues.join(' ')}</div>}
                  </li>
                ))}
              </ul>
              <div className="mt-2 rounded-lg bg-surface2 p-2 text-[12px] tabular-nums">
                Totais do arquivo: Ptn A {fmtNum(m.totalsReported.proteinAnimal.value)} · Ptn V {fmtNum(m.totalsReported.proteinVegetal.value)} · Carb {fmtNum(m.totalsReported.carbs.value)} · Gord{' '}
                {fmtNum(m.totalsReported.fat.value)} · {fmtNum(m.totalsReported.kcal.value)} kcal
                <br />
                Soma conferida: P {fmtNum(m.totalsComputed.protein)} · C {fmtNum(m.totalsComputed.carbs)} · G {fmtNum(m.totalsComputed.fat)} · {fmtNum(m.totalsComputed.kcal)} kcal
              </div>
            </>
          )}
          <SourceInfo source={m.source} />
        </Card>
      ))}

      <Card>
        <h3 className="font-bold">Totais originais do dia</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-[14px]">
          <SN label="Proteína animal" v={t.proteinAnimal} unit="g" />
          <SN label="Proteína vegetal" v={t.proteinVegetal} unit="g" />
          <SN label="Carboidrato" v={t.carbs} unit="g" />
          <SN label="Gordura" v={t.fat} unit="g" />
          <SN label="Total" v={t.kcal} unit="kcal" />
          <SN label="Excedente (total − gasto)" v={t.surplus} unit="kcal" />
        </dl>
        <p className="mt-2 text-[12px] text-muted">
          % das kcal (arquivo): Ptn A {fmtNum(t.percent.proteinAnimal)} · Ptn V {fmtNum(t.percent.proteinVegetal)} · Carb {fmtNum(t.percent.carbs)} · Gord {fmtNum(t.percent.fat)} — g/kg: Ptn A{' '}
          {fmtNum(t.perKg.proteinAnimal, 2)} · Carb {fmtNum(t.perKg.carbs, 2)} · Gord {fmtNum(t.perKg.fat, 2)}
        </p>
      </Card>

      <Card>
        <h3 className="font-bold">Comparação com o plano atual</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1">Origem</th>
                <th className="text-right">kcal</th>
                <th className="text-right">P</th>
                <th className="text-right">C</th>
                <th className="text-right">G</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line font-semibold">
                <td className="py-1">Dieta-base (histórico)</td>
                <td className="text-right">{fmtNum(t.kcal.value, 0)}</td>
                <td className="text-right">{fmtNum(prot)}</td>
                <td className="text-right">{fmtNum(t.carbs.value)}</td>
                <td className="text-right">{fmtNum(t.fat.value)}</td>
              </tr>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1">
                    Plano · {p.name}
                    {p.isEstimate ? ' (≈)' : ''}
                  </td>
                  <td className="text-right">{fmtNum(p.planned.kcal, 0)}</td>
                  <td className="text-right">{fmtNum(p.planned.protein)}</td>
                  <td className="text-right">{fmtNum(p.planned.carbs)}</td>
                  <td className="text-right">{fmtNum(p.planned.fat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="font-bold">Medidas corporais (aba MEDIDAS)</h3>
        {bd.measurements.isEmpty ? (
          <p className="mt-1 text-[14px] text-muted">
            Campos presentes e vazios no arquivo: {bd.measurements.labels.join(', ')} × {bd.measurements.dates.length} colunas de data.
          </p>
        ) : (
          <ul className="mt-1 text-[14px]">
            {bd.measurements.labels.map((l, i) => (
              <li key={l}>
                {l}: {bd.measurements.values[i].map((v) => fmtNum(v)).join(' · ')}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function raw(v: unknown) {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function SN({ label, v, unit, digits = 1 }: { label: string; v: SourcedNumber; unit: string; digits?: number }) {
  return (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="font-semibold">
        {v.value === null ? <span className="italic text-muted">Não informado</span> : `${fmtNum(v.value, digits)} ${unit}`}
        {v.cell && <span className="ml-1 text-[11px] font-normal text-muted">({v.cell})</span>}
      </dd>
    </div>
  );
}

// ───────────────────────── Base de alimentos ─────────────────────────

type Dominant = '' | 'protein' | 'carbs' | 'fat';

function dominant(f: Food): Dominant {
  const p = (f.protein.value ?? 0) * 4;
  const c = (f.carbs.value ?? 0) * 4;
  const g = (f.fat.value ?? 0) * 9;
  const max = Math.max(p, c, g);
  if (max === 0) return '';
  return max === p ? 'protein' : max === c ? 'carbs' : 'fat';
}

function FoodsView() {
  const foodsQ = useLiveQuery(() => getDB().foods.toArray(), []);
  const foods = useMemo(() => foodsQ ?? [], [foodsQ]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'' | FoodCategory>('');
  const [dom, setDom] = useState<Dominant>('');
  const [unit, setUnit] = useState('');
  const [origin, setOrigin] = useState<'' | 'plan' | 'baseDiet'>('');
  const [status, setStatus] = useState<'' | ValidationStatus>('');
  const [open, setOpen] = useState<string | null>(null);
  const units = [...new Set(foods.map((f) => f.unit || '(sem unidade)'))];
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return foods
      .filter((f) => !n || f.originalName.toLowerCase().includes(n) || f.normalizedName.includes(n))
      .filter((f) => !cat || f.category === cat)
      .filter((f) => !dom || dominant(f) === dom)
      .filter((f) => !unit || (f.unit || '(sem unidade)') === unit)
      .filter((f) => !origin || f.origin === origin)
      .filter((f) => !status || f.status === status)
      .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName) || (a.baseMeasure.value ?? 0) - (b.baseMeasure.value ?? 0));
  }, [foods, q, cat, dom, unit, origin, status]);
  return (
    <div className="space-y-3">
      <input className="input" type="search" placeholder="Buscar alimento…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar alimento" />
      <details className="card">
        <summary className="cursor-pointer font-semibold">Filtros</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label>
            <span className="label">Categoria</span>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value as FoodCategory | '')}>
              <option value="">Todas</option>
              {Object.entries(FOOD_CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Macro predominante</span>
            <select className="input" value={dom} onChange={(e) => setDom(e.target.value as Dominant)}>
              <option value="">Todos</option>
              <option value="protein">Proteína</option>
              <option value="carbs">Carboidrato</option>
              <option value="fat">Gordura</option>
            </select>
          </label>
          <label>
            <span className="label">Unidade</span>
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">Todas</option>
              {units.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Fonte</span>
            <select className="input" value={origin} onChange={(e) => setOrigin(e.target.value as '' | 'plan' | 'baseDiet')}>
              <option value="">Ambas</option>
              <option value="plan">Plano atual (Base_Alimentos)</option>
              <option value="baseDiet">Dieta-base (.xls)</option>
            </select>
          </label>
          <label className="col-span-2">
            <span className="label">Status de validação</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ValidationStatus | '')}>
              <option value="">Todos</option>
              <option value="ok">Conferido</option>
              <option value="requer_validacao">Requer validação</option>
              <option value="inconsistente">Dado inconsistente</option>
              <option value="nao_informado">Não informado</option>
              <option value="estimativa">Estimativa</option>
            </select>
          </label>
        </div>
      </details>
      <p className="text-[13px] text-muted">{list.length} porção(ões). Toque para ver origem, porções equivalentes e consultar outra quantidade.</p>
      <ul className="space-y-2">
        {list.map((f) => (
          <li key={f.id}>
            <FoodRow f={f} all={foods} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FoodRow({ f, all, open, onToggle }: { f: Food; all: Food[]; open: boolean; onToggle: () => void }) {
  const [qty, setQty] = useState('');
  const key = similarityKey(f.originalName);
  const others = open ? all.filter((x) => x.id !== f.id && similarityKey(x.originalName) === key) : [];
  const serving = qty ? scaleFood(f, Number(qty.replace(',', '.'))) : null;
  return (
    <div className="card p-3">
      <button className="block w-full text-left" onClick={onToggle} aria-expanded={open}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <b>{f.originalName}</b>{' '}
            <span className="text-muted">
              {String(f.baseMeasure.original ?? '').trim()}
              {f.unit && !String(f.baseMeasure.original ?? '').includes(f.unit) ? ` ${f.unit}` : ''}
            </span>
            <div className="text-[12px] text-muted">
              {FOOD_CATEGORY_LABEL[f.category]} · {f.origin === 'plan' ? 'Plano' : 'Dieta-base'}
              {f.duplicateGroup && ' · possível duplicata'}
            </div>
          </div>
          <StatusBadge status={f.status} />
        </div>
        <div className="mt-1 text-[13px] tabular-nums">
          P {fmtNum(f.protein.value)} · C {fmtNum(f.carbs.value)} · G {fmtNum(f.fat.value)} · kcal{' '}
          {f.kcalReported?.value != null ? `${fmtNum(f.kcalReported.value)} (informada)` : `${fmtNum(f.kcalCalculated)} (calculada 4/4/9)`}
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 text-[13px]">
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-muted">Nome original / normalizado</dt>
              <dd>
                “{f.originalName}” / {f.normalizedName}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Medida-base / unidade</dt>
              <dd>
                {String(f.baseMeasure.original ?? '—')} → {fmtNum(f.baseMeasure.value)} {f.unit || 'sem unidade'}
              </dd>
            </div>
            {f.proteinAnimal && (
              <div>
                <dt className="text-muted">Proteína animal / vegetal (original)</dt>
                <dd>
                  {raw(f.proteinAnimal.original)} / {raw(f.proteinVegetal?.original)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted">Carb / Gord (original → normalizado)</dt>
              <dd>
                {raw(f.carbs.original)} → {fmtNum(f.carbs.value)} · {raw(f.fat.original)} → {fmtNum(f.fat.value)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Kcal informada / calculada / diferença</dt>
              <dd>
                {fmtNum(f.kcalReported?.value ?? null)} / {fmtNum(f.kcalCalculated)} / {fmtNum(f.kcalDifference)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Fonte / observação</dt>
              <dd>{f.sourceNote ?? '—'}</dd>
            </div>
          </dl>
          {f.note && <p className="text-muted">Nota: {f.note}</p>}
          {f.issues.length > 0 && (
            <ul className="list-disc pl-5 text-warn">
              {f.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          <SourceInfo source={f.source} />
          <div>
            <label className="label" htmlFor={`q-${f.id}`}>
              Consultar outra quantidade ({f.unit || '—'}) — proporcional, só para consulta
            </label>
            <input id={`q-${f.id}`} className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={String(f.baseMeasure.value ?? '')} />
            {serving && (
              <p className="mt-1 tabular-nums">
                {serving.quantity} {serving.unit}: P {fmtNum(serving.macros.protein)} · C {fmtNum(serving.macros.carbs)} · G {fmtNum(serving.macros.fat)} · {fmtNum(serving.macros.kcal, 0)} kcal
                (derivado)
              </p>
            )}
          </div>
          {others.length > 0 && (
            <div>
              <p className="font-semibold">Outras porções / registros do mesmo alimento ({others.length})</p>
              <ul className="mt-1 space-y-1">
                {others.map((o) => (
                  <li key={o.id} className="rounded-lg bg-surface2 p-2 tabular-nums">
                    {String(o.baseMeasure.original ?? '').trim()} {o.originalName} · P {fmtNum(o.protein.value)} C {fmtNum(o.carbs.value)} G {fmtNum(o.fat.value)} · {FOOD_CATEGORY_LABEL[o.category]} (
                    {o.origin === 'plan' ? 'plano' : o.source.cell})
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted">Registros semelhantes não são unidos automaticamente.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
