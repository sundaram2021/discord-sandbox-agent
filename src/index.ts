import fs from "node:fs";
import path from "node:path";
import { bot } from "./bot.js";

// Manually parse .env file if it exists to avoid external dotenv dependency
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...values] = trimmed.split("=");
        if (key && values.length > 0) {
          const envKey = key.trim();
          const envVal = values.join("=").trim();
          // Remove quotes if present
          const cleanVal = envVal.replace(/^['"]|['"]$/g, "");
          process.env[envKey] = cleanVal;
        }
      }
    }
  }
} catch (error) {
  console.warn("Could not load .env file dynamically:", error);
}

async function main() {
  console.log("Initializing Discord Sandbox Agent...");
  
  // Initialize the Chat instance and all registered adapters
  await bot.initialize();
  console.log("Bot initialized successfully.");

  const discord = bot.getAdapter("discord");
  if (!discord) {
    throw new Error("Discord adapter not configured");
  }

  console.log("Starting local Discord Gateway WebSocket listener...");
  console.log("Bot username: " + bot.getUserName());
  console.log("Press Ctrl+C to stop.");

  // Start the Gateway listener in-process for local testing.
  // By not passing a webhook URL, events will be handled locally.
  const durationMs = 24 * 60 * 60 * 1000; // 24 hours
  await discord.startGatewayListener({
    waitUntil: (task) => task, // mock waitUntil for local development
  }, durationMs);
}

main().catch((error) => {
  console.error("Failed to start bot:", error);
  process.exit(1);
});