// Cloudflare Worker: recibe los mensajes de Telegram por webhook y responde al instante.
// La búsqueda de vacantes sigue en GitHub Actions (npm run scrape).
//
// Secretos del Worker (Settings → Variables and Secrets):
//   DATABASE_URL, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_SECRET
//   (opcionales) MIN_SCORE, MAX_PER_RUN
//
// Los módulos del bot leen process.env al cargarse, por eso se importan de forma
// dinámica DESPUÉS de copiar los secretos del Worker a process.env.

import type { TgUpdate } from "./telegram.js"; // solo tipo: no carga telegram.ts

type Env = Record<string, unknown>;
type Ctx = { waitUntil(promise: Promise<unknown>): void };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function loadEnv(env: Env) {
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") process.env[k] = v;
  }
}

/** Comparación en tiempo constante para no filtrar el secreto por tiempos de respuesta */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// El esquema se asegura una vez por arranque en frío: así el bot funciona aunque
// le escribas antes de que corra la primera búsqueda en GitHub Actions.
let schemaReady: Promise<void> | null = null;
function ensureSchemaOnce(): Promise<void> {
  schemaReady ??= import("./db.js")
    .then((db) => db.ensureSchema())
    .catch((err) => {
      schemaReady = null; // reintentar en la siguiente petición
      throw err;
    });
  return schemaReady;
}

async function processUpdate(update: TgUpdate) {
  const { handleUpdate } = await import("./commands.js");
  try {
    await ensureSchemaOnce();
    await handleUpdate(update);
  } catch (err) {
    console.error("Error en comando:", err);
    const { sendHtml } = await import("./telegram.js");
    await sendHtml("⚠️ Algo falló procesando eso. Intenta de nuevo.").catch(() => {});
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);
    const secret = typeof env.WEBHOOK_SECRET === "string" ? env.WEBHOOK_SECRET : "";

    // Salud: sirve para comprobar que el Worker está arriba
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("🦅 ChambaBot activo");
    }

    // Registro del webhook (se abre una vez en el navegador):
    //   /setup?key=<WEBHOOK_SECRET>            → conecta Telegram con este Worker
    //   /setup?key=<WEBHOOK_SECRET>&delete=1   → quita el webhook
    if (request.method === "GET" && url.pathname === "/setup") {
      if (!secret || !safeEqual(url.searchParams.get("key") ?? "", secret)) {
        return json({ ok: false, error: "key inválida" }, 401);
      }
      loadEnv(env);
      const tg = await import("./telegram.js");
      if (url.searchParams.get("delete") === "1") {
        await tg.deleteWebhook();
        return json({ ok: true, action: "webhook eliminado" });
      }
      const target = `${url.origin}/webhook`;
      await tg.setWebhook(target, secret);
      await tg.setCommands();
      return json({ ok: true, action: "webhook registrado", url: target });
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      // Telegram manda el secreto que pasamos en setWebhook
      const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
      if (!secret || !safeEqual(header, secret)) return new Response("Unauthorized", { status: 401 });

      let update: TgUpdate;
      try {
        update = (await request.json()) as TgUpdate;
      } catch {
        return new Response("Bad request", { status: 400 });
      }

      loadEnv(env);
      // Respondemos 200 ya (Telegram reintenta si tardamos) y trabajamos en segundo plano
      ctx.waitUntil(processUpdate(update));
      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  },
};
