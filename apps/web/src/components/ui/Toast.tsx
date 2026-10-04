import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleAlert, Star } from 'lucide-react';
import { cn } from '../../lib/cn';

type ToastTone = 'success' | 'error' | 'karma';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const ICON = { success: CircleCheck, error: CircleAlert, karma: Star };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 3600);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-4"
      >
        {items.map((item) => {
          const Icon = ICON[item.tone];
          return (
            <div
              key={item.id}
              className={cn(
                'animate-fade pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-2xl px-4 py-3 text-[14px] font-bold shadow-[0_12px_32px_-8px_rgb(14_26_20/0.45)]',
                item.tone === 'success' && 'bg-ink text-white',
                item.tone === 'error' && 'bg-coral text-white',
                item.tone === 'karma' && 'bg-tram text-tram-ink',
              )}
            >
              <Icon size={18} className={item.tone === 'success' ? 'text-mint' : undefined} fill={item.tone === 'karma' ? 'currentColor' : 'none'} />
              {item.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
