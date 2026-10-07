export interface PositionedItem {
  position: number;
  id: string;
  title: string;
  description: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return (await res.json()) as T;
}

// Current outline with 1-indexed positions.
export async function fetchOutline(): Promise<PositionedItem[]> {
  const data = await json<{ items: PositionedItem[] }>(await fetch('/api/outline'));
  return data.items;
}

// Restore the 6-item seed (dev/test helper for re-running the prompt script).
export async function resetOutline(): Promise<PositionedItem[]> {
  const data = await json<{ items: PositionedItem[] }>(await fetch('/api/outline/reset', { method: 'POST' }));
  return data.items;
}

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'outline'; items: PositionedItem[] }
  | { type: 'done'; threadId: string }
  | { type: 'error'; message: string };

// POSTs a chat turn and calls onEvent per SSE frame. Manual framing (not
// EventSource): the endpoint is POST with custom event names.
export async function postChatStream(
  message: string,
  threadId: string,
  onEvent: (ev: ChatStreamEvent) => void,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, threadId }),
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (line !== undefined) onEvent(JSON.parse(line.slice(5)) as ChatStreamEvent);
    }
  }
}
