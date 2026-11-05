import {
  countJobs,
  getJob,
  getSettings,
  getState,
  getStats,
  markNotified,
  pendingFilter,
  queryJobs,
  rescore,
  resetSettingsKeys,
  salaryFilterOf,
  setState,
  setStatus,
  updateSettings,
} from "./db.js";
import { buildKeyboard, esc, formatCompactLine } from "./format.js";
import { formatAnnualRange, parseSalaryArg } from "./salary.js";
import { hasSalaryFilter, type Settings } from "./settings.js";
import { avoidTerms, patternFromTerms, type StackItem } from "./stack.js";
import {
  ALLOWED_CHAT,
  BUTTON_TO_COMMAND,
  QUICK_KEYBOARD,
  answerCallback,
  editKeyboard,
  getUpdates,
  sendHtml,
  sendJob,
  type TgUpdate,
} from "./telegram.js";
import type { JobRow, JobStatus } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const YES = /^(si|sí|s|on|true|1|yes|y|incluir)$/i;
const NO = /^(no|n|off|false|0|nel|excluir)$/i;

// ---------- Ayuda ----------

const HELP = `🦅 <b>ChambaBot</b> — tu radar de chambas remotas

<b>🔎 Vacantes</b>
/top [n] — mejores vacantes de los últimos 7 días
/buscar react 3000-6000 — texto y/o rango de sueldo (USD/mes)
   <i>(escribir texto suelto también busca)</i>
/guardadas · /aplicadas — tus listas (abre una con /ver_ID)

<b>💰 Filtros de avisos</b>
/sueldo 3000-6000 — solo avisar dentro del rango (USD/mes; agrega <i>anual</i> para anual)
/sueldo off — quitar filtro
/sinsueldo si|no — ¿avisar vacantes sin sueldo publicado?
/minscore 8 — puntaje mínimo · /lote 10 — máximo por ejecución
/ubicacion on|off — descartar vacantes restringidas a otras regiones

<b>🧰 Tu stack</b>
/stack — ver tu stack y pesos
/stack add rust 3 · /stack add nestjs|nest.js 2
/stack remove vue · /stack peso react 4
/stack set react 3, next.js 3, typescript 2
/stack reset
/evitar add php · /evitar remove php · /evitar reset

<b>⚙️ Control</b>
/stats · /config · /pausa · /reanudar

En cada vacante: ⭐ Guardar · ✅ Apliqué · 🙈 Descartar`;

async function cmdHelp() {
  await sendHtml(HELP, { reply_markup: QUICK_KEYBOARD });
}

// ---------- Utilidades de presentación ----------

const salaryFilterText = (s: Settings) =>
  hasSalaryFilter(s)
    ? formatAnnualRange(s.minSalaryAnnual, s.maxSalaryAnnual) +
      (s.includeNoSalary ? " · incluye vacantes sin sueldo" : " · solo con sueldo")
    : "sin filtro";

const fmtWeight = (w: number) => (w > 0 ? `+${w}` : String(w));

function stackText(s: Settings): string {
  const items = [...s.stack].sort((a, b) => b.weight - a.weight);
  return items.length
    ? items.map((i) => `• ${esc(i.name)} <b>${fmtWeight(i.weight)}</b>`).join("\n")
    : "<i>(vacío)</i>";
}

/** Tras cambiar reglas: recalcula puntajes y avisa cuántas vacantes quedan pendientes */
async function afterScoringChange(s: Settings): Promise<string> {
  const { updated, pending } = await rescore(s);
  return `Re-puntué ${updated} vacantes recientes · ${pending} pendientes de avisar (≥ ${s.minScore}).`;
}

// ---------- /config ----------

