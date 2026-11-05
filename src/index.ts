import {
  ensureSchema,
  getPending,
  getSettings,
  getState,
  insertJob,
  markNotified,
  setState,
} from "./db.js";
import { processUpdates } from "./commands.js";
import { score, storedScore } from "./score.js";
import { salaryTextOf } from "./salary.js";
import { toScoreContext } from "./settings.js";
import { deleteWebhook, sendJob, setCommands } from "./telegram.js";
import { remoteok } from "./sources/remoteok.js";
import { remotive } from "./sources/remotive.js";
import { himalayas } from "./sources/himalayas.js";
import { jobicy } from "./sources/jobicy.js";
import { wwr } from "./sources/wwr.js";

// run (default): atiende comandos + busca vacantes + avisa          [una pasada]
// commands:      solo atiende comandos pendientes                   [una pasada]
// listen:        long-polling continuo, responde al instante        [uso local]
// window:        escucha comandos ~4.5 min y busca vacantes si ya   [alternativa sin
//                pasaron ≥ SCRAPE_EVERY_MIN desde la última vez      Cloudflare]
// scrape:        solo busca vacantes y avisa; los comandos los        [GitHub Actions
//                atiende el Worker de Cloudflare por webhook          cada 30 min]
const mode = process.argv[2] ?? "run";

const WINDOW_SECONDS = Number(process.env.WINDOW_SECONDS ?? 270);
const SCRAPE_EVERY_MIN = Number(process.env.SCRAPE_EVERY_MIN ?? 25);

const sources = [remoteok, remotive, wwr, himalayas, jobicy];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function drainCommands() {
  try {
    // Hasta 5 lotes de 100 mensajes
    for (let i = 0; i < 5; i++) {
      if ((await processUpdates(0)) < 100) break;
    }
  } catch (err) {
    // Un fallo atendiendo comandos no debe impedir buscar vacantes
    console.error("Error atendiendo comandos:", err);
  }
}

async function listen() {
  // Local: tomamos el control de los mensajes (quita el webhook del Worker si había uno)
  await deleteWebhook();
  await setCommands();
  console.log("👂 Escuchando comandos de Telegram (Ctrl+C para salir)…");
  for (;;) {
    try {
      await processUpdates(30);
    } catch (err) {
      console.error(err);
      await sleep(5000);
    }
  }
}

async function scrapeAndNotify() {
  // Leída después de los comandos para respetar cambios recién hechos
  const settings = await getSettings();
  const ctx = toScoreContext(settings);
  let nuevas = 0;

  const results = await Promise.allSettled(sources.map((s) => s.fetch()));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      console.error(`✗ ${sources[i].name}:`, r.reason);
      continue;
    }
    console.log(`✓ ${sources[i].name}: ${r.value.length} ofertas`);

    // Inserciones en paralelo por lotes (antes eran una por una)
    for (let k = 0; k < r.value.length; k += 10) {
      const batch = r.value.slice(k, k + 10);
      const inserted = await Promise.all(
        batch.map((job) => {
          // Mismo texto que usa rescore(): descripción + tags + sueldo
          const text = `${job.description} ${(job.tags ?? []).join(" ")} ${job.salary ? salaryTextOf(job.salary) : ""}`;
          const res = score(job.title, text, ctx, job.location ?? "");
          return insertJob(job, { score: storedScore(res), reason: res.reason });
        }),
      );
      nuevas += inserted.filter(Boolean).length;
    }
  }

  console.log(`Nuevas guardadas: ${nuevas}`);

  if (settings.paused) {
    console.log("⏸ Avisos en pausa (/reanudar para continuar)");
    return;
  }

  const pending = await getPending(settings);
  const sent: number[] = [];

  for (const job of pending) {
    try {
      await sendJob(job, settings);
      sent.push(job.id);
      await sleep(1100); // límite de Telegram
    } catch (err) {
      console.error("Error enviando a Telegram:", err);
      break;
    }
  }

  await markNotified(sent);
  console.log(`Enviadas a Telegram: ${sent.length}`);
}

async function run() {
  await setCommands().catch((err) => console.error("setCommands:", err));
  await drainCommands();
  if (mode === "commands") return;
  await scrapeAndNotify();
}

async function windowMode() {
  const deadline = Date.now() + WINDOW_SECONDS * 1000;
  await setCommands().catch((err) => console.error("setCommands:", err));
  await drainCommands();

  // ¿Toca buscar vacantes? (también si se lanzó a mano desde GitHub)
  const last = (await getState<number>("last_scrape")) ?? 0;
  const due = Date.now() - last >= SCRAPE_EVERY_MIN * 60_000;
  if (due || process.env.FORCE_SCRAPE === "1") {
    await setState("last_scrape", Date.now());
    await scrapeAndNotify();
  } else {
    console.log(`Sin búsqueda: la última fue hace ${Math.round((Date.now() - last) / 60_000)} min`);
  }

  // Resto de la ventana: escuchar y responder al instante
  console.log("👂 Escuchando comandos…");
  for (;;) {
    const remaining = Math.floor((deadline - Date.now()) / 1000);
    if (remaining < 3) break;
    try {
      await processUpdates(Math.min(25, remaining - 1));
    } catch (err) {
      console.error(err);
      await sleep(3000);
    }
  }
}

async function main() {
  await ensureSchema();
  if (mode === "listen") return listen();
  if (mode === "window") return windowMode();
  if (mode === "scrape") return scrapeAndNotify();
  return run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
