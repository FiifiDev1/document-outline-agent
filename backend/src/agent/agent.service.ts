import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { isAIMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { createDeepAgent } from 'deepagents';
import { OutlineStore } from '../outline/outline.store';
import { LlmConfig } from '../config/llm.config';
import { withPositions } from '../common/utils';
import type { PositionedItem } from '../outline/outline.types';
import { SYSTEM_PROMPT } from './system-prompt';
import { createOutlineTools } from './tools';

type CompiledAgent = Awaited<ReturnType<typeof createDeepAgent>>;

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string }
  | { type: 'outline'; items: PositionedItem[] }
  | { type: 'done'; threadId: string };

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private agentPromise?: Promise<CompiledAgent>;

  // NOTE: explicit @Inject (tsx/esbuild drops decorator metadata).
  constructor(
    @Inject(OutlineStore) private readonly store: OutlineStore,
    @Inject(LlmConfig) private readonly llm: LlmConfig,
  ) {}

  // Compiles the graph without calling the model. Useful to fail fast on
  // wiring errors; invoke() calls it implicitly on first use.
  async ready(): Promise<void> {
    await this.agent();
    this.logger.log('agent compiled');
  }

  async invoke(threadId: string, message: string): Promise<{ text: string; outline: PositionedItem[] }> {
    const agent = await this.agent();
    const result = (await agent.invoke(
      { messages: [{ role: 'user', content: message }] },
      { configurable: { thread_id: threadId } },
    )) as { messages: Parameters<typeof isAIMessage>[0][] };
    const ai = [...result.messages].reverse().find((m) => isAIMessage(m));
    const content = ai?.content;
    const text = typeof content === 'string'
      ? content
      : (content ?? []).filter((b): b is { type: 'text'; text: string } => b.type === 'text').map((b) => b.text).join('\n');
    const doc = await this.store.load();
    return { text, outline: withPositions(doc) };
  }

  // Live activity for SSE: token deltas + tool lifecycle, then the fresh
  // outline and done. streamEvents v2 maps 1:1 onto these (no node-update reassembly).
  async *stream(threadId: string, message: string): AsyncGenerator<ChatEvent> {
    const agent = await this.agent();
    const events = agent.streamEvents(
      { messages: [{ role: 'user', content: message }] },
      { configurable: { thread_id: threadId }, version: 'v2' },
    );
    for await (const ev of events) {
      if (ev.event === 'on_chat_model_stream') {
        const chunk = (ev.data as { chunk?: { content?: unknown } }).chunk?.content;
        const text = typeof chunk === 'string'
          ? chunk
          : Array.isArray(chunk)
            ? chunk.filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text').map((b) => b.text).join('')
            : '';
        if (text) yield { type: 'token', text };
      } else if (ev.event === 'on_tool_start') {
        yield { type: 'tool_start', name: String((ev as { name?: unknown }).name ?? 'tool') };
      } else if (ev.event === 'on_tool_end') {
        yield { type: 'tool_end', name: String((ev as { name?: unknown }).name ?? 'tool') };
      }
    }
    const doc = await this.store.load();
    yield { type: 'outline', items: withPositions(doc) };
    yield { type: 'done', threadId };
  }

  // Lazy singleton: createDeepAgent is async, and construction must not
  // require credentials (keeps boot + health checks working without a key).
  private agent(): Promise<CompiledAgent> {
    if (!this.agentPromise) {
      this.agentPromise = this.build().catch((err) => {
        this.agentPromise = undefined;
        throw err;
      });
    }
    return this.agentPromise;
  }

  private async build(): Promise<CompiledAgent> {
    if (!this.llm.apiKey) {
      throw new ServiceUnavailableException('ANTHROPIC_API_KEY is not configured');
    }
    const model = new ChatAnthropic({ apiKey: this.llm.apiKey, model: this.llm.model });
    const tools = createOutlineTools({ store: this.store, model });
    return createDeepAgent({
      model,
      tools,
      systemPrompt: SYSTEM_PROMPT,
      checkpointer: new MemorySaver(),
    });
  }
}
