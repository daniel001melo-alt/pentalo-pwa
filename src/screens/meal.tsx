import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { getDB } from '../db/db';
import { autoMealTime, saveSubstitution, upsertMealLog } from '../domain/actions';
import { macroDelta, scaleFood } from '../domain/nutrition';
import type { Food, Meal, MealItem, MealLog, MealStatus } from '../domain/schemas';
import { cx, fmtNum, Sheet, SourceInfo, StatusBadge, useToast } from '../ui/kit';
import { TextArea } from './session';

export const MEAL_STATUS_LABEL: Record<MealStatus, string> = {
  pendente: 'Pendente',
  conforme: 'Realizada conforme o plano',
  parcial: 'Realizada parcialmente',
  substituida: 'Substituída pelo usuário',
  nao_realizada: 'Não realizada',
};
const SHORT: Record<MealStatus, string> = { pendente: 'Pendente', conforme: 'Conforme', parcial: 'Parcial', substituida: 'Substituída', nao_realizada: 'Não feita' };
const ICON: Record<MealStatus, string> = { pendente: '○', conforme: '●', parcial: '◑', substituida: '⇄', nao_realizada: '⊘' };
const TONE: Record<MealStatus, string> = { pendente: 'text-muted', conforme: 'text-ok', parcial: 'text-warn', substituida: 'text-m-natacao', nao_realizada: 'text-bad' };

const RELATION: Record<Meal['trainingRelation'], string> = {
  pre_treino: 'Pré-treino',
  pos_treino: 'Pós-treino',
  intra_treino: 'Intra/pós-treino',
  refeicao: 'Refeição',
  ceia: 'Ceia',
  nao_informado: 'Não informado',
};

export function MacroLine({ p, c, g, kcal, label = 'planejado' }: { p: number | null; c: number | null; g: number | null; kcal: number | null; label?: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] tabular-nums">
      <span>
        <b>{fmtNum(kcal, 0)}</b> kcal
      </span>
      <span>P {fmtNum(p)} g</span>
      <span>C {fmtNum(c)} g</span>
      <span>G {fmtNum(g)} g</span>
      <span className="text-muted">({label})</span>
    </div>
  );
}

export function MealCard({ meal, log, dayKey, onOpen, next, isToday }: { meal: Meal; log?: MealLog; dayKey: string; onOpen: () => void; next?: boolean; isToday?: boolean }) {
  const toast = useToast();
  const status = log?.status ?? 'pendente';
  const set = async (st: MealStatus) => {
    const prev = status;
    await upsertMealLog(dayKey, meal.key, { status: st, ...autoMealTime(!!isToday, st, log) });
    toast(`${meal.name}: ${SHORT[st]}`, { label: 'Desfazer', run: () => void upsertMealLog(dayKey, meal.key, { status: prev }) });
  };
  return (
    <div className={cx('card p-3', next && 'border-2 border-accent')}>
      <button className="block w-full text-left" onClick={onOpen} aria-label={`Abrir ${meal.name}`}>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-surface2 px-1.5 py-0.5 text-[13px] font-bold tabular-nums">{meal.time ?? '--:--'}</span>
          <span className="text-[12px] font-semibold text-muted">{RELATION[meal.trainingRelation]}</span>
          <span className={cx('ml-auto text-[12px] font-bold', TONE[status])}>
            {ICON[status]} {SHORT[status]}
          </span>
        </div>
        <div className="mt-1 text-[16px] font-bold">
          {meal.order}. {meal.name}
        </div>
        <MacroLine p={meal.totals.protein} c={meal.totals.carbs} g={meal.totals.fat} kcal={meal.totals.kcal} />
        {log?.actualTime && <div className="text-[12px] text-muted">Horário real: {log.actualTime}</div>}
      </button>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button
          className={cx('btn-ghost min-h-[40px] px-1 text-[13px]', status === 'conforme' && 'border-ok bg-ok/15 text-ok')}
          onClick={() => void set('conforme')}
          aria-pressed={status === 'conforme'}
        >
          ✓ Conforme
        </button>
        <button
          className={cx('btn-ghost min-h-[40px] px-1 text-[13px]', status === 'parcial' && 'border-warn bg-warn/15 text-warn')}
          onClick={() => void set('parcial')}
          aria-pressed={status === 'parcial'}
        >
          ◑ Parcial
        </button>
        <button
          className={cx('btn-ghost min-h-[40px] px-1 text-[13px]', status === 'nao_realizada' && 'border-bad bg-bad/15 text-bad')}
          onClick={() => void set('nao_realizada')}
          aria-pressed={status === 'nao_realizada'}
        >
          ⊘ Não feita
        </button>
      </div>
    </div>
  );
}

