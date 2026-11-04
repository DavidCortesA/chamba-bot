import { insertJob, getPending, markNotified } from "./db.js";
import { score } from "./score.js";
import { sendJob } from "./telegram.js";
import { remoteok } from "./sources/remoteok.js";
import { remotive } from "./sources/remotive.js";
import { himalayas } from "./sources/himalayas.js";
import { jobicy } from "./sources/jobicy.js";
import { wwr } from "./sources/wwr.js";

const MIN_SCORE = Number(process.env.MIN_SCORE ?? 5);
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN ?? 10);

const sources = [remoteok, remotive, wwr, himalayas, jobicy];

async function main() {
  let nuevas = 0;

  const results = await Promise.allSettled(sources.map((s) => s.fetch()));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      console.error(`✗ ${sources[i].name}:`, r.reason);
      continue;
    }
    console.log(`✓ ${sources[i].name}: ${r.value.length} ofertas`);
    for (const job of r.value) {
      const { total, reason } = score(job.title, job.description);
      const isNew = await insertJob({ ...job, score: total, reason });
      if (isNew) nuevas++;
    }
  }

  console.log(`Nuevas guardadas: ${nuevas}`);

  const pending = await getPending(MIN_SCORE, MAX_PER_RUN);
  const sent: number[] = [];

  for (const job of pending) {
    try {
      await sendJob(job);
      sent.push(job.id);
      await new Promise((r) => setTimeout(r, 1100)); // límite de Telegram
    } catch (err) {
      console.error("Error enviando a Telegram:", err);
      break;
    }
  }

  await markNotified(sent);
  console.log(`Enviadas a Telegram: ${sent.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});