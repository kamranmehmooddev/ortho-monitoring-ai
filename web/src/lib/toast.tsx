import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import clsx from 'clsx';

interface Toast { id: number; tone: 'success' | 'error'; title: string; body?: string }
const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
let n = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++n;
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-40px)]" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="card shadow-pop px-4 py-3 flex gap-3 animate-in">
            {t.tone === 'success' ? <CheckCircle2 className="h-5 w-5 text-stable shrink-0" /> : <AlertTriangle className="h-5 w-5 text-urgent shrink-0" />}
            <div className="min-w-0 flex-1"><div className="font-medium text-sm">{t.title}</div>{t.body && <div className={clsx('text-xs text-ink-3 mt-0.5 whitespace-pre-line')}>{t.body}</div>}</div>
            <button className="text-ink-4 hover:text-ink" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => {
  const push = useContext(Ctx);
  return { success: (title: string, body?: string) => push({ tone: 'success', title, body }), error: (title: string, body?: string) => push({ tone: 'error', title, body }) };
};
