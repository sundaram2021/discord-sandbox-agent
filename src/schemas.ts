import { z } from 'zod';

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  sessionId: z.string().optional(),
});

export const ToolInputRunCodeSchema = z.object({
  code: z.string(),
  language: z
    .enum(['python', 'javascript', 'typescript', 'bash'])
    .default('python'),
});

export const ToolInputRunCommandSchema = z.object({
  command: z.string(),
});

export const ToolInputWriteFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export const ToolInputReadFileSchema = z.object({
  path: z.string(),
});

export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking'), content: z.string() }),
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()),
    toolUseId: z.string(),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string(),
    stdout: z.string().default(''),
    stderr: z.string().default(''),
    exitCode: z.number().nullable(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done') }),
]);

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
