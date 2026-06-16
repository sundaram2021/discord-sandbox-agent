export async function GET(request: Request) {
  return new Response(JSON.stringify({
    status: "ok",
    has_bot_token: !!process.env.DISCORD_BOT_TOKEN,
    has_public_key: !!process.env.DISCORD_PUBLIC_KEY,
    has_app_id: !!process.env.DISCORD_APPLICATION_ID,
    node_version: process.version,
    env_keys: Object.keys(process.env).filter(key => key.includes("DISCORD") || key.includes("TENSOR") || key.includes("ANTHROPIC")),
  }), {
    status: 200,
    headers: { 
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
  });
}
