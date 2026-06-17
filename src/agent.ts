import Anthropic from '@anthropic-ai/sdk';
import type { Sandbox } from 'tensorlake';
import { createSandbox, destroySandbox } from './sandbox.ts';
import type { ChatMessage, StreamEvent } from './schemas.ts';
import { SYSTEM_PROMPT, TOOLS, executeTool } from './tools.ts';

const MODEL = 'claude-haiku-4-5-20251001';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;

type EventWriter = (event: StreamEvent) => boolean | void;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn(signal);
    } catch (err) {
      if (signal.aborted) throw err;
      const isRetryable =
        err instanceof Error &&
        (err.name === 'RateLimitError' ||
          err.name === 'APIConnectionError' ||
          err.name === 'APITimeoutError' ||
          err.name === 'InternalServerError' ||
          (err as { status?: number }).status === 429 ||
          (err as { status?: number }).status === 500 ||
          (err as { status?: number }).status === 502 ||
          (err as { status?: number }).status === 503);

      if (!isRetryable || i === MAX_RETRIES - 1) throw err;

      const delay = Math.min(
        BASE_DELAY_MS * 2 ** i + Math.random() * 1000,
        MAX_DELAY_MS
      );
      await sleep(delay);
    }
  }
  throw new Error('unreachable');
}

function buildAnthropicMessages(
  messages: ChatMessage[]
): Anthropic.Messages.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export async function runAgentLoop(
  messages: ChatMessage[],
  write: EventWriter,
  signal?: AbortSignal
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  let sandbox: Sandbox | null = null;
  const safeWrite = (event: StreamEvent): void => {
    try {
      write(event);
    } catch {
      // writer failed, loop will check signal
    }
  };

  try {
    const anthropicMessages = buildAnthropicMessages(messages);
    let continueLoop = true;

    while (continueLoop) {
      if (signal?.aborted) {
        safeWrite({ type: 'done' });
        return;
      }

      const stream = await withRetry(async (abortSignal) => {
        return await client.messages.stream(
          {
            model: MODEL,
            max_tokens: 8192,
            system: SYSTEM_PROMPT,
            messages: anthropicMessages,
            tools: TOOLS,
            thinking: {
              type: 'enabled',
              budget_tokens: 4096,
            },
          },
          { signal: abortSignal }
        );
      }, signal ?? new AbortController().signal);

      const toolCalls: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];

      for await (const event of stream) {
        if (signal?.aborted) {
          safeWrite({ type: 'done' });
          return;
        }

        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if ('thinking' in delta && delta.thinking) {
            safeWrite({ type: 'thinking', content: delta.thinking });
          } else if (delta.type === 'text_delta') {
            safeWrite({ type: 'text', content: delta.text });
          }
        } else if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            toolCalls.push({ id: block.id, name: block.name, input: {} });
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          const existing = toolCalls.find((t) => t.id === block.id);
          if (existing) {
            existing.input = block.input as Record<string, unknown>;
          } else {
            toolCalls.push({
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            });
          }
        }
      }

      if (finalMessage.stop_reason === 'tool_use' && toolCalls.length > 0) {
        if (!sandbox) {
          sandbox = await createSandbox(signal);
        }

        anthropicMessages.push({
          role: 'assistant',
          content: finalMessage.content,
        });

        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

        for (const tool of toolCalls) {
          if (signal?.aborted) {
            safeWrite({ type: 'done' });
            return;
          }

          safeWrite({
            type: 'tool_use',
            toolName: tool.name,
            toolInput: tool.input,
            toolUseId: tool.id,
          });

          const result = await executeTool(sandbox, tool.name, tool.input);

          safeWrite({
            type: 'tool_result',
            toolUseId: tool.id,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            error: result.error,
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: result.stdout || result.stderr || '(no output)',
            is_error: !!result.error,
          });
        }

        anthropicMessages.push({ role: 'user', content: toolResults });
      } else {
        continueLoop = false;
      }
    }

    safeWrite({ type: 'done' });
  } catch (err) {
    if (signal?.aborted) {
      safeWrite({ type: 'done' });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    safeWrite({ type: 'error', message });
  } finally {
    if (sandbox) {
      await destroySandbox(sandbox).catch(() => {});
    }
  }
}
