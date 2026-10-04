import { type HTMLAttributes, type ReactNode, type TextareaHTMLAttributes, type InputHTMLAttributes, useId } from 'react';
import { cn } from '../../lib/cn';
import { tone } from '../../lib/tones';

/* ------------------------------------------------------------------ Hexagons (brand shape) */

export function HexAvatar({
  initials,
  color,
  size = 44,
  className,
  label,
  photo,
}: {
  initials: string;
  color: string;
  size?: number;
  className?: string;
  label?: string;
  /** A profile photo, cropped into the hexagon; initials show until it loads or if it fails. */
  photo?: { thumbUrl: string } | null;
}) {
  const t = tone(color);
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('hex relative inline-flex shrink-0 items-center justify-center overflow-hidden font-extrabold', t.bg, t.fg, className)}
      style={{ width: size, height: Math.round(size * 1.1), fontSize: Math.max(11, size * 0.32) }}
    >
      {initials}
      {photo && (
        <img
          src={photo.thumbUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      )}
    </span>
  );
}

export function AnonymousAvatar({ size = 44 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="hex inline-flex shrink-0 items-center justify-center bg-line text-muted"
      style={{ width: size, height: Math.round(size * 1.1) }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="8" r="5" />
        <path d="M3 22c0-5 4-8 9-8s9 3 9 8z" />
      </svg>
    </span>
  );
}

export function HexTile({
  color,
  size = 44,
  children,
  className,
}: {
  color: string;
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  const t = tone(color);
  return (
    <span
      aria-hidden
      className={cn('hex inline-flex shrink-0 items-center justify-center', t.bg, t.fg, className)}
      style={{ width: size, height: Math.round(size * 1.1) }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Chips */

export type ChipTone = 'brand' | 'tram' | 'sapphire' | 'amber' | 'coral' | 'neutral' | 'solidBrand' | 'solidTram';

const CHIP: Record<ChipTone, string> = {
  brand: 'bg-brand-tint text-brand-ink',
  tram: 'bg-tram-tint text-tram-ink',
  sapphire: 'bg-sapphire-tint text-sapphire-ink',
  amber: 'bg-amber-tint text-amber-ink',
  coral: 'bg-coral-tint text-coral-ink',
  neutral: 'bg-[#EEF0EA] text-ink-2',
  solidBrand: 'bg-brand text-white',
  solidTram: 'bg-tram text-tram-ink',
};

export function Chip({
  tone: t = 'neutral',
  icon,
  children,
  className,
  size = 'sm',
}: {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  size?: 'xs' | 'sm';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-2 py-0.5 text-[11px]',
        CHIP[t],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Surfaces */

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[18px] bg-white lip-card', className)} {...rest} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between">
      <h2 className="font-display text-[19px] font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn('text-[12px] font-extrabold uppercase tracking-[0.06em] text-muted', className)}>
      {children}
    </h2>
  );
}

export function EmptyState({
  title,
  body,
  action,
  art,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  art?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {art}
      <p className="mt-3 font-display text-xl font-bold">{title}</p>
      {body && <p className="mt-1.5 max-w-xs text-[15px] text-ink-2">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-2xl bg-line/70', className)} />;
}

/* ------------------------------------------------------------------ Form fields */

export function TextField({
  label,
  hint,
  error,
  counter,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; counter?: boolean }) {
  const id = useId();
  const len = typeof rest.value === 'string' ? rest.value.length : 0;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 flex justify-between text-[13px] font-bold">
        <span>{label}</span>
        {counter && rest.maxLength && (
          <span className="font-semibold text-muted">
            {len}/{rest.maxLength}
          </span>
        )}
      </label>
      <input
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? `${id}-d` : undefined}
        className={cn(
          'h-13 w-full rounded-2xl border-2 bg-[#F9FAF7] px-4 text-[16px] text-ink placeholder:text-muted/70',
          'transition-colors focus:border-brand focus:bg-white focus:outline-none',
          error ? 'border-coral' : 'border-line',
        )}
        {...rest}
      />
      {(error || hint) && (
        <p id={`${id}-d`} className={cn('mt-1.5 text-[13px]', error ? 'font-semibold text-coral-ink' : 'text-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  const len = typeof rest.value === 'string' ? rest.value.length : 0;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 flex justify-between text-[13px] font-bold">
        <span>{label}</span>
        {rest.maxLength && (
          <span className="font-semibold text-muted">
            {len}/{rest.maxLength}
          </span>
        )}
      </label>
      <textarea
        id={id}
        aria-invalid={!!error || undefined}
        className={cn(
          'min-h-28 w-full resize-none rounded-2xl border-2 bg-[#F9FAF7] p-4 text-[16px] leading-relaxed text-ink placeholder:text-muted/70',
          'transition-colors focus:border-brand focus:bg-white focus:outline-none',
          error ? 'border-coral' : 'border-line',
        )}
        {...rest}
      />
      {(error || hint) && (
        <p className={cn('mt-1.5 text-[13px]', error ? 'font-semibold text-coral-ink' : 'text-muted')}>{error ?? hint}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Segmented control */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex rounded-2xl bg-[#E7EAE2] p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-9 flex-1 rounded-xl text-[14px] font-bold transition-colors',
            o.value === value ? 'bg-white text-ink shadow-[0_1px_0_#D3D7CC]' : 'text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Choice cards */

export function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
  icon,
  disabled,
  type = 'radio',
}: {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  type?: 'radio' | 'checkbox';
}) {
  return (
    <button
      type="button"
      role={type}
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border-2 bg-white p-3.5 text-left transition-colors disabled:opacity-50',
        selected ? 'border-brand' : 'border-white lip-card',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold">{title}</span>
        {description && <span className="mt-0.5 block text-[13px] text-ink-2">{description}</span>}
      </span>
      <span
        aria-hidden
        className={cn(
          'flex size-6 shrink-0 items-center justify-center border-2',
          type === 'radio' ? 'rounded-full' : 'rounded-lg',
          selected ? 'border-brand bg-brand' : 'border-line-strong bg-white',
        )}
      >
        {selected && (type === 'radio' ? <span className="size-2.5 rounded-full bg-white" /> : <CheckMark />)}
      </span>
    </button>
  );
}

export function CheckMark({ className }: { className?: string }) {
  return (
    <svg className={cn('size-3.5', className)} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
