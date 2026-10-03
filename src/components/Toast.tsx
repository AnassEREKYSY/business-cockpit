import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';

type ToastOptions = {
  /** Shows an Undo button; called once if pressed. */
  undo?: () => void;
  tone?: 'default' | 'success' | 'danger';
  /** Milliseconds before it goes away (default 5s, 7s with an Undo button). */
  duration?: number;
};
type Item = ToastOptions & { id: number; message: ReactNode; leaving?: boolean };

const Ctx = createContext<(message: ReactNode, opts?: ToastOptions) => void>(() => {});

/** Small notifications at the bottom of the screen, with an optional Undo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 220);
  }, []);

  const toast = useCallback((message: ReactNode, opts: ToastOptions = {}) => {
    const id = ++seq.current;
    // Keep at most 3 on screen: the oldest goes first.
    setItems((list) => [...list.slice(-2), { id, message, ...opts }]);
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <Toast key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function Toast({ item, onDismiss }: { item: Item; onDismiss: () => void }) {
  const duration = item.duration ?? (item.undo ? 7000 : 4500);
  const [paused, setPaused] = useState(false);
  const left = useRef(duration);
  const started = useRef(Date.now());
  useEffect(() => {
    if (paused || item.leaving) return;
    started.current = Date.now();
    const id = window.setTimeout(onDismiss, left.current);
    return () => {
      window.clearTimeout(id);
      left.current -= Date.now() - started.current;
    };
  }, [paused, item.leaving, onDismiss]);

  return (
    <div
      className={`toast toast-${item.tone ?? 'default'}${item.leaving ? ' is-leaving' : ''}`}
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="toast-icon" aria-hidden="true">
        {item.tone === 'danger' ? '!' : item.undo ? '↺' : '✓'}
      </span>
      <span className="toast-msg">{item.message}</span>
      {item.undo && (
        <button
          className="toast-undo"
          onClick={() => {
            item.undo?.();
            onDismiss();
          }}
        >
          {t('Undo')}
        </button>
      )}
      <button className="toast-x" onClick={onDismiss} aria-label={t('Dismiss')}>×</button>
      <span className="toast-bar" style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
    </div>
  );
}

export const useToast = () => useContext(Ctx);
