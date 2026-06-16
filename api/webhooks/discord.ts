import { bot } from "../../src/bot";

export async function POST(request: Request) {
  try {
    return await bot.webhooks.discord(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
