import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'tram' | 'danger' | 'ghost' | 'soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white lip-brand press',
  secondary: 'bg-white text-ink border-[1.5px] border-line-strong lip-neutral press',
  tram: 'bg-tram text-tram-ink lip-tram press',
  danger: 'bg-coral text-white lip-coral press',
  ghost: 'bg-transparent text-ink hover:bg-black/5',
  soft: 'bg-brand-tint text-brand-ink hover:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px] rounded-xl gap-1.5',
  md: 'h-12 px-5 text-[15px] rounded-2xl gap-2',
  lg: 'h-14 px-6 text-[17px] rounded-[18px] gap-2.5',
};

/** Shared class builder so router links can look exactly like buttons. */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  block = false,
  className?: string,
) {
  return cn(
    'inline-flex select-none items-center justify-center font-bold whitespace-nowrap no-underline transition-colors',
    'disabled:!bg-line disabled:!text-muted disabled:!shadow-none disabled:border-transparent',
    VARIANTS[variant],
    SIZES[size],
    block && 'w-full',
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, iconRight, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, block, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-[1.1em] animate-spin" aria-hidden /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'plain' | 'surface' | 'onDark';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'plain', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors',
        tone === 'plain' && 'text-ink hover:bg-black/5',
        tone === 'surface' && 'bg-white text-ink shadow-[0_4px_14px_rgb(14_26_20/0.14)]',
        tone === 'onDark' && 'text-white hover:bg-white/10',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
