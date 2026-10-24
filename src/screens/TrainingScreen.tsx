import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { getDB } from '../db/db';
import { formatLong, minutesOf, nowHHMM, PERIOD_TIME, realDateFor, todayISO } from '../domain/dates';
import type { Modality, SessionStatus, TrainingSession } from '../domain/schemas';
import { nextSession, type Snapshot } from '../domain/snapshot';
import type { Route } from '../hooks';
import { INTENSITY_LABEL, MODALITY_LABEL } from '../import/sessionText';
import { Card, cx, Empty, Segmented, SourceInfo } from '../ui/kit';
import { SessionCard, SessionSheet, STATUS_LABEL } from './session';

type Tab = 'sessoes' | 'progressoes' | 'zonas';

function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function TrainingScreen({ snap, route }: { snap: Snapshot; route: Route }) {
  const [tab, setTab] = useState<Tab>((route.params.get('tab') as Tab) || 'sessoes');
  return (
    <div className="space-y-4 pt-2">
      <h1 className="font-display text-[26px] font-extrabold">Treinos</h1>
      <Segmented<Tab>
        label="Seção de treinos"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'sessoes', label: 'Sessões' },
          { value: 'progressoes', label: 'Progressões' },
          { value: 'zonas', label: 'Zonas e paces' },
        ]}
      />
      {tab === 'sessoes' && <SessionsList snap={snap} />}
      {tab === 'progressoes' && <Progressions />}
      {tab === 'zonas' && <Zones />}
    </div>
  );
}