async function cmdConfig() {
  const s = await getSettings();
  await sendHtml(
    `⚙️ <b>Configuración</b>\n\n` +
      `${s.paused ? "⏸ <b>Avisos en pausa</b>" : "▶️ Avisos activos"}\n` +
      `🎯 Puntaje mínimo: <b>${s.minScore}</b> · máx. por ejecución: <b>${s.maxPerRun}</b>\n` +
      `💰 Sueldo: ${esc(salaryFilterText(s))}\n` +
      `📍 Filtro de ubicación estricto: <b>${s.strictLocation ? "sí" : "no"}</b>\n\n` +
      `🧰 <b>Stack</b>\n${stackText(s)}\n\n` +
      `🚫 <b>Evitar</b> (-3): ${s.avoid.length ? esc(s.avoid.join(", ")) : "<i>nada</i>"}`,
  );
}

// ---------- /stack y /evitar ----------

/** "next.js 3" | "nestjs|nest.js:2" → alias + peso opcional (-5…5) */
function parseNameWeight(raw: string): { aliases: string[]; weight: number | null } {
  const m = raw.trim().match(/^(.*?)(?:\s+|:)(-?\d+)$/);
  const name = m ? m[1] : raw.trim();
  return {
    aliases: name.split("|").map((a) => a.trim()).filter(Boolean),
    weight: m ? clamp(Number(m[2]), -5, 5) : null,
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function cmdStack(args: string) {
  const s = await getSettings();
  const [subRaw = "", ...tokens] = args.trim().split(/\s+/);
  const sub = subRaw.toLowerCase();
  const rest = tokens.join(" ");

  const save = async (stack: StackItem[], message: string) => {
    const next = await updateSettings({ stack });
    await sendHtml(`${message}\n${await afterScoringChange(next)}`);
  };

  switch (sub) {
    case "":
    case "list":
    case "ver":
      return sendHtml(
        `🧰 <b>Tu stack</b> (suma puntos al match)\n${stackText(s)}\n\n` +
          `<i>/stack add rust 3 · /stack remove vue · /stack peso react 4 · /stack set … · /stack reset</i>`,
      );

    case "add":
    case "agregar": {
      const { aliases, weight } = parseNameWeight(rest);
      if (!aliases.length) return sendHtml("Uso: <code>/stack add rust 3</code> (el peso es opcional, por defecto 2)");
      const item: StackItem = {
        name: aliases[0],
        weight: weight ?? 2,
        pattern: patternFromTerms(aliases),
      };
      const stack = s.stack.filter((i) => !sameName(i.name, item.name)).concat(item);
      return save(stack, `✅ <b>${esc(item.name)}</b> ${fmtWeight(item.weight)} en tu stack.`);
    }

    case "remove":
    case "rm":
    case "quitar": {
      if (!rest) return sendHtml("Uso: <code>/stack remove vue</code>");
      const exact = s.stack.filter((i) => sameName(i.name, rest));
      const victims = exact.length
        ? exact
        : s.stack.filter((i) => i.name.toLowerCase().includes(rest.toLowerCase()));
      if (!victims.length) return sendHtml(`No encontré «${esc(rest)}» en tu stack.`);
      const stack = s.stack.filter((i) => !victims.includes(i));
      return save(stack, `🗑 Quité: ${esc(victims.map((v) => v.name).join(", "))}.`);
    }

    case "peso":
    case "weight": {
      const { aliases, weight } = parseNameWeight(rest);
      if (!aliases.length || weight == null) return sendHtml("Uso: <code>/stack peso react 4</code> (de -5 a 5)");
      const target = s.stack.find((i) => sameName(i.name, aliases[0]));
      if (!target) return sendHtml(`No encontré «${esc(aliases[0])}». Agrégalo con /stack add.`);
      const stack = s.stack.map((i) => (i === target ? { ...i, weight } : i));
      return save(stack, `⚖️ <b>${esc(target.name)}</b> ahora vale ${fmtWeight(weight)}.`);
    }

    case "set": {
      const items = rest
        .split(",")
        .map((part) => parseNameWeight(part))
        .filter((p) => p.aliases.length);
      if (!items.length) return sendHtml("Uso: <code>/stack set react 3, next.js 3, typescript 2</code>");
      const stack = items.map((p) => ({
        name: p.aliases[0],
        weight: p.weight ?? 2,
        pattern: patternFromTerms(p.aliases),
      }));
      return save(stack, `🧰 Stack reemplazado con ${stack.length} tecnologías.`);
    }

    case "reset": {
      const next = await resetSettingsKeys(["stack"]);
      return sendHtml(`↩️ Stack restaurado al original.\n${await afterScoringChange(next)}`);
    }

    default:
      return sendHtml("No entendí. Usa <code>/stack</code>, <code>add</code>, <code>remove</code>, <code>peso</code>, <code>set</code> o <code>reset</code>.");
  }
}

async function cmdAvoid(args: string) {
  const s = await getSettings();
  const [subRaw = "", ...tokens] = args.trim().split(/\s+/);
  const sub = subRaw.toLowerCase();
  const rest = tokens.join(" ").trim();

  const save = async (avoid: string[], message: string) => {
    const next = await updateSettings({ avoid });
    await sendHtml(`${message}\n${await afterScoringChange(next)}`);
  };

  switch (sub) {
    case "":
    case "list":
    case "ver":
      return sendHtml(
        `🚫 <b>Tecnologías que penalizan</b> (-3 si aparecen)\n` +
          (s.avoid.length ? s.avoid.map((a) => `• ${esc(a)}`).join("\n") : "<i>nada</i>") +
          `\n\n<i>/evitar add php · /evitar add vue|vuejs · /evitar remove php · /evitar reset</i>`,
      );

    case "add":
    case "agregar": {
      if (!rest) return sendHtml("Uso: <code>/evitar add php</code> (alias con |)");
      const entry = avoidTerms(rest).join("|");
      const avoid = s.avoid.filter((a) => !sameName(avoidTerms(a)[0] ?? "", avoidTerms(entry)[0])).concat(entry);
      return save(avoid, `🚫 Ahora penalizo <b>${esc(entry)}</b>.`);
    }

    case "remove":
    case "rm":
    case "quitar": {
      const victims = s.avoid.filter((a) => avoidTerms(a).some((t) => sameName(t, rest)));
      if (!rest || !victims.length) return sendHtml(`No encontré «${esc(rest)}» en la lista.`);
      return save(s.avoid.filter((a) => !victims.includes(a)), `🗑 Quité: ${esc(victims.join(", "))}.`);
    }

    case "reset": {
      const next = await resetSettingsKeys(["avoid"]);
      return sendHtml(`↩️ Lista restaurada.\n${await afterScoringChange(next)}`);
    }

    default:
      return sendHtml("Usa <code>/evitar</code>, <code>add</code>, <code>remove</code> o <code>reset</code>.");
  }
}

// ---------- Filtros ----------

async function cmdSalary(args: string) {
  const s = await getSettings();
  const arg = args.trim().toLowerCase();

  if (!arg) {
    return sendHtml(
      `💰 Filtro de sueldo: <b>${esc(salaryFilterText(s))}</b>\n\n` +
        `Ejemplos:\n<code>/sueldo 3000-6000</code> (USD por mes)\n<code>/sueldo 4000+</code>\n` +
        `<code>/sueldo 40k-80k anual</code>\n<code>/sueldo off</code>`,
    );
  }

  if (/^(off|quitar|reset|no|sin|ninguno)$/.test(arg)) {
    await updateSettings({ minSalaryAnnual: null, maxSalaryAnnual: null });
    return sendHtml("💰 Filtro de sueldo desactivado.");
  }

  const parsed = parseSalaryArg(arg, { allowBare: true });
  if (!parsed) return sendHtml("No entendí el rango. Ejemplo: <code>/sueldo 3000-6000</code>");

  const next = await updateSettings({
    minSalaryAnnual: parsed.range.minAnnual,
    maxSalaryAnnual: parsed.range.maxAnnual,
  });
  const pending = await countJobs(pendingFilter(next));
  await sendHtml(
    `💰 Listo: <b>${esc(salaryFilterText(next))}</b>\n` +
      `${pending} vacantes pendientes cumplen. ` +
      (next.includeNoSalary
        ? "Las que no publican sueldo también te llegan (/sinsueldo no para excluirlas)."
        : "Solo te avisaré de las que publican sueldo."),
  );
}

async function cmdNoSalary(args: string) {
  const arg = args.trim();
  if (YES.test(arg) || NO.test(arg)) {
    const include = YES.test(arg);
    await updateSettings({ includeNoSalary: include });
    return sendHtml(
      include
        ? "✅ Incluyo vacantes sin sueldo publicado (cuando hay filtro de sueldo)."
        : "🚫 Con filtro de sueldo, solo vacantes que publican sueldo.",
    );
  }
  const s = await getSettings();
  await sendHtml(
    `Vacantes sin sueldo publicado: <b>${s.includeNoSalary ? "incluidas" : "excluidas"}</b>\n` +
      `Cambia con <code>/sinsueldo si</code> o <code>/sinsueldo no</code>.\n` +
      `<i>Solo aplica si tienes un /sueldo activo.</i>`,
  );
}

async function cmdMinScore(args: string) {
  const n = parseInt(args, 10);
  if (Number.isNaN(n)) return sendHtml("Uso: <code>/minscore 8</code>");
  const next = await updateSettings({ minScore: clamp(n, -10, 40) });
  const pending = await countJobs(pendingFilter(next));
  await sendHtml(`🎯 Puntaje mínimo: <b>${next.minScore}</b> · ${pending} vacantes pendientes lo cumplen.`);
}

async function cmdBatch(args: string) {
  const n = parseInt(args, 10);
  if (Number.isNaN(n)) return sendHtml("Uso: <code>/lote 10</code>");
  const next = await updateSettings({ maxPerRun: clamp(n, 1, 30) });
  await sendHtml(`📦 Máximo por ejecución: <b>${next.maxPerRun}</b>`);
}

async function cmdLocation(args: string) {
  const arg = args.trim();
  if (!YES.test(arg) && !NO.test(arg)) {
    const s = await getSettings();
    return sendHtml(
      `📍 Filtro de ubicación estricto: <b>${s.strictLocation ? "activo" : "apagado"}</b>\n` +
        `Descarta vacantes cuyo campo de ubicación no sea Worldwide/LATAM/Américas/México.\n` +
        `Cambia con <code>/ubicacion on</code> u <code>off</code>.`,
    );
  }
  const next = await updateSettings({ strictLocation: YES.test(arg) });
  await sendHtml(
    `📍 Ubicación estricta: <b>${next.strictLocation ? "activa" : "apagada"}</b>\n${await afterScoringChange(next)}`,
  );
}

async function cmdPause(pause: boolean) {
  await updateSettings({ paused: pause });
  await sendHtml(
    pause
      ? "⏸ Avisos en pausa. Sigo guardando vacantes; /reanudar para continuar."
      : "▶️ Avisos reanudados.",
  );
}

// ---------- Consultas ----------

async function sendCards(jobs: JobRow[], s: Settings) {
  for (let i = 0; i < jobs.length; i++) {
    await sendJob(jobs[i], s);
    if (i < jobs.length - 1) await sleep(1100); // límite de Telegram
  }
}

async function cmdTop(args: string) {
  const s = await getSettings();
  const n = clamp(parseInt(args, 10) || 5, 1, 10);
  const jobs = await queryJobs({
    minScore: s.minScore,
    statuses: ["new", "saved"],
    sinceDays: 7,
    salary: salaryFilterOf(s),
    order: "score",
    limit: n,
  });
  if (!jobs.length) {
    return sendHtml(
      `Sin vacantes ≥ ${s.minScore} en los últimos 7 días con tus filtros.\nPrueba /minscore o /sueldo off.`,
    );
  }
  await sendHtml(`🔥 <b>Top ${jobs.length}</b> de los últimos 7 días`);
  await sendCards(jobs, s);
  await markNotified(jobs.map((j) => j.id));
}

async function cmdSearch(args: string) {
  const parsed = parseSalaryArg(args);
  // Un "18-20" suelto no es un sueldo: exigimos al menos ~$100/mes
  const range =
    parsed && (parsed.range.minAnnual ?? parsed.range.maxAnnual ?? 0) >= 1200 ? parsed.range : null;
  const text = range ? parsed!.rest : args;
  const words = text.split(/\s+/).filter(Boolean).slice(0, 6);

  if (!words.length && !range) {
    return sendHtml(
      "Uso: <code>/buscar react 3000-6000</code>\nTexto y/o rango de sueldo (USD/mes). Con <i>anual</i> el rango es anual.",
    );
  }

  const jobs = await queryJobs({
    words,
    sinceDays: 30,
    salary: range ? { ...range, includeUnknown: false } : null,
    order: "relevance",
    limit: 10,
  });

  const label = [
    words.length ? `«${esc(words.join(" "))}»` : "",
    range ? `💰 ${esc(formatAnnualRange(range.minAnnual, range.maxAnnual).split(" (")[0])}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (!jobs.length) return sendHtml(`🔎 Sin resultados para ${label} en los últimos 30 días.`);
  await sendHtml(
    `🔎 <b>${jobs.length}</b> resultados para ${label}\n\n` +
      jobs.map((j, i) => formatCompactLine(j, i + 1)).join("\n"),
  );
}

async function cmdList(status: JobStatus, title: string, emptyHint: string) {
  const jobs = await queryJobs({ statuses: [status], includeBlocked: true, order: "recent", limit: 20 });
  if (!jobs.length) return sendHtml(`${title}\n\n<i>${emptyHint}</i>`);
  await sendHtml(
    `${title} (${jobs.length})\n\n` + jobs.map((j, i) => formatCompactLine(j, i + 1)).join("\n"),
  );
}

async function cmdView(id: number) {
  const [job, s] = await Promise.all([getJob(id), getSettings()]);
  if (!job) return sendHtml("No encontré esa vacante.");
  await sendJob(job, s);
}

async function cmdStats() {
  const s = await getSettings();
  const st = await getStats(s);
  const t = st.totals;
  const pctSalary = t.total ? Math.round((t.with_salary / t.total) * 100) : 0;

  const lines = [
    `📊 <b>Estadísticas</b>`,
    ``,
    `🗂 ${t.total} vacantes en la base · +${t.last24h} en 24 h`,
    `📨 ${t.notified} avisadas · ⏳ ${st.pending} pendientes ahora`,
    `⭐ ${t.saved} guardadas · ✅ ${t.applied} aplicadas · 🙈 ${t.discarded} descartadas`,
    `💰 ${pctSalary}% publica sueldo` +
      (st.medianAnnual
        ? ` · mediana (30 d): <b>${esc(formatAnnualRange(st.medianAnnual, st.medianAnnual).split(" (")[0])}</b> sobre ${st.medianCount}`
        : ""),
  ];

  if (st.bySource.length) {
    lines.push("", `📡 <b>Por fuente (7 d)</b>: ${st.bySource.map((x) => `${esc(x.source)} ${x.n}`).join(" · ")}`);
  }

  if (st.topTech.length) {
    lines.push("", `🛠 <b>Tecnologías más pedidas</b> (14 d, ${st.sample} vacantes)`);
    st.topTech.forEach((x, i) => lines.push(`${i + 1}. ${esc(x.name)} — ${x.pct}%${x.mine ? " ✅ tuya" : ""}`));
    const gaps = st.topTech.filter((x) => !x.mine).slice(0, 4).map((x) => x.name);
    if (gaps.length) lines.push("", `💡 Alta demanda fuera de tu stack: ${esc(gaps.join(", "))}`);
  }

  await sendHtml(lines.join("\n"));
}

// ---------- Botones bajo cada vacante ----------

const CALLBACK_STATUS: Record<string, [JobStatus, string, string]> = {
  s: ["saved", "⭐ Guardada", "Quitada de guardadas"],
  a: ["applied", "✅ Marcada como aplicada", "Aplicación desmarcada"],
  d: ["discarded", "🙈 Descartada", "Descarte deshecho"],
};

async function handleCallback(cb: NonNullable<TgUpdate["callback_query"]>) {
  const [act, idRaw] = (cb.data ?? "").split(":");
  const map = CALLBACK_STATUS[act];
  const id = Number(idRaw);
  if (!map || !id) return answerCallback(cb.id, "Acción desconocida");

  const job = await getJob(id);
  if (!job) return answerCallback(cb.id, "La vacante ya no existe");

  const [target, onText, offText] = map;
  const next: JobStatus = job.status === target ? "new" : target;
  await setStatus(id, next);
  await answerCallback(cb.id, next === "new" ? offText : onText);
  if (cb.message) await editKeyboard(cb.message.message_id, buildKeyboard({ ...job, status: next }));
}

// ---------- Enrutador ----------

type Handler = (args: string) => Promise<void>;

const ROUTES: Record<string, Handler> = {
  start: cmdHelp,
  ayuda: cmdHelp,
  help: cmdHelp,
  top: cmdTop,
  buscar: cmdSearch,
  search: cmdSearch,
  sueldo: cmdSalary,
  salary: cmdSalary,
  sinsueldo: cmdNoSalary,
  stack: cmdStack,
  evitar: cmdAvoid,
  avoid: cmdAvoid,
  minscore: cmdMinScore,
  lote: cmdBatch,
  ubicacion: cmdLocation,
  guardadas: () => cmdList("saved", "⭐ <b>Guardadas</b>", "Aún no guardas ninguna. Usa el botón ⭐ en una vacante."),
  saved: () => cmdList("saved", "⭐ <b>Guardadas</b>", "Aún no guardas ninguna. Usa el botón ⭐ en una vacante."),
  aplicadas: () => cmdList("applied", "✅ <b>Aplicadas</b>", "Aún no marcas ninguna. Usa el botón ✅ en una vacante."),
  applied: () => cmdList("applied", "✅ <b>Aplicadas</b>", "Aún no marcas ninguna. Usa el botón ✅ en una vacante."),
  stats: cmdStats,
  config: cmdConfig,
  settings: cmdConfig,
  pausa: () => cmdPause(true),
  pause: () => cmdPause(true),
  reanudar: () => cmdPause(false),
  resume: () => cmdPause(false),
};

export async function handleUpdate(u: TgUpdate) {
  if (u.callback_query) {
    // Solo tú puedes tocar los botones
    if (String(u.callback_query.message?.chat.id) !== ALLOWED_CHAT) return;
    return handleCallback(u.callback_query);
  }

  const msg = u.message;
  if (!msg?.text || String(msg.chat.id) !== ALLOWED_CHAT) return; // ignora a extraños

  let text = msg.text.trim();
  text = BUTTON_TO_COMMAND[text] ?? text;
  // Texto suelto = búsqueda
  if (!text.startsWith("/")) return cmdSearch(text);

  const m = text.match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return;
  const cmd = m[1].toLowerCase();
  const args = m[2] ?? "";

  const view = cmd.match(/^ver_(\d+)$/);
  if (view) return cmdView(Number(view[1]));

  const handler = ROUTES[cmd];
  if (!handler) return void (await sendHtml(`No conozco /${esc(cmd)}. Prueba /ayuda.`));
  return handler(args);
}

/**
 * Procesa los mensajes pendientes. Con timeoutSec > 0 hace long-polling
 * (modo `listen`); con 0 devuelve de inmediato lo que haya (modo cron).
 */
export async function processUpdates(timeoutSec = 0): Promise<number> {
  let offset = (await getState<number>("tg_offset")) ?? 0;
  const updates = await getUpdates(offset, timeoutSec);

  for (const u of updates) {
    try {
      await handleUpdate(u);
    } catch (err) {
      console.error("Error en comando:", err);
      await sendHtml("⚠️ Algo falló procesando eso. Intenta de nuevo.").catch(() => {});
    }
    offset = u.update_id + 1;
  }

  if (updates.length) await setState("tg_offset", offset);
  return updates.length;
}
