import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type Command = {
  id: string;
  group: string;
  label: string;
  /** Muted text on the right (shortcut, client, status). */
  hint?: string;
  /** Extra words that should match the search. */
  keywords?: string;
  /** Dot colour (client) or an icon. */
  color?: string;
  icon?: ReactNode;
  /** Shown only when the search box is empty (or only when typing). */
  when?: 'empty' | 'query';
  run: () => void;
};

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Ctrl/⌘ + K: search everything and run actions from the keyboard. */
export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const query = norm(q.trim());
    if (!query) return commands.filter((c) => c.when !== 'query');
    const words = query.split(/\s+/);
    return commands
      .filter((c) => c.when !== 'empty')
      .map((c) => {
        const label = norm(c.label);
        const hay = `${label} ${norm(c.hint ?? '')} ${norm(c.keywords ?? '')} ${norm(c.group)}`;
        if (!words.every((w) => hay.includes(w))) return null;
        const score = label.startsWith(query) ? 0 : label.includes(query) ? 1 : 2;
        return { c, score };
      })
      .filter((x): x is { c: Command; score: number } => !!x)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((x) => x.c);
  }, [commands, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // Let the palette close first, so a modal opened by the command gets the focus.
    window.setTimeout(c.run, 0);
  };

  // Group in display order, keeping the global index for keyboard navigation.
  const groups: { name: string; items: { c: Command; i: number }[] }[] = [];
  shown.forEach((c, i) => {
    const g = groups.find((x) => x.name === c.group) ?? groups[groups.push({ name: c.group, items: [] }) - 1];
    g.items.push({ c, i });
  });

  return (
    <div className="overlay palette-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects, tasks, actions…"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[active] ? `pal-${shown[active].id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(shown.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(shown[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {groups.map((g) => (
            <div key={g.name} className="palette-group">
              <div className="palette-group-name">{g.name}</div>
              {g.items.map(({ c, i }) => (
                <div
                  key={c.id}
                  id={`pal-${c.id}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  className={'palette-item' + (i === active ? ' is-active' : '')}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => run(c)}
                >
                  <span className="palette-icon">
                    {c.icon ?? (c.color ? <span className="swatch" style={{ background: c.color }} /> : <span className="swatch" style={{ background: 'var(--line-strong)' }} />)}
                  </span>
                  <span className="palette-label ellipsis">{c.label}</span>
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                </div>
              ))}
            </div>
          ))}
          {shown.length === 0 && <div className="palette-empty">Nothing matches "{q}"</div>}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>N</kbd> new task</span>
          <span><kbd>P</kbd> new project</span>
          <span><kbd>/</kbd> search tasks</span>
        </div>
      </div>
    </div>
  );
}
