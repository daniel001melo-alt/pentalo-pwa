import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { VALIDATION_LABEL, type Modality, type SourceReference, type ValidationStatus } from '../domain/schemas';
import { describeSource } from '../import/crossCheck';
import { MODALITY_LABEL } from '../import/sessionText';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Card({ children, className, onClick, as = 'div' }: { children: ReactNode; className?: string; onClick?: () => void; as?: 'div' | 'section' }) {
  const Tag = as;
  return (
    <Tag className={cx('card', onClick && 'cursor-pointer active:opacity-90', className)} onClick={onClick}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}

export function ProgressBar({ value, label, tone = 'accent' }: { value: number | null; label: string; tone?: 'accent' | 'ok' | 'warn' | 'natacao' }) {
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  const color = { accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', natacao: 'bg-m-natacao' }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(v * 100)}
      className="h-2.5 w-full overflow-hidden rounded-full bg-surface2"
    >
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Ring({ value, size = 64, label, sub }: { value: number | null; size?: number; label: string; sub?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="flex flex-col items-center gap-1" aria-label={`${label}: ${value === null ? 'não aplicável' : Math.round(v * 100) + '%'}`} role="img">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--surface2))" strokeWidth={7} />
        {value !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgb(var(--accent))"
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${c * v} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" className="fill-ink text-[15px] font-bold">
          {value === null ? '—' : `${Math.round(v * 100)}%`}
        </text>
      </svg>
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </div>
  );
}

const MOD_ICON: Record<Modality, string> = {
  corrida: '🏃',
  natacao: '🏊',
  forca: '🏋️',
  granada: '💣',
  tiro: '🎯',
  ppm: '🧗',
  pnu: '🤿',
  mobilidade: '🧘',
  competicao: '🏅',
  outro: '•',
};

/** Classes literais (o Tailwind só gera classes que aparecem escritas no código). */
export const MOD_CLASS: Record<Modality, { tag: string; bar: string; dot: string }> = {
  corrida: { tag: 'border-m-corrida/40 bg-m-corrida/10 text-m-corrida', bar: 'bg-m-corrida', dot: 'bg-m-corrida' },
  natacao: { tag: 'border-m-natacao/40 bg-m-natacao/10 text-m-natacao', bar: 'bg-m-natacao', dot: 'bg-m-natacao' },
  forca: { tag: 'border-m-forca/40 bg-m-forca/10 text-m-forca', bar: 'bg-m-forca', dot: 'bg-m-forca' },
  granada: { tag: 'border-m-granada/40 bg-m-granada/10 text-m-granada', bar: 'bg-m-granada', dot: 'bg-m-granada' },
  tiro: { tag: 'border-m-tiro/40 bg-m-tiro/10 text-m-tiro', bar: 'bg-m-tiro', dot: 'bg-m-tiro' },
  ppm: { tag: 'border-m-ppm/40 bg-m-ppm/10 text-m-ppm', bar: 'bg-m-ppm', dot: 'bg-m-ppm' },
  pnu: { tag: 'border-m-pnu/40 bg-m-pnu/10 text-m-pnu', bar: 'bg-m-pnu', dot: 'bg-m-pnu' },
  mobilidade: { tag: 'border-m-mobilidade/40 bg-m-mobilidade/10 text-m-mobilidade', bar: 'bg-m-mobilidade', dot: 'bg-m-mobilidade' },
  competicao: { tag: 'border-m-competicao/40 bg-m-competicao/10 text-m-competicao', bar: 'bg-m-competicao', dot: 'bg-m-competicao' },
  outro: { tag: 'border-m-outro/40 bg-m-outro/10 text-m-outro', bar: 'bg-m-outro', dot: 'bg-m-outro' },
};

export function modalityIcon(m: Modality) {
  return MOD_ICON[m];
}

export function ModalityTag({ modality, small }: { modality: Modality; small?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 font-semibold', small ? 'text-[11px]' : 'text-[12px]', MOD_CLASS[modality].tag)}>
      <span aria-hidden>{MOD_ICON[modality]}</span>
      {MODALITY_LABEL[modality]}
    </span>
  );
}

const STATUS_TONE: Record<ValidationStatus, string> = {
  ok: 'border-ok/40 text-ok',
  nao_informado: 'border-line text-muted',
  requer_validacao: 'border-warn/50 text-warn',
  inconsistente: 'border-bad/50 text-bad',
  configuravel: 'border-accent/50 text-accent',
  estimativa: 'border-warn/50 text-warn',
  calculado: 'border-m-natacao/50 text-m-natacao',
};
const STATUS_SYMBOL: Record<ValidationStatus, string> = {
  ok: '✓',
  nao_informado: '∅',
  requer_validacao: '?',
  inconsistente: '!',
  configuravel: '⚙',
  estimativa: '≈',
  calculado: 'Σ',
};

export function StatusBadge({ status }: { status: ValidationStatus }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[status])}>
      <span aria-hidden>{STATUS_SYMBOL[status]}</span>
      {VALIDATION_LABEL[status]}
    </span>
  );
}

