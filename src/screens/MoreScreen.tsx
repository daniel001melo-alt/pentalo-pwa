import { useLiveQuery } from 'dexie-react-hooks';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { getDB, saveSettings } from '../db/db';
import { addSupplement, applyShift, changeCompetitionDate, deletePain, deletePersonalNote, previewShift, shiftToMatchCompetition, updateSupplement } from '../domain/actions';
import { describeFormula } from '../domain/adherence';
import { backupFileName, buildBackup, previewBackup, restoreBackup, type BackupPreview, type RestoreMode } from '../domain/backup';
import { formatBR, formatLong, todayISO } from '../domain/dates';
import type { AppSettings } from '../domain/schemas';
import type { Snapshot } from '../domain/snapshot';
import { navigate, type Route } from '../hooks';
import { capabilities, downloadFile, requestNotificationPermission, requestPersistence, storageEstimate } from '../pwa/platform';
import { Card, Confirm, cx, Empty, fmtNum, Segmented, useToast } from '../ui/kit';
import { ReportView } from './ReportView';
import { IMPACT } from './widgets';

const ChartsScreen = lazy(() => import('./ChartsScreen'));

const MENU: { s: string; label: string; desc: string }[] = [
  { s: 'graficos', label: 'Gráficos e análises', desc: 'Aderência, RPE, hidratação, perfis, comparação com a dieta-base' },
  { s: 'config', label: 'Configurações', desc: 'Competição, pesos da aderência, meta de água, tema' },
  { s: 'suplementos', label: 'Suplementação', desc: 'Creatina, beta-alanina: ativar, horário, dose manual' },
  { s: 'lembretes', label: 'Lembretes e notificações', desc: 'Treino, refeições, água, suplementos' },
  { s: 'historico', label: 'Bem-estar, dor e notas', desc: 'Histórico de registros pessoais' },
  { s: 'importacao', label: 'Importação e relatório', desc: 'Reimportar planilhas, ver relatório e divergências' },
  { s: 'backup', label: 'Backup', desc: 'Exportar e importar JSON, backups automáticos' },
  { s: 'instalar', label: 'Instalar no iPhone', desc: 'Tela de Início, offline, compatibilidade' },
  { s: 'sobre', label: 'Sobre e limitações', desc: 'O que o app faz e o que não faz' },
];

