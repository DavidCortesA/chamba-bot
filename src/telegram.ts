const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) throw new Error("Falta TELEGRAM_TOKEN o TELEGRAM_CHAT_ID");

const esc = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendJob(j: {
  title: string;
  company: string;
  url: string;
  score: number;
  reason: string;
  source: string;
}) {
  const text =
    `🦅 <b>${esc(j.title)}</b>\n` +
    `🏢 ${esc(j.company || "—")}\n` +
    `⭐ Score: <b>${j.score}</b>  <i>(${esc(j.reason)})</i>\n` +
    `📡 ${esc(j.source)}`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Ver vacante →", url: j.url }]],
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  }
}

export async function sendText(text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}