export function MealSheet({
  meal,
  items,
  log,
  dayKey,
  profileName,
  onClose,
  isToday,
}: {
  meal: Meal | null;
  items: MealItem[];
  log?: MealLog;
  dayKey: string;
  profileName: string;
  onClose: () => void;
  isToday?: boolean;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Partial<MealLog>>({});
  const [subItem, setSubItem] = useState<MealItem | null>(null);
  const subs =
    useLiveQuery(
      () =>
        meal
          ? getDB()
              .substitutions.where('dayKey')
              .equals(dayKey)
              .filter((s) => s.mealKey === meal.key)
              .toArray()
          : [],
      [dayKey, meal?.key],
    ) ?? [];
  useEffect(() => setForm(log ?? {}), [log, meal?.key]);
  if (!meal) return null;
  const status = (form.status ?? 'pendente') as MealStatus;
  const save = async (patch: Partial<MealLog>) => {
    await upsertMealLog(dayKey, meal.key, patch);
    toast('Refeição atualizada');
  };
  return (
    <Sheet open={!!meal} onClose={onClose} title={`${meal.order}. ${meal.name}`}>
      <div className="space-y-4">
        <p className="text-[14px] text-muted">
          Perfil <b className="text-ink">{profileName}</b> · horário planejado <b className="text-ink">{meal.time ?? 'não informado'}</b> · {RELATION[meal.trainingRelation]}
        </p>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-surface2 text-left text-[12px] text-muted">
              <tr>
                <th className="p-2">Alimento</th>
                <th className="p-2 text-right">Qtd</th>
                <th className="p-2 text-right">P</th>
                <th className="p-2 text-right">C</th>
                <th className="p-2 text-right">G</th>
                <th className="p-2 text-right">kcal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-line align-top">
                  <td className="p-2">
                    <div className="font-semibold">{i.foodName}</div>
                    {i.issues.length > 0 && <div className="text-[11px] text-warn">{i.issues.join(' ')}</div>}
                    <button className="text-[11px] font-semibold text-accent underline" onClick={() => setSubItem(i)}>
                      Substituir…
                    </button>
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {fmtNum(i.quantity.value)} {i.unit}
                  </td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(i.macros.protein)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(i.macros.carbs)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(i.macros.fat)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(i.macros.kcal, 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line font-bold">
              <tr>
                <td className="p-2">Total planejado</td>
                <td />
                <td className="p-2 text-right tabular-nums">{fmtNum(meal.totals.protein)}</td>
                <td className="p-2 text-right tabular-nums">{fmtNum(meal.totals.carbs)}</td>
                <td className="p-2 text-right tabular-nums">{fmtNum(meal.totals.fat)}</td>
                <td className="p-2 text-right tabular-nums">{fmtNum(meal.totals.kcal, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <SourceInfo source={meal.source} />
        <p className="text-[12px] text-muted">Valores planejados (calculados pela planilha). Marcar a refeição não registra ingestão real de calorias.</p>

        {subs.length > 0 && (
          <div className="card">
            <h3 className="font-bold">Substituições escolhidas por você</h3>
            <ul className="mt-1 space-y-1 text-[13px]">
              {subs.map((s) => (
                <li key={s.id}>
                  {s.fromFood} → <b>{s.toFood}</b> {s.quantity} {s.unit} (Δ kcal {fmtNum(s.delta.kcal, 0)}, P {fmtNum(s.delta.protein)}, C {fmtNum(s.delta.carbs)}, G {fmtNum(s.delta.fat)})
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted">Escolha pessoal — o plano original não foi alterado.</p>
          </div>
        )}

        <div className="card space-y-3">
          <h3 className="font-bold">Registro</h3>
          <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="Status da refeição">
            {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((st) => (
              <button
                key={st}
                role="radio"
                aria-checked={status === st}
                className={cx('btn-ghost min-h-[42px] justify-start text-[14px]', status === st && 'border-accent bg-accent text-accentInk')}
                onClick={() => {
                  const auto = autoMealTime(!!isToday, st, log);
                  setForm((f) => ({ ...f, status: st, ...auto }));
                  void save({ status: st, ...auto });
                }}
              >
                {ICON[st]} {MEAL_STATUS_LABEL[st]}
              </button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="meal-time">
              Horário real
            </label>
            <input
              id="meal-time"
              type="time"
              className="input"
              value={form.actualTime ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, actualTime: e.target.value || null }))}
              onBlur={() => void save({ actualTime: form.actualTime ?? null })}
            />
          </div>
          <TextArea id="meal-notes" label="Observação" value={form.notes ?? ''} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} onBlur={() => void save({ notes: form.notes ?? '' })} />
        </div>
      </div>
      {subItem && <SubstitutionSheet item={subItem} dayKey={dayKey} mealKey={meal.key} onClose={() => setSubItem(null)} />}
    </Sheet>
  );
}

/** Ferramenta OPCIONAL de substituição: mostra diferenças, exige confirmação, salva como escolha pessoal. */
function SubstitutionSheet({ item, dayKey, mealKey, onClose }: { item: MealItem; dayKey: string; mealKey: string; onClose: () => void }) {
  const toast = useToast();
  const foodsQ = useLiveQuery(() => getDB().foods.toArray(), []);
  const foods = useMemo(() => foodsQ ?? [], [foodsQ]);
  const [q, setQ] = useState('');
  const [food, setFood] = useState<Food | null>(null);
  const [qty, setQty] = useState<string>('');
  const [ack, setAck] = useState(false);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return foods.filter((f) => f.status !== 'nao_informado' && (!n || f.originalName.toLowerCase().includes(n))).slice(0, 40);
  }, [foods, q]);
  const serving = food && qty ? scaleFood(food, Number(qty.replace(',', '.'))) : null;
  const delta = serving ? macroDelta(item.macros, serving.macros) : null;
  return (
    <Sheet open onClose={onClose} title={`Substituir ${item.foodName}`}>
      <div className="space-y-3">
        <p className="rounded-xl bg-warn/10 p-3 text-[13px] text-warn">
          Ferramenta opcional. Não é recomendação profissional e não altera o plano original. Equivalência apenas por calorias não garante equivalência nutricional — confira as diferenças abaixo.
        </p>
        <input className="input" placeholder="Buscar alimento…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar alimento" />
        <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {list.map((f) => (
            <li key={f.id}>
              <button
                className={cx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px]', food?.id === f.id && 'bg-accent/15')}
                onClick={() => {
                  setFood(f);
                  setQty(String(f.baseMeasure.value ?? ''));
                }}
              >
                <span>
                  <b>{f.originalName}</b>{' '}
                  <span className="text-muted">
                    {String(f.baseMeasure.original ?? '').trim()} · {f.origin === 'plan' ? 'plano' : f.sourceNote}
                  </span>
                </span>
                <StatusBadge status={f.status} />
              </button>
            </li>
          ))}
        </ul>
        {food && (
          <div className="card space-y-2">
            <label className="label" htmlFor="sub-qty">
              Quantidade ({food.unit || 'unidade não informada'})
            </label>
            <input id="sub-qty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            {serving && delta && (
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-muted">
                  <tr>
                    <th />
                    <th className="text-right">P</th>
                    <th className="text-right">C</th>
                    <th className="text-right">G</th>
                    <th className="text-right">kcal</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Plano ({item.foodName})</td>
                    <td className="text-right">{fmtNum(item.macros.protein)}</td>
                    <td className="text-right">{fmtNum(item.macros.carbs)}</td>
                    <td className="text-right">{fmtNum(item.macros.fat)}</td>
                    <td className="text-right">{fmtNum(item.macros.kcal, 0)}</td>
                  </tr>
                  <tr>
                    <td>Escolha</td>
                    <td className="text-right">{fmtNum(serving.macros.protein)}</td>
                    <td className="text-right">{fmtNum(serving.macros.carbs)}</td>
                    <td className="text-right">{fmtNum(serving.macros.fat)}</td>
                    <td className="text-right">{fmtNum(serving.macros.kcal, 0)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td>Diferença</td>
                    <td className="text-right">{signed(delta.protein)}</td>
                    <td className="text-right">{signed(delta.carbs)}</td>
                    <td className="text-right">{signed(delta.fat)}</td>
                    <td className="text-right">{signed(delta.kcal, 0)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {food.issues.length > 0 && <p className="text-[12px] text-warn">Atenção a este registro: {food.issues.join(' ')}</p>}
            <label className="flex items-start gap-2 text-[14px]">
              <input type="checkbox" className="mt-1 h-5 w-5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Entendo que é uma escolha pessoal, sem recomendação profissional.
            </label>
            <button
              className="btn-primary w-full"
              disabled={!ack || !serving || !delta}
              onClick={async () => {
                if (!serving || !delta) return;
                await saveSubstitution({
                  dayKey,
                  mealKey,
                  itemId: item.id,
                  fromFood: item.foodName,
                  toFoodId: food.id,
                  toFood: food.originalName,
                  quantity: serving.quantity,
                  unit: serving.unit,
                  delta,
                });
                toast('Substituição registrada como escolha pessoal');
                onClose();
              }}
            >
              Confirmar substituição
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function signed(v: number | null, d = 1) {
  if (v === null) return '—';
  return `${v > 0 ? '+' : ''}${fmtNum(v, d)}`;
}
