import { waitUntil } from "@vercel/functions";
import { bot } from "../../src/bot.js";

export const maxDuration = 300; // 5 minutes (standard limit for Vercel functions, adjust if Pro plan allows higher)

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 10 minutes duration for the listener
  const durationMs = 600 * 1000;
  
  // Resolve Vercel URL
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : "http://localhost:3000";
  const webhookUrl = `${baseUrl}/api/webhooks/discord`;

  await bot.initialize();
  const discord = bot.getAdapter("discord");
  
  if (!discord) {
    return new Response("Discord adapter not configured", { status: 500 });
  }

  // Start the gateway listener in the background.
  // We use Vercel's waitUntil to ensure the background task has time to execute even after
  // the HTTP response is sent.
  const listenerPromise = discord.startGatewayListener(
    { 
      waitUntil: (task) => {
        waitUntil(task);
      } 
    },
    durationMs,
    undefined,
    webhookUrl
  );

  // Keep Vercel VM alive for the start of the listener
  waitUntil(listenerPromise);

  return new Response("Gateway listener starting in background.", { status: 200 });
}
