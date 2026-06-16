import { Chat } from "chat";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Sandbox } from "tensorlake";
import Anthropic from "@anthropic-ai/sdk";

// Define custom thread state to persist the Sandbox ID across messages in the same thread
interface ThreadState {
  sandboxId?: string;
}

export const bot = new Chat<any, ThreadState>({
  userName: "sandbox-agent",
  adapters: {
    discord: createDiscordAdapter({
      botToken: process.env.DISCORD_BOT_TOKEN!,
      publicKey: process.env.DISCORD_PUBLIC_KEY!,
      applicationId: process.env.DISCORD_APPLICATION_ID!,
    }),
  },
  state: createMemoryState(),
});

// System prompt instructing Claude on how to use the sandbox tools
const SYSTEM_PROMPT = `You are a secure coding sandbox agent. You have access to a stateful Linux sandbox (microVM) where you can write files, execute scripts, and run bash commands.
The user wants you to write code, execute scripts, run calculations, or explore a coding problem.

Follow these instructions to fulfill requests:
1. If the user wants to run Python, Node, or Bash scripts, first write the code to a file using the "write_file" tool.
2. Run the script using the "execute_command" tool (e.g. running "python3" with args=["myscript.py"]).
3. Check the exitCode, stdout, and stderr. If there is an error, analyze it, fix the script using "write_file", and run again.
4. If the user asks for shell command execution directly, run it via "execute_command" (e.g. "curl", "npm install", etc.).
5. Provide a summary of your actions and the stdout/stderr output of the executed scripts in your final reply. Keep your response formatting clean and readable using Discord markdown.

IMPORTANT: You must run code in the sandbox rather than just explaining or dry-running. Verify the output actually works.`;

// Register Mention Handler for new threads
bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(
    `👋 Hello! I am your **Discord Sandbox Agent**, powered by **Tensorlake** and **Claude 3.5 Sonnet**.\n\n` +
    `I have provisioned a secure, isolated microVM sandbox for this thread. You can ask me to write code, install libraries, run scripts, or execute shell commands.\n\n` +
    `*Try: "Write a python script that prints a mandelbrot set and run it."*`
  );
});

// Register Subscribed Message Handler for continuing conversations in threads
bot.onSubscribedMessage(async (thread, message) => {
  // Show typing indicator in Discord
  await thread.startTyping();

  // 1. Get or create a persistent Sandbox for this thread
  let sbx: Sandbox;
  const threadState = await thread.state;
  
  try {
    if (threadState?.sandboxId) {
      console.log(`Connecting to existing sandbox: ${threadState.sandboxId}`);
      sbx = await Sandbox.connect({
        sandboxId: threadState.sandboxId,
        apiKey: process.env.TENSORLAKE_API_KEY!,
      });
    } else {
      console.log("Creating a new sandbox session...");
      sbx = await Sandbox.create({
        apiKey: process.env.TENSORLAKE_API_KEY!,
      });
      await thread.setState({ sandboxId: sbx.sandboxId });
    }
  } catch (error) {
    console.error("Failed to connect/create sandbox, spawning a fresh one:", error);
    sbx = await Sandbox.create({
      apiKey: process.env.TENSORLAKE_API_KEY!,
    });
    await thread.setState({ sandboxId: sbx.sandboxId });
  }

  // 2. Initialize Anthropic Client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!,
  });

  // 3. Prepare the conversation payload
  // We feed the user's prompt into the message history
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: message.text }
  ];

  const tools: Anthropic.Tool[] = [
    {
      name: "write_file",
      description: "Write content to a file in the sandbox filesystem.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path of the file to write (e.g. 'script.py')" },
          content: { type: "string", description: "The full text content to write into the file" }
        },
        required: ["path", "content"]
      }
    },
    {
      name: "read_file",
      description: "Read the text content of a file in the sandbox.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path of the file to read" }
        },
        required: ["path"]
      }
    },
    {
      name: "list_directory",
      description: "List the files and directories inside a path in the sandbox.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to list (defaults to '.')" }
        }
      }
    },
    {
      name: "execute_command",
      description: "Execute a command inside the sandbox bash shell and return stdout, stderr, and exitCode.",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The executable command (e.g. 'python3', 'node', 'bash', 'curl')" },
          args: { type: "array", items: { type: "string" }, description: "Arguments to pass to the command" },
          workingDir: { type: "string", description: "Optional working directory in the sandbox" }
        },
        required: ["command"]
      }
    }
  ];

  try {
    let loopCount = 0;
    const maxLoops = 10;
    let finalResponse = "";

    // Run the agent tool-use loop
    while (loopCount < maxLoops) {
      loopCount++;
      
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: messages,
        tools: tools,
      });

      // Append assistant's thoughts/response to conversation history
      messages.push({
        role: "assistant",
        content: response.content
      });

      // Find any tool calls Claude wants to execute
      const toolCalls = response.content.filter(block => block.type === "tool_use") as Anthropic.ToolUseBlock[];

      if (toolCalls.length === 0) {
        // No more tool calls, Claude is ready with the final answer
        const textBlock = response.content.find(block => block.type === "text") as Anthropic.TextBlock | undefined;
        finalResponse = textBlock?.text || "Execution finished.";
        break;
      }

      // Keep showing typing in Discord as the agent works
      await thread.startTyping();

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      // Execute each tool call inside the secure Tensorlake sandbox
      for (const toolCall of toolCalls) {
        const { name, id } = toolCall;
        const input = toolCall.input as any;
        console.log(`Executing tool inside sandbox: ${name} with inputs:`, input);
        
        try {
          let output: any;
          
          if (name === "write_file") {
            const bytes = new TextEncoder().encode(input.content);
            await sbx.writeFile(input.path, bytes);
            output = { success: true, message: `Successfully wrote file to ${input.path}` };
          } else if (name === "read_file") {
            const bytes = await sbx.readFile(input.path);
            const content = new TextDecoder().decode(bytes);
            output = { success: true, content };
          } else if (name === "list_directory") {
            const path = input.path || ".";
            const dirResult = await sbx.listDirectory(path);
            output = { success: true, path, entries: dirResult.entries };
          } else if (name === "execute_command") {
            const runResult = await sbx.run(input.command, {
              args: input.args || [],
              workingDir: input.workingDir,
            });
            output = {
              exitCode: runResult.exitCode,
              stdout: runResult.stdout,
              stderr: runResult.stderr
            };
          } else {
            output = { error: `Tool ${name} is not implemented.` };
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: JSON.stringify(output)
          });
        } catch (toolErr) {
          const errMessage = toolErr instanceof Error ? toolErr.message : String(toolErr);
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: JSON.stringify({ error: errMessage }),
            is_error: true
          });
        }
      }

      // Feed tool results back to Claude
      messages.push({
        role: "user",
        content: toolResults
      });
    }

    if (finalResponse) {
      await thread.post(finalResponse);
    } else {
      await thread.post("⚠️ The agent hit the tool execution loop limit before finishing.");
    }
  } catch (error) {
    console.error("Error running agent loop:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await thread.post(`❌ An error occurred during agent processing: \`${errorMessage}\``);
  }
});
