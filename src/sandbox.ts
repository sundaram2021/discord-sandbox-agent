import { Sandbox } from 'tensorlake';

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const FILE_EXTENSIONS: Record<string, string> = {
  python: '.py',
  javascript: '.js',
  typescript: '.ts',
  bash: '.sh',
};

const RUN_COMMANDS: Record<string, string> = {
  python: 'python3',
  javascript: 'node',
  typescript: 'npx tsx',
  bash: 'bash',
};

const MAX_SANDBOX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withSandboxRetry<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  for (let i = 0; i < MAX_SANDBOX_RETRIES; i++) {
    try {
      return await fn();
    } catch (err) {
      if (signal?.aborted) throw err;
      if (i === MAX_SANDBOX_RETRIES - 1) throw err;
      const delay = 1000 * 2 ** i + Math.random() * 500;
      await sleep(delay);
    }
  }
  throw new Error('unreachable');
}

export async function createSandbox(signal?: AbortSignal): Promise<Sandbox> {
  return withSandboxRetry(async () => {
    const sandbox = await Sandbox.create({
      apiKey: process.env['TENSORLAKE_API_KEY'],
    });
    return sandbox;
  }, signal);
}

export async function executeCode(
  sandbox: Sandbox,
  code: string,
  language: string
): Promise<ExecutionResult> {
  const ext = FILE_EXTENSIONS[language] ?? '.py';
  const runner = RUN_COMMANDS[language] ?? 'python3';
  const filePath = `/tmp/code${ext}`;

  await writeFileToSandbox(sandbox, filePath, code);

  const result = await sandbox.run(`${runner} ${filePath}`, {
    timeout: 60,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function executeCommand(
  sandbox: Sandbox,
  command: string
): Promise<ExecutionResult> {
  const result = await sandbox.run(command, {
    timeout: 60,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

export async function writeFileToSandbox(
  sandbox: Sandbox,
  path: string,
  content: string
): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  await sandbox.writeFile(path, bytes);
  return `File written to ${path}`;
}

export async function readFileFromSandbox(
  sandbox: Sandbox,
  path: string
): Promise<string> {
  const bytes = await sandbox.readFile(path);
  return new TextDecoder().decode(bytes);
}

export async function destroySandbox(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.terminate();
  } catch {
    // ignore cleanup errors
  }
}