function SessionsList({ snap }: { snap: Snapshot }) {
  const today = todayISO();
  const shift = snap.settings.planShiftDays;
  const [q, setQ] = useState('');
  const [date, setDate] = useState('');
  const [week, setWeek] = useState('');
  const [phase, setPhase] = useState('');
  const [mods, setMods] = useState<Modality[]>([]);
  const [intensity, setIntensity] = useState('');
  const [status, setStatus] = useState<'' | SessionStatus>('');
  const [prio, setPrio] = useState<'todas' | 'principal' | 'opcional'>('todas');
  const [onlyUpcoming, setOnlyUpcoming] = useState(true);
  const [open, setOpen] = useState<TrainingSession | null>(null);
  const next = nextSession(snap, today, minutesOf(nowHHMM()) ?? 0, PERIOD_TIME);

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    const phaseWeeks = phase ? (snap.phases.find((p) => p.id === phase)?.weeks ?? []) : null;
    return snap.sessions.filter((s) => {
      const real = realDateFor(s.date, shift);
      if (onlyUpcoming && !date && !week && real < today) return false;
      if (date && real !== date) return false;
      if (week && s.week !== Number(week)) return false;
      if (phaseWeeks && !phaseWeeks.includes(s.week)) return false;
      if (mods.length && !mods.includes(s.modality)) return false;
      if (intensity && s.intensityLevel !== intensity) return false;
      if (prio !== 'todas' && s.priority !== prio) return false;
      const st = snap.sessionLogs.get(s.key)?.status ?? 'nao_iniciado';
      if (status && st !== status) return false;
      if (nq) {
        const hay = norm(
          `${s.type} ${s.detail} ${s.intensityText ?? ''} ${MODALITY_LABEL[s.modality]} ${snap.weeks.find((w) => w.number === s.week)?.objective ?? ''} ${s.exercises.map((e) => e.name).join(' ')}`,
        );
        if (!nq.split(/\s+/).every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [snap, q, date, week, phase, mods, intensity, status, prio, onlyUpcoming, shift, today]);

  const byDate = new Map<string, TrainingSession[]>();
  for (const s of filtered) {
    const real = realDateFor(s.date, shift);
    byDate.set(real, [...(byDate.get(real) ?? []), s]);
  }
  const modalities = [...new Set(snap.sessions.map((s) => s.modality))];
  const clear = () => {
    setQ('');
    setDate('');
    setWeek('');
    setPhase('');
    setMods([]);
    setIntensity('');
    setStatus('');
    setPrio('todas');
  };

  return (
    <div className="space-y-3">
      <input className="input" type="search" placeholder="Buscar exercício, modalidade, sessão, objetivo, detalhe…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar treinos" />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {modalities.map((m) => (
          <button
            key={m}
            className={cx('chip shrink-0', mods.includes(m) && 'border-accent bg-accent text-accentInk')}
            aria-pressed={mods.includes(m)}
            onClick={() => setMods((x) => (x.includes(m) ? x.filter((y) => y !== m) : [...x, m]))}
          >
            {MODALITY_LABEL[m]}
          </button>
        ))}
      </div>
      <details className="card">
        <summary className="cursor-pointer font-semibold">Filtros</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="col-span-2">
            <span className="label">Data</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            <span className="label">Semana</span>
            <select className="input" value={week} onChange={(e) => setWeek(e.target.value)}>
              <option value="">Todas</option>
              {snap.weeks.map((w) => (
                <option key={w.number} value={w.number}>
                  S{w.number} · {w.microcycle}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Fase</span>
            <select className="input" value={phase} onChange={(e) => setPhase(e.target.value)}>
              <option value="">Todas</option>
              {snap.phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} – {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Intensidade (derivada)</span>
            <select className="input" value={intensity} onChange={(e) => setIntensity(e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(INTENSITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Status</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as SessionStatus | '')}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="col-span-2">
            <Segmented
              label="Principal ou opcional"
              value={prio}
              onChange={setPrio}
              options={[
                { value: 'todas', label: 'Todas' },
                { value: 'principal', label: '» Principais' },
                { value: 'opcional', label: '◦ Opcionais' },
              ]}
            />
          </div>
          <button className="btn-ghost col-span-2" onClick={clear}>
            Limpar filtros
          </button>
        </div>
      </details>
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" className="h-5 w-5" checked={onlyUpcoming} onChange={(e) => setOnlyUpcoming(e.target.checked)} />
        Ocultar dias passados
      </label>
      <p className="text-[13px] text-muted" aria-live="polite">
        {filtered.length} sessão(ões) encontradas
      </p>
      {filtered.length === 0 && <Empty title="Nenhuma sessão com esses filtros" />}
      {[...byDate].map(([d, list]) => (
        <section key={d} aria-label={formatLong(d)}>
          <h2 className={cx('section-title', d === today && 'text-accent')}>
            {d === today ? 'Hoje · ' : ''}
            {formatLong(d)} · S{list[0].week}
          </h2>
          <div className="space-y-2">
            {list.map((s) => (
              <SessionCard key={s.key} s={s} log={snap.sessionLogs.get(s.key)} isToday={d === today} highlight={next?.session.key === s.key} onOpen={() => setOpen(s)} />
            ))}
          </div>
        </section>
      ))}
      <SessionSheet s={open} date={open ? realDateFor(open.date, shift) : undefined} snap={snap} onClose={() => setOpen(null)} />
    </div>
  );
}

function Progressions() {
  const tables = useLiveQuery(() => getDB().progressionTables.toArray(), []) ?? [];
  const sheets = [...new Set(tables.map((t) => t.sheet))];
  const [sheet, setSheet] = useState<string>('');
  const current = sheet || sheets[0];
  if (!tables.length) return <Empty title="Sem tabelas de progressão importadas" />;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {sheets.map((s) => (
          <button key={s} className={cx('chip shrink-0', current === s && 'border-accent bg-accent text-accentInk')} onClick={() => setSheet(s)} aria-pressed={current === s}>
            {s}
          </button>
        ))}
      </div>
      {tables
        .filter((t) => t.sheet === current)
        .map((t) => (
          <Card key={t.id}>
            <h3 className="font-bold">{t.title}</h3>
            {t.notes.map((n, i) => (
              <p key={i} className="mt-1 text-[13px] text-muted">
                {n}
              </p>
            ))}
            <div className="mt-2 space-y-2">
              {t.rows.map((r, i) => (
                <details key={i} className="rounded-xl bg-surface2 p-2">
                  <summary className="cursor-pointer text-[14px] font-semibold">
                    {r.cells[0]} {r.cells[1] && <span className="font-normal text-muted">· {r.cells[1].slice(0, 60)}</span>}
                  </summary>
                  <dl className="mt-2 space-y-2 text-[13px]">
                    {t.columns.slice(1).map((c, j) => (
                      <div key={c}>
                        <dt className="font-semibold text-muted">{c}</dt>
                        <dd className="whitespace-pre-line-safe">{r.cells[j + 1] || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            </div>
            <SourceInfo source={t.source} />
          </Card>
        ))}
    </div>
  );
}

function Zones() {
  const run = useLiveQuery(() => getDB().paceZones.toArray(), []) ?? [];
  const swim = useLiveQuery(() => getDB().swimZones.toArray(), []) ?? [];
  return (
    <div className="space-y-3">
      <Card>
        <h3 className="font-bold">🏃 Corrida (pace)</h3>
        <p className="text-[12px] text-muted">FC máxima não informada na planilha: o pace é a referência principal.</p>
        <ul className="mt-2 divide-y divide-line">
          {run.map((z) => (
            <li key={z.id} className="py-2 text-[14px]">
              <div className="flex justify-between gap-2">
                <b>{z.name}</b>
                <span className="tabular-nums font-semibold">{z.pace}/km</span>
              </div>
              <div className="text-[12px] text-muted">
                %FCmáx {z.hrPercent} · {z.use}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="font-bold">🏊 Natação (British Swimming)</h3>
        <ul className="mt-2 divide-y divide-line">
          {swim.map((z) => (
            <li key={z.id} className="py-2 text-[14px]">
              <b>
                {z.zone} · {z.code}
              </b>
              <div className="text-[12px] text-muted">
                {z.description} · {z.example}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