export function MoreScreen({ snap, route, onReimport }: { snap: Snapshot; route: Route; onReimport: () => void }) {
  const s = route.params.get('s');
  const item = MENU.find((m) => m.s === s);
  if (!item) {
    return (
      <div className="space-y-3 pt-2">
        <h1 className="font-display text-[26px] font-extrabold">Mais</h1>
        <ul className="space-y-2">
          {MENU.map((m) => (
            <li key={m.s}>
              <a href={`#/mais?s=${m.s}`} className="card flex items-center justify-between gap-2 p-4">
                <span>
                  <b className="block">{m.label}</b>
                  <span className="text-[13px] text-muted">{m.desc}</span>
                </span>
                <span aria-hidden className="text-muted">
                  ›
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="space-y-4 pt-2">
      <button className="text-[14px] font-semibold text-accent" onClick={() => navigate('/mais')}>
        ‹ Mais
      </button>
      <h1 className="font-display text-[24px] font-extrabold">{item.label}</h1>
      {s === 'graficos' && (
        <Suspense fallback={<p className="text-muted">Carregando gráficos…</p>}>
          <ChartsScreen snap={snap} />
        </Suspense>
      )}
      {s === 'config' && <Settings snap={snap} />}
      {s === 'suplementos' && <Supplements snap={snap} />}
      {s === 'lembretes' && <Reminders snap={snap} />}
      {s === 'historico' && <History snap={snap} />}
      {s === 'importacao' && <ImportInfo snap={snap} onReimport={onReimport} />}
      {s === 'backup' && <Backup />}
      {s === 'instalar' && <Install />}
      {s === 'sobre' && <About />}
    </div>
  );
}

// ───────────────────────── Configurações ─────────────────────────

function Settings({ snap }: { snap: Snapshot }) {
  const toast = useToast();
  const st = snap.settings;
  const [comp, setComp] = useState(st.competitionDate);
  const [confirmComp, setConfirmComp] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftDays, setShiftDays] = useState(0);
  const [w, setW] = useState(st.weights);
  const [cr, setCr] = useState(st.credits);
  const [goal, setGoal] = useState(st.hydration.dailyMl ? String(st.hydration.dailyMl) : '');
  useEffect(() => setComp(st.competitionDate), [st.competitionDate]);
  const ref = snap.planMeta?.hydrationReference;
  const suggested = shiftToMatchCompetition(snap);
  const preview = previewShift(snap, shiftDays, todayISO());
  const appliedPreview = describeFormula(
    Object.fromEntries(
      Object.entries(w)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => [k, v / Object.values(w).reduce((a, b) => a + b, 0)]),
    ),
  );
  const save = async (patch: Partial<AppSettings>, msg = 'Configuração salva') => {
    await saveSettings(patch);
    toast(msg);
  };
  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-bold">Data da competição</h3>
        <p className="text-[13px] text-muted">
          Atual: <b className="text-ink">{formatBR(st.competitionDate)}</b> (
          {st.competitionDateOrigin === 'planilha' ? 'premissa da planilha' : st.competitionDateOrigin === 'usuario' ? 'definida por você' : 'padrão'}). Mudar a data atualiza a contagem regressiva e{' '}
          <b>não</b> move os treinos.
        </p>
        <div className="mt-2 flex gap-2">
          <input type="date" className="input" value={comp} onChange={(e) => setComp(e.target.value)} aria-label="Nova data da competição" />
          <button className="btn-primary" disabled={!comp || comp === st.competitionDate} onClick={() => setConfirmComp(true)}>
            Salvar
          </button>
        </div>
        <Confirm
          open={confirmComp}
          title="Alterar data da competição"
          message={
            <>
              Nova data: <b>{comp && formatLong(comp)}</b>. A contagem regressiva e o progresso temporal mudam. O calendário de treinos e nutrição continua igual — para movê-lo, use “Deslocar
              calendário”.
            </>
          }
          confirmLabel="Alterar data"
          onCancel={() => setConfirmComp(false)}
          onConfirm={async () => {
            await changeCompetitionDate(comp);
            setConfirmComp(false);
            toast('Data da competição atualizada');
          }}
        />
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[14px]">
            Deslocamento atual do calendário:{' '}
            <b>
              {st.planShiftDays > 0 ? '+' : ''}
              {st.planShiftDays} dia(s)
            </b>
          </p>
          {suggested !== null && suggested !== st.planShiftDays && (
            <p className="text-[13px] text-warn">
              A sessão “COMPETIÇÃO” do plano não coincide com a data configurada. Deslocamento que alinharia: {suggested > 0 ? '+' : ''}
              {suggested} dia(s).
            </p>
          )}
          <button
            className="btn-ghost mt-2 w-full"
            onClick={() => {
              setShiftDays(suggested ?? st.planShiftDays);
              setShiftOpen(true);
            }}
          >
            Deslocar calendário…
          </button>
        </div>
        <Confirm
          open={shiftOpen}
          title="Deslocar o calendário do plano"
          confirmLabel={`Aplicar ${shiftDays > 0 ? '+' : ''}${shiftDays} dia(s)`}
          danger
          onCancel={() => setShiftOpen(false)}
          onConfirm={async () => {
            const r = await applyShift(shiftDays);
            setShiftOpen(false);
            toast(`Calendário deslocado. Backup automático criado (${r.backupId.slice(0, 13)}…).`);
          }}
          message={
            <div className="space-y-2">
              <label className="block">
                <span className="label">Dias (positivo = adiar, negativo = antecipar)</span>
                <input type="number" className="input" value={shiftDays} onChange={(e) => setShiftDays(Math.round(Number(e.target.value)))} />
              </label>
              <ul className="list-disc space-y-1 pl-5 text-[14px]">
                <li>
                  Ciclo passa a ir de <b>{formatBR(preview.newStart ?? '')}</b> a <b>{formatBR(preview.newEnd ?? '')}</b>.
                </li>
                {preview.competitionSession && (
                  <li>
                    Sessão de competição: {formatBR(preview.competitionSession.from)} → <b>{formatBR(preview.competitionSession.to)}</b>{' '}
                    {preview.alignedWithCompetition ? '(coincide com a data configurada)' : '(NÃO coincide com a data configurada)'}.
                  </li>
                )}
                <li>
                  {preview.loggedSessions} registro(s) de treino e {preview.loggedMeals} de refeição acompanham o plano (ficam ligados à sessão/refeição, não à data).
                </li>
                {preview.pastToFuture > 0 && <li>{preview.pastToFuture} sessão(ões) que já passaram voltam a ficar no futuro.</li>}
                {preview.futureToPast > 0 && <li className="text-warn">{preview.futureToPast} sessão(ões) futuras passam a ficar no passado.</li>}
                <li>Não mudam de data: {preview.unaffected.join(', ')}.</li>
                <li>Um backup automático completo será criado antes.</li>
              </ul>
            </div>
          }
        />
      </Card>

      <Card>
        <h3 className="font-bold">Pesos da aderência geral</h3>
        <p className="text-[13px] text-muted">Categorias não aplicáveis no dia têm o peso redistribuído entre as demais.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(
            [
              ['training', 'Treino'],
              ['diet', 'Dieta'],
              ['supplements', 'Suplementação'],
              ['hydration', 'Hidratação'],
            ] as const
          ).map(([k, l]) => (
            <label key={k}>
              <span className="label">{l} (%)</span>
              <input type="number" min={0} max={100} className="input" value={w[k]} onChange={(e) => setW({ ...w, [k]: Math.max(0, Number(e.target.value)) })} />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">{appliedPreview}</p>
        <h4 className="mt-3 font-semibold">Créditos</h4>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(
            [
              ['trainingPartial', 'Treino parcial'],
              ['optionalWeight', 'Peso de sessão opcional realizada'],
              ['mealPartial', 'Refeição parcial'],
              ['mealSubstituted', 'Refeição substituída'],
            ] as const
          ).map(([k, l]) => (
            <label key={k}>
              <span className="label">{l} (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                className="input"
                value={Math.round(cr[k] * 100)}
                onChange={(e) => setCr({ ...cr, [k]: Math.min(100, Math.max(0, Number(e.target.value))) / 100 })}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">Conforme o plano = 100 %; não realizada = 0 %. Sessão opcional só conta se realizada (nunca penaliza). Hidratação limitada a 100 %.</p>
        <button className="btn-primary mt-3 w-full" onClick={() => void save({ weights: w, credits: cr }, 'Pesos e créditos salvos')}>
          Salvar pesos
        </button>
      </Card>

      <Card>
        <h3 className="font-bold">Meta diária de água</h3>
        {ref ? (
          <p className="text-[13px] text-muted">
            A planilha traz uma <b>faixa</b>, não uma meta única: “{ref.text}”. Escolha um valor ou digite o seu.
          </p>
        ) : (
          <p className="text-[13px] text-muted">A planilha não informa meta de hidratação.</p>
        )}
        <div className="mt-2 flex gap-2">
          <input className="input" inputMode="numeric" placeholder="ml por dia" value={goal} onChange={(e) => setGoal(e.target.value.replace(/\D/g, ''))} aria-label="Meta diária em ml" />
          <button
            className="btn-primary"
            onClick={() => void save({ hydration: { ...st.hydration, dailyMl: goal ? Number(goal) : null, origin: goal ? 'usuario' : 'nao_definida' } }, 'Meta de água salva')}
          >
            Salvar
          </button>
        </div>
        {ref?.minMl && ref.maxMl && (
          <div className="mt-2 flex gap-2">
            {[ref.minMl, ref.maxMl].map((v) => (
              <button key={v} className="chip" onClick={() => setGoal(String(v))}>
                Usar {fmtNum(v / 1000, 1)} L (planilha)
              </button>
            ))}
          </div>
        )}
        <p className="mt-1 text-[12px] text-muted">
          Atual:{' '}
          {st.hydration.dailyMl ? `${st.hydration.dailyMl} ml (${st.hydration.origin === 'usuario' ? 'definida por você' : st.hydration.origin})` : 'não definida — hidratação fica fora da aderência'}.
        </p>
      </Card>

      <Card>
        <h3 className="font-bold">Aparência</h3>
        <span className="label mt-2">Tema</span>
        <Segmented
          label="Tema"
          value={st.theme}
          onChange={(v) => void save({ theme: v })}
          options={[
            { value: 'system', label: 'Sistema' },
            { value: 'light', label: 'Claro' },
            { value: 'dark', label: 'Escuro' },
          ]}
        />
        <span className="label mt-3">Redução de movimento</span>
        <Segmented
          label="Redução de movimento"
          value={st.reducedMotion}
          onChange={(v) => void save({ reducedMotion: v })}
          options={[
            { value: 'system', label: 'Sistema' },
            { value: 'on', label: 'Reduzir' },
            { value: 'off', label: 'Normal' },
          ]}
        />
      </Card>
    </div>
  );
}

// ───────────────────────── Suplementos ─────────────────────────

function Supplements({ snap }: { snap: Snapshot }) {
  const toast = useToast();
  const [name, setName] = useState('');
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-warn/10 p-3 text-[13px] text-warn">O app não recomenda nem sugere doses. Preencha somente o que foi orientado por profissional.</p>
      {snap.supplements.map((s) => (
        <Card key={s.id}>
          <div className="flex items-center justify-between">
            <h3 className="font-bold">{s.name}</h3>
            <label className="flex items-center gap-2 text-[14px] font-semibold">
              <input type="checkbox" className="h-6 w-6" checked={s.active} onChange={(e) => void updateSupplement(s.id, { active: e.target.checked })} />
              {s.active ? 'Ativo' : 'Inativo'}
            </label>
          </div>
          <p className="mt-1 text-[12px] text-muted">{s.planReference ? `Planilha menciona: ${s.planReference}` : 'Não informado no planejamento.'}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label>
              <span className="label">Horário</span>
              <input type="time" className="input" defaultValue={s.time ?? ''} onBlur={(e) => void updateSupplement(s.id, { time: e.target.value || null }).then(() => toast('Horário salvo'))} />
            </label>
            <label>
              <span className="label">Dose (manual)</span>
              <input
                className="input"
                defaultValue={s.dose}
                placeholder="ex.: conforme orientação"
                onBlur={(e) => void updateSupplement(s.id, { dose: e.target.value }).then(() => toast('Dose salva'))}
              />
            </label>
            <label className="col-span-2">
              <span className="label">Observação</span>
              <input className="input" defaultValue={s.notes} onBlur={(e) => void updateSupplement(s.id, { notes: e.target.value })} />
            </label>
          </div>
        </Card>
      ))}
      <div className="flex gap-2">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Outro suplemento…" aria-label="Nome do suplemento" />
        <button className="btn-ghost" disabled={!name.trim()} onClick={() => (void addSupplement(name.trim()), setName(''))}>
          Adicionar
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── Lembretes ─────────────────────────

function Reminders({ snap }: { snap: Snapshot }) {
  const toast = useToast();
  const [caps, setCaps] = useState(capabilities);
  const r = snap.settings.reminders;
  const set = (patch: Partial<AppSettings['reminders']>) => void saveSettings({ reminders: { ...r, ...patch } });
  return (
    <div className="space-y-3">
      <Card className="text-[14px]">
        <h3 className="font-bold">Como os lembretes funcionam (limitação real)</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            Disparam enquanto o app está <b>aberto</b> (em primeiro plano). Um PWA não consegue agendar notificações locais com o app fechado sem um servidor de push — este app não tem servidor.
          </li>
          <li>Com permissão concedida, aparecem como notificação do sistema; sem permissão, como aviso dentro do app.</li>
          <li>No iPhone, notificações web exigem iOS 16.4+ e o app instalado na Tela de Início.</li>
        </ul>
      </Card>
      <Card>
        <h3 className="font-bold">Compatibilidade deste aparelho</h3>
        <ul className="mt-1 text-[14px]">
          <li>Service Worker (offline): {caps.serviceWorker ? 'sim' : 'não'}</li>
          <li>
            Notificações: {caps.notifications ? `sim — permissão: ${caps.notificationPermission}` : caps.notificationsNeedInstall ? 'instale na Tela de Início para habilitar' : 'não suportadas'}
          </li>
          <li>Badge no ícone: {caps.badge ? 'sim' : 'não suportado'}</li>
          <li>Instalado (tela cheia): {caps.standalone ? 'sim' : 'não'}</li>
          <li>Agendamento com app fechado: não disponível</li>
        </ul>
        {caps.notifications && caps.notificationPermission === 'default' && (
          <button
            className="btn-primary mt-3 w-full"
            onClick={async () => {
              const p = await requestNotificationPermission();
              setCaps(capabilities());
              toast(p === 'granted' ? 'Notificações permitidas' : 'Permissão não concedida — lembretes aparecerão dentro do app');
            }}
          >
            Permitir notificações
          </button>
        )}
      </Card>
      <Card>
        <ToggleRow label="Treinos" checked={r.training.enabled} onChange={(v) => set({ training: { ...r.training, enabled: v } })}>
          <NumberInput label="minutos antes do horário do período" value={r.training.minutesBefore} onChange={(v) => set({ training: { ...r.training, minutesBefore: v } })} />
          <p className="text-[12px] text-muted">Horário de cada período = premissa da planilha (AM ≈06:00, PM ≈16:00, Único ≈07:00, Casa ≈20:30).</p>
        </ToggleRow>
        <ToggleRow label="Refeições" checked={r.meals.enabled} onChange={(v) => set({ meals: { ...r.meals, enabled: v } })}>
          <NumberInput label="minutos antes do horário planejado" value={r.meals.minutesBefore} onChange={(v) => set({ meals: { ...r.meals, minutesBefore: v } })} />
        </ToggleRow>
        <ToggleRow label="Água" checked={r.water.enabled} onChange={(v) => set({ water: { ...r.water, enabled: v } })}>
          <NumberInput label="a cada (minutos) sem registro" value={r.water.everyMinutes} onChange={(v) => set({ water: { ...r.water, everyMinutes: v } })} />
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="label">das</span>
              <input type="time" className="input" value={r.water.from} onChange={(e) => set({ water: { ...r.water, from: e.target.value } })} />
            </label>
            <label>
              <span className="label">até</span>
              <input type="time" className="input" value={r.water.to} onChange={(e) => set({ water: { ...r.water, to: e.target.value } })} />
            </label>
          </div>
        </ToggleRow>
        <ToggleRow label="Suplementos (creatina, beta-alanina…)" checked={r.supplements.enabled} onChange={(v) => set({ supplements: { enabled: v } })}>
          <p className="text-[12px] text-muted">Usa o horário definido em Suplementação para cada item ativo.</p>
        </ToggleRow>
      </Card>
    </div>
  );
}

function ToggleRow({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="border-b border-line py-3 last:border-0">
      <label className="flex items-center justify-between gap-2 font-semibold">
        {label}
        <input type="checkbox" className="h-6 w-6" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {checked && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" min={0} className="input" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} />
    </label>
  );
}

// ───────────────────────── Histórico ─────────────────────────

function History({ snap }: { snap: Snapshot }) {
  const wellness = [...snap.wellness.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const pains = [...snap.pains].sort((a, b) => (a.date < b.date ? 1 : -1));
  const notes = [...snap.personalNotes].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <div className="space-y-3">
      <h2 className="section-title">Bem-estar ({wellness.length})</h2>
      {wellness.length === 0 && <Empty title="Sem registros de bem-estar" />}
      {wellness.map((w) => (
        <Card key={w.date} className="text-[14px]">
          <b>{formatBR(w.date)}</b> — energia {w.energy ?? '—'} · humor {w.mood ?? '—'} · sono {w.sleep ?? '—'} · fadiga {w.fatigue ?? '—'} · dor muscular {w.muscleSoreness ?? '—'}
          {w.localizedPain && <div>Dor localizada: {w.localizedPain}</div>}
          {w.notes && <div className="text-muted">{w.notes}</div>}
        </Card>
      ))}
      <h2 className="section-title">Dor / lesão ({pains.length})</h2>
      {pains.length === 0 && <Empty title="Sem registros de dor" />}
      {pains.map((p) => (
        <Card key={p.id} className="text-[14px]">
          <div className="flex justify-between gap-2">
            <b>
              {formatBR(p.date)} · {p.location}
            </b>
            <button className="text-[12px] text-bad underline" onClick={() => void deletePain(p.id)}>
              apagar
            </button>
          </div>
          Intensidade {p.intensity}/10 · início: {p.onset || '—'} · impacto: {IMPACT[p.trainingImpact]}
          {p.notes && <div className="text-muted">{p.notes}</div>}
        </Card>
      ))}
      <h2 className="section-title">Notas pessoais ({notes.length})</h2>
      {notes.map((n) => (
        <Card key={n.id} className="text-[14px]">
          <div className="flex justify-between gap-2">
            <b>{formatBR(n.date)}</b>
            <button className="text-[12px] text-bad underline" onClick={() => void deletePersonalNote(n.id)}>
              apagar
            </button>
          </div>
          {n.text}
        </Card>
      ))}
      <p className="text-[12px] text-muted">O app registra e organiza. Não diagnostica lesões.</p>
    </div>
  );
}

// ───────────────────────── Importação ─────────────────────────

function ImportInfo({ snap, onReimport }: { snap: Snapshot; onReimport: () => void }) {
  const stored = useLiveQuery(() => getDB().reports.get('last'), []);
  return (
    <div className="space-y-3">
      <Card>
        <h3 className="font-bold">Arquivos salvos neste aparelho</h3>
        <ul className="mt-1 space-y-1 text-[14px]">
          {snap.files.map((f) => (
            <li key={f.id}>
              <b>{f.id === 'plan' ? 'Planejamento' : 'Dieta-base'}:</b> {f.fileName} ({f.format.toUpperCase()}, {(f.size / 1024).toFixed(0)} KB) — importado em{' '}
              {new Date(f.importedAt).toLocaleString('pt-BR')}
              <div className="break-all text-[11px] text-muted">SHA-256 {f.sha256}</div>
            </li>
          ))}
        </ul>
        <button className="btn-primary mt-3 w-full" onClick={onReimport}>
          Reimportar planilha(s)
        </button>
        <p className="mt-1 text-[12px] text-muted">Cada arquivo pode ser reimportado separadamente. O progresso pessoal nunca é apagado.</p>
      </Card>
      {stored ? <ReportView report={stored.report} orphans={stored.orphans} /> : <Empty title="Sem relatório salvo" />}
    </div>
  );
}

// ───────────────────────── Backup ─────────────────────────

function Backup() {
  const toast = useToast();
  const autos = useLiveQuery(() => getDB().autoBackups.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [mode, setMode] = useState<RestoreMode>('mesclar');
  const [confirm, setConfirm] = useState(false);
  const exportKind = async (kind: 'completo' | 'progresso') => {
    const b = await buildBackup(kind);
    downloadFile(backupFileName(b), JSON.stringify(b));
    toast(`Backup ${kind} exportado`);
  };
  return (
    <div className="space-y-3">
      <Card>
        <h3 className="font-bold">Exportar</h3>
        <p className="text-[13px] text-muted">
          Completo: planilhas importadas (incluindo os arquivos originais e a origem de cada dado) + progresso + configurações. Somente progresso: registros pessoais e configurações.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button className="btn-primary" onClick={() => void exportKind('completo')}>
            JSON completo
          </button>
          <button className="btn-ghost" onClick={() => void exportKind('progresso')}>
            Só progresso
          </button>
        </div>
      </Card>
      <Card>
        <h3 className="font-bold">Importar backup JSON</h3>
        <label className="btn-ghost mt-2 w-full cursor-pointer" htmlFor="backup-file">
          Escolher arquivo .json
        </label>
        <input
          id="backup-file"
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setPreview(await previewBackup(await f.text()));
            e.target.value = '';
          }}
        />
        {preview && (
          <div className="mt-3 space-y-2 text-[14px]">
            {preview.errors.map((er) => (
              <p key={er} className="text-bad">
                {er}
              </p>
            ))}
            {preview.backup && (
              <>
                <p>
                  Backup <b>{preview.backup.kind}</b> de {new Date(preview.backup.createdAt).toLocaleString('pt-BR')} · versão {preview.backup.version} · app {preview.backup.appVersion}
                </p>
                <table className="w-full text-[13px] tabular-nums">
                  <thead className="text-left text-muted">
                    <tr>
                      <th>Tabela</th>
                      <th className="text-right">No backup</th>
                      <th className="text-right">Já existem</th>
                      <th className="text-right">Mesma chave</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.tables.map((t) => (
                      <tr key={t.name} className={cx('border-t border-line', !t.known && 'text-muted line-through')}>
                        <td>{t.name}</td>
                        <td className="text-right">{t.rows}</td>
                        <td className="text-right">{t.existing}</td>
                        <td className="text-right">{t.duplicates}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Segmented
                  label="Modo de restauração"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'mesclar', label: 'Mesclar (sem duplicar)' },
                    { value: 'substituir', label: 'Substituir' },
                  ]}
                />
                <p className="text-[12px] text-muted">
                  Mesclar: entra o que não existe; com a mesma chave, fica o registro mais recente. Substituir: as tabelas do backup são trocadas. Antes, um backup automático completo é criado.
                </p>
                <button className="btn-primary w-full" disabled={!preview.ok} onClick={() => setConfirm(true)}>
                  Restaurar
                </button>
              </>
            )}
          </div>
        )}
        <Confirm
          open={confirm}
          title="Restaurar backup"
          message={`Modo: ${mode}. Um backup automático do estado atual será criado antes.`}
          confirmLabel="Restaurar agora"
          danger={mode === 'substituir'}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            if (!preview?.backup) return;
            const r = await restoreBackup(preview.backup, mode);
            setConfirm(false);
            setPreview(null);
            toast(`${r.written} registro(s) restaurados`);
          }}
        />
      </Card>
      <Card>
        <h3 className="font-bold">Backups automáticos (neste aparelho)</h3>
        <p className="text-[12px] text-muted">Criados antes de reimportar, restaurar ou deslocar o calendário. Mantidos os 5 mais recentes.</p>
        {autos.length === 0 && <p className="mt-1 text-[14px] text-muted">Nenhum ainda.</p>}
        <ul className="mt-2 space-y-2">
          {autos.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-[14px]">
              <span>
                {new Date(a.createdAt).toLocaleString('pt-BR')}
                <span className="block text-[12px] text-muted">{a.reason}</span>
              </span>
              <button className="btn-ghost min-h-[40px] px-3 text-[13px]" onClick={() => downloadFile(backupFileName(a.data), JSON.stringify(a.data))}>
                Baixar
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <StorageInfo />
    </div>
  );
}

function StorageInfo() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [persist, setPersist] = useState<boolean | null>(null);
  useEffect(() => {
    void storageEstimate().then(setEst);
    void navigator.storage
      ?.persisted?.()
      .then(setPersist)
      .catch(() => setPersist(null));
  }, []);
  return (
    <Card className="text-[13px]">
      <h3 className="font-bold">Armazenamento local</h3>
      <p className="mt-1 text-muted">
        Uso: {est ? `${(est.usage / 1024 / 1024).toFixed(2)} MB` : 'indisponível'} · Persistente: {persist === null ? 'não informado pelo navegador' : persist ? 'sim' : 'não'}
      </p>
      {!persist && (
        <button className="btn-ghost mt-2 w-full" onClick={() => void requestPersistence().then(setPersist)}>
          Pedir armazenamento persistente
        </button>
      )}
      <p className="mt-2 text-muted">O Safari pode apagar dados de sites não instalados após um período sem uso. Instale na Tela de Início e exporte backups regularmente.</p>
    </Card>
  );
}

// ───────────────────────── Instalar / Sobre ─────────────────────────

function Install() {
  const caps = capabilities();
  return (
    <div className="space-y-3 text-[15px]">
      <Card>
        <h3 className="font-bold">iPhone (Safari)</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            Abra o endereço do app no <b>Safari</b> (outros navegadores no iOS podem não oferecer a opção).
          </li>
          <li>
            Toque em <b>Compartilhar</b> (quadrado com seta para cima).
          </li>
          <li>
            Role e toque em <b>Adicionar à Tela de Início</b>.
          </li>
          <li>
            Confirme o nome <b>Pentatlo</b> e toque em <b>Adicionar</b>.
          </li>
          <li>Abra pelo ícone. Na primeira abertura com internet, o app é guardado para uso offline.</li>
          <li>Importe as planilhas pelo app instalado (o armazenamento do app instalado é separado do Safari).</li>
        </ol>
        <p className="mt-2 text-[13px] text-muted">Status agora: {caps.standalone ? 'rodando como app instalado ✓' : 'rodando no navegador'}.</p>
      </Card>
      <Card>
        <h3 className="font-bold">Sem widget nativo</h3>
        <p className="text-[14px] text-muted">
          PWAs não criam widgets na Tela de Início do iOS. Em vez disso: o card de progresso e o resumo do dia na tela Hoje, o badge no ícone (quando suportado) e atalhos do app (Android/desktop; o
          iOS não exibe atalhos de PWA).
        </p>
      </Card>
    </div>
  );
}

function About() {
  return (
    <div className="space-y-3 text-[14px]">
      <Card>
        <h3 className="font-bold">O que este app faz</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Lê suas duas planilhas (XLSX e XLS reais) e guarda tudo no aparelho, com a origem de cada dado.</li>
          <li>Mostra treinos, dieta e orientações exatamente como planejados; marca inconsistências em vez de corrigi-las.</li>
          <li>Registra progresso: status, RPE, refeições, água, suplementos, bem-estar, dor e notas.</li>
          <li>Funciona offline e sem conta, login ou servidor.</li>
        </ul>
      </Card>
      <Card>
        <h3 className="font-bold">Limitações reais</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Lembretes só disparam com o app aberto; não há push com app fechado.</li>
          <li>Sem widget nativo; badge depende do iOS 16.4+ instalado.</li>
          <li>Dados ficam só neste aparelho: sem sincronização. Faça backups.</li>
          <li>Kcal/macros exibidos são os planejados. Marcar refeição não mede ingestão real.</li>
          <li>Horários de treino são aproximados pelo período (premissa da planilha).</li>
          <li>Não é recomendação médica, nutricional ou de treino; não diagnostica lesões; não sugere doses.</li>
        </ul>
      </Card>
      <p className="text-center text-[12px] text-muted">Versão {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'}</p>
    </div>
  );
}