/** Mostra a origem de um dado (arquivo › aba › célula) com valor original/normalizado. */
export function SourceInfo({ source, compact }: { source?: SourceReference; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!source) return null;
  return (
    <span className="inline-block">
      <button type="button" className="text-[11px] text-muted underline decoration-dotted underline-offset-2" onClick={(e) => (e.stopPropagation(), setOpen(!open))} aria-expanded={open}>
        {compact ? 'origem' : describeSource(source)}
      </button>
      {open && (
        <span className="mt-1 block rounded-lg bg-surface2 p-2 text-[12px] leading-snug text-ink">
          <b>Arquivo:</b> {source.fileName}
          <br />
          {source.sheet && (
            <>
              <b>Aba:</b> {source.sheet}{' '}
              {source.cell && (
                <>
                  · <b>Célula/linha:</b> {source.cell}
                </>
              )}
              <br />
            </>
          )}
          {source.original !== undefined && (
            <>
              <b>Valor original:</b> {fmtVal(source.original)}
              <br />
            </>
          )}
          {source.normalized !== undefined && (
            <>
              <b>Normalizado:</b> {fmtVal(source.normalized)}
              <br />
            </>
          )}
          <b>Status:</b> {VALIDATION_LABEL[source.status]}
          {source.note && (
            <>
              <br />
              <b>Nota:</b> {source.note}
            </>
          )}
        </span>
      )}
    </span>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'vazio';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto rounded-xl bg-surface2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('min-h-[40px] flex-1 whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="sheet-enter pb-safe max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-bg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
          <h2 className="pr-2 text-[17px] font-bold leading-tight">{title}</h2>
          <button className="btn-ghost min-h-[40px] px-3" onClick={onClose} aria-label="Fechar">
            Fechar
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      <div className="space-y-4 text-[15px]">
        <div>{message}</div>
        {children}
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Cancelar
          </button>
          <button className={cx(danger ? 'btn-danger' : 'btn-primary', 'flex-1')} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl2 border border-dashed border-line p-6 text-center text-muted">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-[14px]">{children}</div>}
    </div>
  );
}

export function NotInformed({ label = 'Não informado' }: { label?: string }) {
  return <span className="italic text-muted">{label}</span>;
}

export function Field({ label, value, source }: { label: string; value: ReactNode | null | undefined; source?: SourceReference }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium text-muted">{label}</dt>
      <dd className="text-[15px] font-semibold leading-snug">{empty ? <NotInformed /> : value}</dd>
      {source && <SourceInfo source={source} compact />}
    </div>
  );
}

// ───────────────────────── Toasts (feedback imediato) ─────────────────────────

interface ToastMsg {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
const ToastCtx = createContext<(text: string, action?: ToastMsg['action']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const push = useCallback((text: string, action?: ToastMsg['action']) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, action }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4" style={{ bottom: 'calc(6rem + var(--safe-bottom))' }}>
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-ink px-4 py-3 text-[14px] font-medium text-bg shadow-lg">
            <span>{t.text}</span>
            {t.action && (
              <button
                className="font-bold underline"
                onClick={() => {
                  t.action!.run();
                  setItems((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

export function Scale({
  value,
  onChange,
  label,
  max = 5,
  min = 1,
  lowLabel,
  highLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  max?: number;
  min?: number;
  lowLabel?: string;
  highLabel?: string;
}) {
  const opts = [];
  for (let i = min; i <= max; i++) opts.push(i);
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex gap-1">
        {opts.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            aria-label={`${label}: ${n}`}
            onClick={() => onChange(value === n ? null : n)}
            className={cx('min-h-[40px] flex-1 rounded-lg border text-[14px] font-bold', value === n ? 'border-accent bg-accent text-accentInk' : 'border-line bg-surface')}
          >
            {n}
          </button>
        ))}
      </div>
      {(lowLabel || highLabel) && (
        <div className="mt-0.5 flex justify-between text-[11px] text-muted">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </fieldset>
  );
}
