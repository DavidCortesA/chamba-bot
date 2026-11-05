import { buildJobMessage, buildKeyboard } from "./format.js";
import type { Settings } from "./settings.js";
import type { JobRow } from "./types.js";

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) throw new Error("Falta TELEGRAM_TOKEN o TELEGRAM_CHAT_ID");

export const ALLOWED_CHAT = String(chatId);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TelegramError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Telegram ${status}: ${body}`);
  }
}

async function api<T = any>(method: string, body: Record<string, unknown> = {}, retry = true): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429 && retry) {
    const data = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
    await sleep(((data.parameters?.retry_after ?? 2) + 1) * 1000);
    return api<T>(method, body, false);
  }
  if (!res.ok) throw new TelegramError(res.status, await res.text());
  return ((await res.json()) as { result: T }).result;
}

// ---------- Envío ----------

export async function sendJob(j: JobRow, settings: Pick<Settings, "stack">) {
  return api("sendMessage", {
    chat_id: chatId,
    text: buildJobMessage(j, settings.stack),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: buildKeyboard(j),
  });
}

/** Mensaje HTML; si pasa de 4096 caracteres lo parte por líneas */
export async function sendHtml(text: string, extra: Record<string, unknown> = {}) {
  const chunks: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > 3800) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) chunks.push(cur);

  for (let i = 0; i < chunks.length; i++) {
    await api("sendMessage", {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: "HTML",
      disable_web_page_preview: true,
      // El teclado/extra solo va en el último trozo
      ...(i === chunks.length - 1 ? extra : {}),
    });
  }
}

export async function sendText(text: string) {
  await api("sendMessage", { chat_id: chatId, text });
}

// ---------- Interacción ----------

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { first_name?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

export async function getUpdates(offset: number, timeoutSec = 0): Promise<TgUpdate[]> {
  try {
    return await api<TgUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSec,
      limit: 100,
      allowed_updates: ["message", "callback_query"],
    });
  } catch (err) {
    // Con un webhook activo (Cloudflare Worker) Telegram rechaza getUpdates.
    // NO lo quitamos solos: así el cron de Actions nunca rompe tu Worker.
    if (err instanceof TelegramError && err.status === 409 && /webhook/i.test(err.body)) {
      throw new Error(
        "Hay un webhook activo (Cloudflare Worker). Usa /setup?delete=1 para quitarlo si quieres usar getUpdates.",
      );
    }
    throw err;
  }
}

export const setWebhook = (url: string, secretToken: string) =>
  api("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    max_connections: 10,
    drop_pending_updates: false,
  });

export const deleteWebhook = () => api("deleteWebhook", { drop_pending_updates: false });

export const answerCallback = (id: string, text: string) =>
  api("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {});

export const editKeyboard = (messageId: number, markup: unknown) =>
  api("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: markup,
  }).catch(() => {}); // "message is not modified" no es un error real

// ---------- Menú de comandos y teclado fijo ----------

export const COMMANDS: [string, string][] = [
  ["top", "🔥 Mejores vacantes ahora"],
  ["buscar", "🔎 Buscar: /buscar react 3000-6000"],
  ["sueldo", "💰 Filtro de sueldo (USD/mes)"],
  ["stack", "🧰 Ver y editar tu stack"],
  ["evitar", "🚫 Tecnologías a penalizar"],
  ["guardadas", "⭐ Vacantes guardadas"],
  ["aplicadas", "✅ Vacantes a las que apliqué"],
  ["stats", "📊 Estadísticas y demanda del mercado"],
  ["config", "⚙️ Tu configuración actual"],
  ["pausa", "⏸ Pausar avisos"],
  ["reanudar", "▶️ Reanudar avisos"],
  ["ayuda", "❓ Ayuda y atajos"],
];

export const setCommands = () =>
  api("setMyCommands", {
    commands: COMMANDS.map(([command, description]) => ({ command, description })),
  });

// Botones fijos junto al teclado (se muestran con /start). El texto se mapea a comandos.
export const QUICK_KEYBOARD = {
  keyboard: [
    [{ text: "🔥 Top" }, { text: "⭐ Guardadas" }, { text: "✅ Aplicadas" }],
    [{ text: "💰 Sueldo" }, { text: "🧰 Stack" }, { text: "📊 Stats" }],
    [{ text: "⚙️ Config" }, { text: "⏸ Pausa" }, { text: "▶️ Reanudar" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const BUTTON_TO_COMMAND: Record<string, string> = {
  "🔥 Top": "/top",
  "⭐ Guardadas": "/guardadas",
  "✅ Aplicadas": "/aplicadas",
  "💰 Sueldo": "/sueldo",
  "🧰 Stack": "/stack",
  "📊 Stats": "/stats",
  "⚙️ Config": "/config",
  "⏸ Pausa": "/pausa",
  "▶️ Reanudar": "/reanudar",
};
