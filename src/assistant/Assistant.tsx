import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../components/Toast';
import { isoDate } from '../lib/format';
import { getLang, t } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { AppData } from '../types';
import { prepareAction, runReadTool } from './run';
import { isActionTool, isReadTool, type AssistantContext } from './schema';

type Update = (fn: (d: AppData) => AppData) => void;
type ErrorCode = 'limit' | 'not_configured' | 'unauthorized' | 'too_long' | 'generic';

const ERRORS: Record<ErrorCode, string> = {
  limit: 'Daily message limit reached. Try again tomorrow.',
  not_configured: 'The assistant is not set up yet (missing OpenAI key).',
  unauthorized: 'Your session has expired. Reload the page and sign in again.',
  too_long: 'That message is too long. Keep it under 1,000 characters.',
  generic: 'Something went wrong. Try again.',
};

const SUGGESTIONS = [
  'How much did I earn this month?',
  'Which client brings me the most money?',
  'Which invoices are still unpaid?',
  'When is my next URSSAF payment and how much?',
  'What did I work on last week?',
  'Add my Netflix subscription, 13.49 EUR a month',
];

const READ_LABELS: Record<string, string> = {
  search: 'Searched',
  get_overview: 'Big picture',
  get_finances: 'Finances',
  list_transactions: 'Transactions',
  get_client: 'Client',
  get_project: 'Project',
  list_tasks: 'Tasks',
  get_time: 'Time',
  list_subscriptions: 'Subscriptions',
  get_taxes: 'Taxes',
  calculate: 'Calculated',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function errorCode(err: Error | undefined): ErrorCode | null {
  if (!err) return null;
  try {
    const code = (JSON.parse(err.message) as { error?: string }).error;
    if (code && code in ERRORS) return code as ErrorCode;
  } catch {
    /* not one of our JSON errors */
  }
  return 'generic';
}

/** **bold** and line breaks; everything else stays plain text. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((s, i) =>
        s.startsWith('**') && s.endsWith('**') ? <b key={i}>{s.slice(2, -2)}</b> : <Fragment key={i}>{s}</Fragment>,
      )}
    </>
  );
}

type ToolPart = { type: string; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string };
const toolName = (p: { type: string }) => (p.type.startsWith('tool-') ? p.type.slice(5) : '');

/** Chat panel: answers questions about Cockpit's data and carries out tasks after a Confirm click. */
export function Assistant({ data, update }: { data: AppData; update: Update }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Tools run on the newest data, not the data of the render that started the request.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/assistant',
        headers: async (): Promise<Record<string, string>> => {
          const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        body: (): { context: AssistantContext } => {
          const p = dataRef.current.profile;
          return {
            context: { today: isoDate(), weekday: WEEKDAYS[new Date().getDay()], lang: getLang(), currency: p.currency, name: p.name, company: p.company },
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error, stop, setMessages, clearError, addToolOutput } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;
      const name = toolCall.toolName;
      if (isReadTool(name)) {
        void addToolOutput({ tool: name as never, toolCallId: toolCall.toolCallId, output: runReadTool(name, toolCall.input, dataRef.current) as never });
      } else if (isActionTool(name)) {
        // Invalid actions (unknown project, already paid…) go straight back to the model; valid ones wait for Confirm.
        const prepared = prepareAction(name, toolCall.input, dataRef.current);
        if ('error' in prepared) void addToolOutput({ tool: name as never, toolCallId: toolCall.toolCallId, output: { saved: false, error: prepared.error } as never });
      } else {
        void addToolOutput({ tool: name as never, toolCallId: toolCall.toolCallId, output: { error: 'Unknown tool' } as never });
      }
    },
  });

  const busy = status === 'submitted' || status === 'streaming';
  const code = errorCode(error);
  const pending = messages.at(-1)?.parts.some((p) => isActionTool(toolName(p)) && (p as ToolPart).state === 'input-available') ?? false;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  useEffect(() => {
    if (!open) return;
    if (window.matchMedia('(hover: hover)').matches) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || busy || pending) return;
    if (error) clearError();
    void sendMessage({ text: q });
    setInput('');
  };

  const decide = (part: ToolPart, ok: boolean) => {
    const name = toolName(part);
    if (!isActionTool(name)) return;
    if (!ok) {
      void addToolOutput({ tool: name as never, toolCallId: part.toolCallId, output: { saved: false, cancelledByUser: true } as never });
      return;
    }
    const prepared = prepareAction(name, part.input, dataRef.current);
    if ('error' in prepared) {
      void addToolOutput({ tool: name as never, toolCallId: part.toolCallId, output: { saved: false, error: prepared.error } as never });
      return;
    }
    // Undo puts back the lists this action changed, as they were just before it.
    const before = dataRef.current;
    const after = prepared.apply(before);
    const keys = (Object.keys(after) as (keyof AppData)[]).filter((k) => after[k] !== before[k]);
    update(prepared.apply);
    toast(<>{t('Saved:')} <b>{t(prepared.title)}</b></>, {
      tone: 'success',
      undo: () => update((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [k, before[k]])) })),
    });
    void addToolOutput({ tool: name as never, toolCallId: part.toolCallId, output: prepared.result as never });
  };

  const last = messages.at(-1);
  const lastText = last?.role === 'assistant' && last.parts.some((p) => p.type === 'text' && p.text.trim());
  const waiting = busy && !lastText;

  return (
    <>
      <button className={`ai-fab${open ? ' hidden' : ''}`} onClick={() => setOpen(true)} aria-label={t('Assistant')} aria-expanded={open} aria-controls="cockpit-assistant">
        <Sparkle />
        <span>{t('Assistant')}</span>
      </button>

      <section id="cockpit-assistant" className={`ai-panel${open ? ' open' : ''}`} role="dialog" aria-label={t('Assistant')}>
        <header className="ai-head">
          <div>
            <h2>{t('Assistant')}</h2>
            <p className="sub">{t('Ask about your business, or tell it what to add.')}</p>
          </div>
          {messages.length > 0 && (
            <button className="icon-btn ai-icon" onClick={() => { void stop(); setMessages([]); clearError(); }} aria-label={t('New conversation')} title={t('New conversation')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
            </button>
          )}
          <button className="icon-btn ai-icon" onClick={() => setOpen(false)} aria-label={t('Close')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="ai-list" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <div className="ai-suggest">
              <p className="ai-label">{t('Try')}</p>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ai-chip" onClick={() => send(t(s))}>{t(s)}</button>
              ))}
            </div>
          )}
          {messages.map((m) => (
            <Message key={m.id} m={m} data={data} onDecide={decide} />
          ))}
          {waiting && !pending && (
            <div className="ai-wait"><span /><span /><span />{t('Looking at your data…')}</div>
          )}
          {code && <p className="ai-error" role="alert">{t(ERRORS[code])}</p>}
        </div>

        <form className="ai-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <div className="ai-input">
            <label htmlFor="ai-input" className="sr-only">{t('Ask or give a task…')}</label>
            <textarea
              id="ai-input"
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={1000}
              placeholder={pending ? t('Confirm or cancel above first') : t('Ask or give a task…')}
              disabled={pending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            {busy ? (
              <button type="button" className="ai-send" onClick={() => void stop()} aria-label={t('Stop')}>
                <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>
              </button>
            ) : (
              <button type="submit" className="ai-send" disabled={!input.trim() || pending} aria-label={t('Send')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </button>
            )}
          </div>
          <p className="ai-foot">{t('Nothing is changed without your confirmation.')}</p>
        </form>
      </section>
    </>
  );
}

