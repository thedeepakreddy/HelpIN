import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Bottom sheet on phones, centred dialog on wider screens. Built on Radix Dialog for focus
 * trapping, Escape to close and screen-reader semantics.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade fixed inset-0 z-50 bg-ink/45 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'animate-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[28px] bg-paper shadow-2xl outline-none',
            'md:inset-auto md:top-1/2 md:left-1/2 md:w-[440px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px]',
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong md:hidden" />
          <div className="flex items-start gap-3 px-5 pt-4 pb-2">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-display text-[22px] leading-tight font-extrabold tracking-tight">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[14px] text-ink-2">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="-mt-1 -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-black/5"
            >
              <X size={22} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <div className="border-t border-line bg-white/70 px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
