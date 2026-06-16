import { Chat } from "chat";
import { createDiscordAdapter } from "@chat-adapter/discord";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Sandbox } from "tensorlake";

export const bot = new Chat({
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

// When the bot is @mentioned in a new thread
bot.onNewMention(async (thread, message) => {
  // Subscribe to the thread to receive subsequent follow-up messages
  await thread.subscribe();
  
  await thread.post(
    `Hello! I'm your Discord Sandbox Agent, powered by Tensorlake. I can run code snippets in a secure, isolated sandbox.\n\nReply to this thread with code or a prompt!`
  );
});

// When a message is sent in an already-subscribed thread
bot.onSubscribedMessage(async (thread, message) => {
  // Show typing indicator in the Discord channel
  await thread.startTyping();
  
  try {
    // Skeleton structure for Tensorlake Sandbox & Anthropic integration:
    // 
    // 1. Initialize Tensorlake Sandbox
    // const sbx = await Sandbox.create({ apiKey: process.env.TENSORLAKE_API_KEY });
    // 
    // 2. Call Anthropic API to decide what code to run
    // ...
    // 
    // 3. Run code inside sandbox
    // const result = await sbx.run("/bin/sh", { args: ["-c", message.text] });
    // await thread.post(`Sandbox Output:\n\`\`\`\n${result.stdout}\n\`\`\``);

    await thread.post(`Received: "${message.text}". Sandbox execution skeleton is ready!`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await thread.post(`Error during execution: ${errorMessage}`);
  }
});
