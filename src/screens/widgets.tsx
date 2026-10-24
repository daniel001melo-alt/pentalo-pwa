import { useState } from 'react';
import { addCoachNote, addPain, addPersonalNote, addWater, deleteCoachNote, deleteWater, saveWellness, setSupplementEntry, undoLastWater } from '../domain/actions';
import type { PainEntry } from '../domain/schemas';
import type { DayView, Snapshot } from '../domain/snapshot';
import { Card, cx, fmtNum, ProgressBar, Scale, Sheet, useToast } from '../ui/kit';
import { navigate } from '../hooks';
import { TextArea } from './session';

export function WaterCard({ day, snap }: { day: DayView; snap: Snapshot }) {
  const toast = useToast();
  const [manual, setManual] = useState('');
  const [hist, setHist] = useState(false);
  const goal = snap.settings.hydration.dailyMl;
  const add = async (ml: number) => {
    try {
      const id = await addWater(day.date, ml);
      toast(`+${ml} ml registrados`, { label: 'Desfazer', run: () => void deleteWater(id) });
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h3 className="font-bold">💧 Água</h3>
        <span className="text-[14px] tabular-nums">
          <b>{fmtNum(day.hydrationMl / 1000, 2)} L</b>
          {goal ? <span className="text-muted"> / {fmtNum(goal / 1000, 2)} L</span> : <span className="text-muted"> · meta não definida</span>}
        </span>
      </div>
      <div className="mt-2">
        <ProgressBar value={goal ? day.hydrationMl / goal : null} label="Hidratação do dia" tone="natacao" />
      </div>
      {!goal && (
        <p className="mt-2 text-[12px] text-muted">
          Defina a meta em{' '}
          <button className="underline" onClick={() => navigate('/mais?s=config')}>
            Configurações
          </button>
          . {snap.settings.hydration.planReference && <>Referência da planilha: “{snap.settings.hydration.planReference}”.</>}
        </p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[250, 500, 1000].map((ml) => (
          <button key={ml} className="btn-ghost" onClick={() => void add(ml)}>
            +{ml >= 1000 ? '1 L' : `${ml} ml`}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className="input" inputMode="numeric" placeholder="ml" aria-label="Quantidade manual em ml" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} />
        <button className="btn-ghost" disabled={!manual} onClick={() => (void add(Number(manual)), setManual(''))}>
          Adicionar
        </button>
        <button
          className="btn-ghost"
          disabled={!day.hydrationEntries.length}
          onClick={async () => {
            const last = await undoLastWater(day.date);
            if (last) toast(`Removido: ${last.ml} ml`);
          }}
        >
          Desfazer
        </button>
      </div>
      {day.hydrationEntries.length > 0 && (
        <button className="mt-2 text-[13px] text-muted underline" onClick={() => setHist(!hist)} aria-expanded={hist}>
          {hist ? 'Ocultar' : 'Ver'} registros ({day.hydrationEntries.length})
        </button>
      )}
      {hist && (
        <ul className="mt-1 divide-y divide-line text-[14px]">
          {day.hydrationEntries.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-1.5">
              <span className="tabular-nums">
                {new Date(h.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {h.ml} ml
              </span>
              <button className="text-[13px] text-bad underline" onClick={() => void deleteWater(h.id)}>
                remover
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function SupplementsCard({ day, snap }: { day: DayView; snap: Snapshot }) {
  const toast = useToast();
  const sups = snap.supplements;
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h3 className="font-bold">💊 Suplementação</h3>
        <button className="text-[13px] text-accent underline" onClick={() => navigate('/mais?s=suplementos')}>
          configurar
        </button>
      </div>
      {!sups.some((s) => s.active) && <p className="mt-1 text-[13px] text-muted">Nenhum suplemento ativo. Ative creatina e/ou beta-alanina e preencha a dose você mesmo — o app não sugere doses.</p>}
      <ul className="mt-2 space-y-2">
        {sups
          .filter((s) => s.active)
          .map((s) => {
            const e = day.supplementEntries.find((x) => x.supplementId === s.id);
            return (
              <li key={s.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-[12px] text-muted">
                    {s.dose ? `Dose: ${s.dose}` : 'Dose não preenchida'} · {s.time ?? 'sem horário'}
                  </div>
                </div>
                <button
                  className={cx('btn-ghost min-h-[40px] px-3 text-[13px]', e?.status === 'tomado' && 'border-ok bg-ok/15 text-ok')}
                  aria-pressed={e?.status === 'tomado'}
                  onClick={async () => {
                    await setSupplementEntry(day.date, s.id, e?.status === 'tomado' ? null : 'tomado');
                    toast(e?.status === 'tomado' ? `${s.name}: desmarcado` : `${s.name}: tomado`);
                  }}
                >
                  ✓ Tomado
                </button>
                <button
                  className={cx('btn-ghost min-h-[40px] px-3 text-[13px]', e?.status === 'ignorado' && 'border-bad bg-bad/15 text-bad')}
                  aria-pressed={e?.status === 'ignorado'}
                  onClick={() => void setSupplementEntry(day.date, s.id, e?.status === 'ignorado' ? null : 'ignorado')}
                >
                  ⊘<span className="sr-only">Ignorado</span>
                </button>
              </li>
            );
          })}
      </ul>
    </Card>
  );
}

export function WellnessCard({ day }: { day: DayView }) {
  const w = day.wellness;
  const [painOpen, setPainOpen] = useState(false);
  const set = (k: 'energy' | 'mood' | 'sleep' | 'fatigue' | 'muscleSoreness') => (v: number | null) => void saveWellness(day.date, { [k]: v });
  return (
    <Card>
      <h3 className="font-bold">❤️ Bem-estar de hoje</h3>
      <p className="text-[12px] text-muted">Escala 1–5. Toque de novo para limpar.</p>
      <div className="mt-2 space-y-3">
        <Scale label="Energia" value={w?.energy ?? null} onChange={set('energy')} lowLabel="baixa" highLabel="alta" />
        <Scale label="Humor" value={w?.mood ?? null} onChange={set('mood')} lowLabel="ruim" highLabel="ótimo" />
        <Scale label="Sono" value={w?.sleep ?? null} onChange={set('sleep')} lowLabel="ruim" highLabel="ótimo" />
        <Scale label="Fadiga" value={w?.fatigue ?? null} onChange={set('fatigue')} lowLabel="nenhuma" highLabel="extrema" />
        <Scale label="Dor muscular" value={w?.muscleSoreness ?? null} onChange={set('muscleSoreness')} lowLabel="nenhuma" highLabel="forte" />
        <BlurInput label="Dor localizada (onde?)" value={w?.localizedPain ?? ''} onSave={(v) => void saveWellness(day.date, { localizedPain: v })} />
        <BlurInput label="Observações" value={w?.notes ?? ''} onSave={(v) => void saveWellness(day.date, { notes: v })} multiline />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px] text-muted">{day.pains.length ? `${day.pains.length} registro(s) de dor hoje` : 'Sem registro de dor hoje'}</span>
        <button className="btn-ghost" onClick={() => setPainOpen(true)}>
          + Registrar dor
        </button>
      </div>
      {day.pains.map((p) => (
        <div key={p.id} className="mt-2 rounded-lg bg-surface2 p-2 text-[13px]">
          <b>{p.location}</b> · intensidade {p.intensity}/10 · impacto: {IMPACT[p.trainingImpact]}
          {p.notes && <div className="text-muted">{p.notes}</div>}
        </div>
      ))}
      <PainSheet open={painOpen} date={day.date} onClose={() => setPainOpen(false)} />
    </Card>
  );
}

export const IMPACT: Record<PainEntry['trainingImpact'], string> = {
  nenhum: 'nenhum',
  adaptou: 'treino adaptado',
  reduziu: 'treino reduzido',
  interrompeu: 'treino interrompido',
  nao_treinou: 'não treinou',
};

export function PainSheet({ open, date, onClose }: { open: boolean; date: string; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Omit<PainEntry, 'id' | 'createdAt'>>({ date, location: '', intensity: 0, onset: '', trainingImpact: 'nenhum', notes: '' });
  return (
    <Sheet open={open} onClose={onClose} title="Registrar dor ou desconforto">
      <div className="space-y-3">
        <p className="rounded-xl bg-surface2 p-3 text-[13px]">O app apenas registra. Não faz diagnóstico. Dor persistente, forte ou articular: procure avaliação profissional.</p>
        <div>
          <label className="label" htmlFor="pain-loc">
            Local
          </label>
          <input id="pain-loc" className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="ex.: ombro direito, canela esquerda" />
        </div>
        <div>
          <label className="label" htmlFor="pain-int">
            Intensidade (0–10): <b className="text-ink">{f.intensity}</b>
          </label>
          <input id="pain-int" type="range" min={0} max={10} value={f.intensity} onChange={(e) => setF({ ...f, intensity: Number(e.target.value) })} className="w-full" />
        </div>
        <div>
          <label className="label" htmlFor="pain-onset">
            Início
          </label>
          <input id="pain-onset" className="input" value={f.onset} onChange={(e) => setF({ ...f, onset: e.target.value })} placeholder="ex.: hoje no treino, há 3 dias" />
        </div>
        <div>
          <span className="label">Impacto no treino</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(IMPACT) as PainEntry['trainingImpact'][]).map((k) => (
              <button
                key={k}
                className={cx('chip', f.trainingImpact === k && 'border-accent bg-accent text-accentInk')}
                aria-pressed={f.trainingImpact === k}
                onClick={() => setF({ ...f, trainingImpact: k })}
              >
                {IMPACT[k]}
              </button>
            ))}
          </div>
        </div>
        <TextArea id="pain-notes" label="Observação" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
        <button
          className="btn-primary w-full"
          disabled={!f.location.trim()}
          onClick={async () => {
            await addPain({ ...f, date });
            toast('Dor registrada');
            setF({ date, location: '', intensity: 0, onset: '', trainingImpact: 'nenhum', notes: '' });
            onClose();
          }}
        >
          Salvar
        </button>
      </div>
    </Sheet>
  );
}

export function CoachNotesCard({ day, snap }: { day: DayView; snap: Snapshot }) {
  const [text, setText] = useState('');
  const weekNote = day.week ? snap.coachNotes.find((n) => n.origin === 'planilha' && n.week === day.week!.number) : null;
  const mine = snap.coachNotes.filter((n) => n.origin === 'usuario' && n.date === day.date);
  return (
    <Card>
      <h3 className="font-bold">📋 Notas do coach</h3>
      {weekNote ? (
        <p className="mt-1 text-[14px]">
          <span className="text-[12px] font-bold uppercase text-muted">Planilha · S{weekNote.week}: </span>
          {weekNote.text}
        </p>
      ) : (
        <p className="mt-1 text-[13px] text-muted">Sem observação da planilha para esta semana.</p>
      )}
      {mine.map((n) => (
        <div key={n.id} className="mt-2 flex items-start justify-between gap-2 rounded-lg bg-surface2 p-2 text-[14px]">
          <span>{n.text}</span>
          <button className="text-[12px] text-bad underline" onClick={() => void deleteCoachNote(n.id)}>
            apagar
          </button>
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Anotar orientação recebida…" aria-label="Nova nota do coach" />
        <button className="btn-ghost" disabled={!text.trim()} onClick={() => (void addCoachNote(day.date, text), setText(''))}>
          Salvar
        </button>
      </div>
    </Card>
  );
}

export function PersonalNoteInput({ date }: { date: string }) {
  const [text, setText] = useState('');
  const toast = useToast();
  return (
    <div className="flex gap-2">
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nota pessoal do dia…" aria-label="Nota pessoal" />
      <button className="btn-ghost" disabled={!text.trim()} onClick={() => (void addPersonalNote(date, text).then(() => toast('Nota salva')), setText(''))}>
        Salvar
      </button>
    </div>
  );
}

function BlurInput({ label, value, onSave, multiline }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean }) {
  const [v, setV] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? v : value;
  const id = `bi-${label.replace(/\W/g, '')}`;
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="input min-h-[64px] py-2"
          value={shown}
          onFocus={() => (setV(value), setFocused(true))}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => (setFocused(false), v !== value && onSave(v))}
        />
      ) : (
        <input
          id={id}
          className="input"
          value={shown}
          onFocus={() => (setV(value), setFocused(true))}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => (setFocused(false), v !== value && onSave(v))}
        />
      )}
    </div>
  );
}