function Message({ m, data, onDecide }: { m: UIMessage; data: AppData; onDecide: (p: ToolPart, ok: boolean) => void }) {
  const reads = m.parts.filter((p) => isReadTool(toolName(p)));
  const out: ReactNode[] = [];
  if (m.role === 'assistant' && reads.length) {
    const names = [...new Set(reads.map((p) => READ_LABELS[toolName(p)] ?? toolName(p)))];
    out.push(<div key="reads" className="ai-reads">{names.map((n) => <span key={n}>{t(n)}</span>)}</div>);
  }
  m.parts.forEach((p, i) => {
    if (p.type === 'text' && p.text.trim()) {
      out.push(<div key={i} className={`ai-msg ${m.role === 'user' ? 'ai-me' : 'ai-bot'}`}><Rich text={p.text.trim()} /></div>);
      return;
    }
    const name = toolName(p);
    if (!isActionTool(name)) return;
    const part = p as unknown as ToolPart;
    if (part.state === 'input-streaming') {
      out.push(<div key={i} className="ai-card muted">{t('Preparing…')}</div>);
      return;
    }
    if (part.state === 'input-available') {
      const prepared = prepareAction(name, part.input, data);
      if ('error' in prepared) return;
      out.push(
        <div key={i} className="ai-card">
          <p className="ai-card-title">{t(prepared.title)}</p>
          <dl>
            {prepared.lines.map(([k, v]) => (
              <Fragment key={k}><dt>{t(k)}</dt><dd>{t(v)}</dd></Fragment>
            ))}
          </dl>
          <div className="ai-card-actions">
            <button className="btn outline sm" onClick={() => onDecide(part, false)}>{t('Cancel')}</button>
            <button className="btn sm" onClick={() => onDecide(part, true)}>{t('Confirm')}</button>
          </div>
        </div>,
      );
      return;
    }
    if (part.state === 'output-available') {
      const o = (part.output ?? {}) as { saved?: boolean; cancelledByUser?: boolean };
      if (o.saved) out.push(<div key={i} className="ai-done ok">✓ {t('Saved')}</div>);
      else if (o.cancelledByUser) out.push(<div key={i} className="ai-done">{t('Cancelled by you')}</div>);
    }
  });
  return <>{out}</>;
}

const Sparkle = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);
