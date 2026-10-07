import { useEffect, useRef, useState } from 'react';
import { fetchOutline, postChatStream, resetOutline, type PositionedItem } from './api';

interface Msg {
  id: number;
  kind: 'user' | 'assistant' | 'activity' | 'error';
  text: string;
}

function BotAvatar() {
  return (
    <div
      style={{
        width: 28, height: 28, borderRadius: '50%', background: '#e8eaf0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}
      aria-hidden
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8" width="16" height="12" rx="3" />
        <circle cx="9" cy="14" r="1" fill="#555" />
        <circle cx="15" cy="14" r="1" fill="#555" />
        <path d="M12 8V4M8 4h8" />
      </svg>
    </div>
  );
}

function UserAvatar() {
  return (
    <div
      style={{
        width: 28, height: 28, borderRadius: '50%', background: '#dbe4ff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}
      aria-hidden
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2f6fed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
      </svg>
    </div>
  );
}

const bubbleBase: React.CSSProperties = {
  maxWidth: '80%', padding: '10px 14px', borderRadius: 18, fontSize: 14, lineHeight: 1.45,
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
};

let nextId = 1;

function newThreadId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function App() {
  const [outline, setOutline] = useState<PositionedItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // One thread per page load: the agent remembers across turns (T3.4).
  const [threadId, setThreadId] = useState<string>(() => newThreadId());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOutline()
      .then((items) => {
        if (!cancelled) setOutline(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'failed to load outline');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs]);

  // Fresh data + fresh conversation: the agent's thread memory still
  // references deleted items after a data reset, so the thread must rotate too.
  async function reset(): Promise<void> {
    if (streaming) return;
    if (!window.confirm('Reset the outline to the seed? This also clears the chat.')) return;
    try {
      setOutline(await resetOutline());
      setMsgs([]);
      setThreadId(newThreadId());
    } catch (err: unknown) {
      setMsgs((prev) => [...prev, { id: nextId++, kind: 'error', text: err instanceof Error ? err.message : 'reset failed' }]);
    }
  }

  async function send(): Promise<void> {    const text = input.trim();
    if (text === '' || streaming) return;
    setInput('');
    setStreaming(true);
    const assistantId = nextId++;
    setMsgs((prev) => [...prev, { id: nextId++, kind: 'user', text }, { id: assistantId, kind: 'assistant', text: '' }]);
    const appendToken = (t: string) =>
      setMsgs((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + t } : m)));
    const push = (kind: Msg['kind'], msgText: string) =>
      setMsgs((prev) => [...prev, { id: nextId++, kind, text: msgText }]);
    try {
      await postChatStream(text, threadId, (ev) => {
        switch (ev.type) {
          case 'token':
            appendToken(ev.text);
            break;
          case 'tool_start':
            push('activity', `calling ${ev.name}…`);
            break;
          case 'tool_end':
            push('activity', `done ${ev.name}`);
            break;
          case 'outline':
            setOutline(ev.items);
            break;
          case 'done':
            setThreadId(ev.threadId);
            break;
          case 'error':
            push('error', ev.message);
            break;
        }
      });
    } catch (err: unknown) {
      push('error', err instanceof Error ? err.message : 'chat failed');
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <section style={{ flex: 1, borderRight: '1px solid #ddd', padding: 20, overflowY: 'auto', background: '#efeafa' }}>
        <style>{`.outline-row { transition: background 0.15s ease; } .outline-row:hover { background: #f4f6fd; }`}</style>
        <div style={{ background: '#fff', borderRadius: 20, padding: '20px 16px', boxShadow: '0 8px 24px rgba(80, 60, 160, 0.12)', maxWidth: 520 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Document Outline</h2>
            <button onClick={() => void reset()} disabled={streaming} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #e2e2ea', background: '#fafaff', fontSize: 13, cursor: streaming ? 'default' : 'pointer' }}>
              Reset outline
            </button>
          </div>
          {loadError !== null && <p style={{ color: 'red' }}>Backend unreachable: {loadError}</p>}
          {outline === null && loadError === null && <p>Loading…</p>}
          {outline !== null && outline.length === 0 && <p>Outline is empty.</p>}
          {outline !== null && outline.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {outline.map((item) => (
                <li
                  key={item.id}
                  className="outline-row"
                  style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 14 }}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: '50%', background: '#e7edff', color: '#2f6fed',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0,
                    }}
                  >
                    {item.position}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                    {item.description !== '' && (
                      <div style={{ color: '#777', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.description}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#fff' }}>
        <h2>Chat</h2>
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 4px', marginBottom: 8 }}>
          {msgs.length === 0 && <p style={{ color: '#888' }}>Ask for outline changes in plain English.</p>}
          {msgs.map((m) =>
            m.kind === 'activity' ? (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 4px 36px', color: '#888', fontSize: 13, fontStyle: 'italic' }}>
                {m.text}
              </div>
            ) : m.kind === 'user' ? (
              <div key={m.id} style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-end', margin: '8px 0' }}>
                <div style={{ ...bubbleBase, background: 'linear-gradient(135deg, #2f6fed, #1f4fd8)', color: '#fff', borderBottomRightRadius: 6 }}>
                  {m.text}
                </div>
                <UserAvatar />
              </div>
            ) : (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', margin: '8px 0' }}>
                <BotAvatar />
                <div
                  style={{
                    ...bubbleBase,
                    background: m.kind === 'error' ? '#fdecec' : '#f1f2f6',
                    color: m.kind === 'error' ? '#b3261e' : '#222',
                    borderBottomLeftRadius: 6,
                  }}
                >
                  {m.text}
                </div>
              </div>
            ),
          )}
          {streaming && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 36, color: '#888', fontSize: 13 }}>
              working…
            </div>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #ddd', borderRadius: 999, padding: '6px 6px 6px 16px', background: '#fafbfc' }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={streaming}
            placeholder="Type a message…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14 }}
          />
          <button
            type="submit"
            disabled={streaming || input.trim() === ''}
            aria-label="Send"
            style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: streaming || input.trim() === '' ? 'default' : 'pointer',
              background: streaming || input.trim() === '' ? '#c9ced6' : '#2f6fed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
        <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 6 }}>Powered by Marvin</div>
      </section>
    </div>
  );
}
