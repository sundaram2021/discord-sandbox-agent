import Anthropic from '@anthropic-ai/sdk';
import type { Sandbox } from 'tensorlake';
import { join, basename } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  executeCode,
  executeCommand,
  writeFileToSandbox,
  readFileFromSandbox,
} from './sandbox.ts';

export const SYSTEM_PROMPT = `You are a powerful AI coding assistant with access to a secure sandbox environment. You can execute code, run shell commands, read and write files in an isolated Linux sandbox powered by TensorLake.

When the user asks you to write or run code, use your tools to execute it in the sandbox and show them the results. Be concise and direct. When you think through a problem, structure your reasoning clearly.

Available tools:
- run_code: Execute code in Python, JavaScript, TypeScript, or Bash
- run_command: Run any shell command in the sandbox
- write_file: Write content to a file in the sandbox
- read_file: Read content from a file in the sandbox
- export_file: Export a file from the sandbox VM so the user can download it`;

export const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'run_code',
    description:
      'Execute code in the sandbox. Supports Python, JavaScript, TypeScript, and Bash.',
    input_schema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'The code to execute' },
        language: {
          type: 'string',
          enum: ['python', 'javascript', 'typescript', 'bash'],
          description: 'Programming language',
          default: 'python',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the sandbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the sandbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read content from a file in the sandbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'export_file',
    description:
      'Export a file from the sandbox VM to the host server, making it downloadable for the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path of the file in the sandbox',
        },
      },
      required: ['path'],
    },
  },
];

export async function executeTool(
  sandbox: Sandbox,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}> {
  try {
    switch (toolName) {
      case 'run_code': {
        const code = toolInput['code'] as string;
        const language = (toolInput['language'] as string) ?? 'python';
        return await executeCode(sandbox, code, language);
      }
      case 'run_command': {
        const command = toolInput['command'] as string;
        return await executeCommand(sandbox, command);
      }
      case 'write_file': {
        const path = toolInput['path'] as string;
        const content = toolInput['content'] as string;
        const msg = await writeFileToSandbox(sandbox, path, content);
        return { stdout: msg, stderr: '', exitCode: 0 };
      }
      case 'read_file': {
        const path = toolInput['path'] as string;
        const content = await readFileFromSandbox(sandbox, path);
        return { stdout: content, stderr: '', exitCode: 0 };
      }
      case 'export_file': {
        const path = toolInput['path'] as string;
        const bytes = await sandbox.readFile(path);

        const filename = basename(path);
        const downloadsDir = join(
          import.meta.dirname ?? process.cwd(),
          '..',
          'public',
          'downloads'
        );
        await mkdir(downloadsDir, { recursive: true });

        const localPath = join(downloadsDir, filename);
        await writeFile(localPath, bytes);

        const result = {
          message: 'File exported successfully.',
          downloadUrl: `/downloads/${filename}`,
          filename,
          size: bytes.length,
        };

        return {
          stdout: JSON.stringify(result, null, 2),
          stderr: '',
          exitCode: 0,
        };
      }
      default:
        return {
          stdout: '',
          stderr: `Unknown tool: ${toolName}`,
          exitCode: 1,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: message, exitCode: 1, error: message };
  }
}
