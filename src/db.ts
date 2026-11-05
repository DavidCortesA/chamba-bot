import { neon } from "@neondatabase/serverless";
import { toAnnualUsd, parseSalaryText, salaryTextOf } from "./salary.js";
import { BLOCKED_SCORE, score, storedScore } from "./score.js";
import { detectTech, inUserStack } from "./stack.js";
import { hasSalaryFilter, mergeSettings, toScoreContext, type Settings } from "./settings.js";
import type { Job } from "./sources/types.js";
import type { JobRow, JobStatus } from "./types.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

export const sql = neon(url);

export type { JobRow, JobStatus } from "./types.js";

// ---------- Esquema (idempotente: se puede correr en cada ejecución) ----------

export async function ensureSchema() {
  await sql`
    create table if not exists jobs (
      id serial primary key,
      source text not null,
      url text not null unique,
      title text not null,
      company text,
      description text,
      score int not null default 0,
      reason text,
      notified boolean not null default false,
      created_at timestamptz not null default now()
    )`;
  await sql`
    alter table jobs
      add column if not exists location text,
      add column if not exists seniority text,
      add column if not exists employment_type text,
      add column if not exists tags text[] not null default '{}',
      add column if not exists posted_at timestamptz,
      add column if not exists salary_text text,
      add column if not exists salary_min_usd bigint,
      add column if not exists salary_max_usd bigint,
      add column if not exists status text not null default 'new'`;
  await sql`create index if not exists jobs_created_idx on jobs (created_at desc)`;
  await sql`create index if not exists jobs_status_idx on jobs (status)`;
  await sql`
    create table if not exists bot_state (
      key text primary key,
      value jsonb not null
    )`;
}

// ---------- Estado y configuración del bot ----------

export async function getState<T>(key: string): Promise<T | null> {
  const rows = await sql`select value from bot_state where key = ${key}`;
  return rows.length ? (rows[0].value as T) : null;
}

export async function setState(key: string, value: unknown) {
  await sql`
    insert into bot_state (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value`;
}

export async function getSettings(): Promise<Settings> {
  return mergeSettings(await getState<Partial<Settings>>("settings"));
}

/** Guarda solo lo que cambiaste; lo demás sigue heredando de los valores por defecto */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = (await getState<Partial<Settings>>("settings")) ?? {};
  await setState("settings", { ...current, ...patch });
  return mergeSettings({ ...current, ...patch });
}

export async function resetSettingsKeys(keys: (keyof Settings)[]): Promise<Settings> {
  const current = (await getState<Partial<Settings>>("settings")) ?? {};
  for (const k of keys) delete current[k];
  await setState("settings", current);
  return mergeSettings(current);
}

// ---------- Vacantes ----------

const mapRow = (r: any): JobRow => ({
  ...r,
  id: Number(r.id),
  score: Number(r.score),
  tags: r.tags ?? [],
  salary_min_usd: r.salary_min_usd != null ? Number(r.salary_min_usd) : null,
  salary_max_usd: r.salary_max_usd != null ? Number(r.salary_max_usd) : null,
  posted_at: r.posted_at ? new Date(r.posted_at).toISOString() : null,
  created_at: new Date(r.created_at).toISOString(),
});

const JOB_COLS = `id, source, url, title, company, description, score, reason, notified, status,
  location, seniority, employment_type, tags, posted_at, created_at,
  salary_text, salary_min_usd, salary_max_usd`;

// Inserta y devuelve true si era nueva (dedupe por url única)
export async function insertJob(
  job: Job,
  result: { score: number; reason: string },
): Promise<boolean> {
  const annual = toAnnualUsd(job.salary ?? parseSalaryText(job.description));
  const salaryText = job.salary ? salaryTextOf(job.salary) : null;

  const rows = await sql`
    insert into jobs (source, url, title, company, description, score, reason,
                      location, seniority, employment_type, tags, posted_at,
                      salary_text, salary_min_usd, salary_max_usd)
    values (${job.source}, ${job.url}, ${job.title}, ${job.company},
            ${job.description.slice(0, 4000)}, ${result.score}, ${result.reason},
            ${job.location ?? null}, ${job.seniority ?? null}, ${job.employmentType ?? null},
            ${job.tags ?? []}::text[], ${job.postedAt?.toISOString() ?? null}::timestamptz,
            ${salaryText}, ${annual?.min ?? null}, ${annual?.max ?? null})
    on conflict (url) do nothing
    returning id`;
  return rows.length > 0;
}

export type JobFilter = {
  id?: number;
  minScore?: number;
  notified?: boolean;
  statuses?: JobStatus[];
  sinceDays?: number;
  // Rango en USD anuales; includeUnknown decide qué pasa con vacantes sin sueldo
  salary?: { minAnnual: number | null; maxAnnual: number | null; includeUnknown: boolean } | null;
  words?: string[];
  includeBlocked?: boolean;
  // relevance: primero las que traen las palabras en el título, luego por score
  order?: "score" | "recent" | "relevance";
  limit?: number;
};

// Escapa %, _ y \ para que lo que escribes en /buscar se tome literal en ILIKE
const likePattern = (w: string) => `%${w.replace(/[\\%_]/g, "\\$&")}%`;

function buildWhere(f: JobFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (f.id != null) where.push(`id = ${p(f.id)}`);
  if (!f.includeBlocked) where.push(`score > ${BLOCKED_SCORE + 1}`);
  if (f.minScore != null) where.push(`score >= ${p(f.minScore)}`);
  if (f.notified != null) where.push(`notified = ${p(f.notified)}`);
  if (f.statuses?.length) where.push(`status = any(${p(f.statuses)}::text[])`);
  if (f.sinceDays) where.push(`created_at > now() - make_interval(days => ${p(f.sinceDays)}::int)`);

  if (f.salary && (f.salary.minAnnual != null || f.salary.maxAnnual != null)) {
    const mn = p(f.salary.minAnnual);
    const mx = p(f.salary.maxAnnual);
    const inc = p(f.salary.includeUnknown);
    where.push(`(
      (coalesce(salary_max_usd, salary_min_usd) is null and ${inc}::boolean)
      or (
        coalesce(salary_max_usd, salary_min_usd) >= coalesce(${mn}::bigint, 0)
        and coalesce(salary_min_usd, salary_max_usd) <= coalesce(${mx}::bigint, 9999999999)
      )
    )`);
  }

  for (const word of f.words ?? []) {
    const like = p(likePattern(word));
    where.push(`(title ilike ${like} or company ilike ${like}
      or array_to_string(tags, ' ') ilike ${like} or description ilike ${like})`);
  }

  return { clause: where.length ? `where ${where.join(" and ")}` : "", params };
}

export async function queryJobs(f: JobFilter): Promise<JobRow[]> {
  const { clause, params } = buildWhere(f);
  let order = "score desc, coalesce(posted_at, created_at) desc";
  if (f.order === "recent") order = "coalesce(posted_at, created_at) desc";
  if (f.order === "relevance" && f.words?.length) {
    const titleHits = f.words.map((w) => {
      params.push(likePattern(w));
      return `(title ilike $${params.length})::int`;
    });
    order = `${titleHits.join(" + ")} desc, ${order}`;
  }
  params.push(f.limit ?? 10);
  const rows = await sql.query(
    `select ${JOB_COLS} from jobs ${clause} order by ${order} limit $${params.length}`,
    params,
  );
  return rows.map(mapRow);
}

export async function countJobs(f: JobFilter): Promise<number> {
  const { clause, params } = buildWhere(f);
  const rows = await sql.query(`select count(*)::int as n from jobs ${clause}`, params);
  return Number(rows[0].n);
}

export const salaryFilterOf = (s: Settings): JobFilter["salary"] =>
  hasSalaryFilter(s)
    ? { minAnnual: s.minSalaryAnnual, maxAnnual: s.maxSalaryAnnual, includeUnknown: s.includeNoSalary }
    : null;

/** Filtro de "pendientes de avisar" según tu configuración */
export const pendingFilter = (s: Settings, limit = s.maxPerRun): JobFilter => ({
  minScore: s.minScore,
  notified: false,
  statuses: ["new"],
  sinceDays: 30, // no desenterrar vacantes viejas si bajas el score mínimo
  salary: salaryFilterOf(s),
  order: "score",
  limit,
});

export const getPending = (s: Settings) => queryJobs(pendingFilter(s));

export async function getJob(id: number): Promise<JobRow | null> {
  return (await queryJobs({ id, includeBlocked: true, limit: 1 }))[0] ?? null;
}

export async function markNotified(ids: number[]) {
  if (!ids.length) return;
  await sql`update jobs set notified = true where id = any(${ids})`;
}

export async function setStatus(id: number, status: JobStatus) {
  await sql`update jobs set status = ${status} where id = ${id}`;
}

// ---------- Re-puntuar cuando cambia tu stack / reglas ----------

/**
 * Recalcula score (y rellena sueldo desde el texto si faltaba) de las vacantes
 * recientes que aún no has guardado/aplicado/descartado.
 */
export async function rescore(settings: Settings): Promise<{ updated: number; pending: number }> {
  const ctx = toScoreContext(settings);
  const rows = await sql`
    select id, title, description, location, tags, salary_text, salary_min_usd, salary_max_usd
    from jobs
    where status = 'new' and created_at > now() - interval '30 days'
    order by id desc
    limit 3000`;

  const ids: number[] = [];
  const scores: number[] = [];
  const reasons: string[] = [];
  const mins: (number | null)[] = [];
  const maxs: (number | null)[] = [];

  for (const r of rows) {
    const text = `${r.description ?? ""} ${(r.tags ?? []).join(" ")} ${r.salary_text ?? ""}`;
    const res = score(r.title, text, ctx, r.location ?? "");
    let min = r.salary_min_usd != null ? Number(r.salary_min_usd) : null;
    let max = r.salary_max_usd != null ? Number(r.salary_max_usd) : null;
    if (min == null && max == null) {
      const parsed = toAnnualUsd(parseSalaryText(r.description ?? ""));
      min = parsed?.min ?? null;
      max = parsed?.max ?? null;
    }
    ids.push(Number(r.id));
    scores.push(storedScore(res));
    reasons.push(res.reason);
    mins.push(min);
    maxs.push(max);
  }

  if (ids.length) {
    await sql`
      update jobs set
        score = v.score,
        reason = v.reason,
        salary_min_usd = coalesce(jobs.salary_min_usd, v.smin),
        salary_max_usd = coalesce(jobs.salary_max_usd, v.smax)
      from unnest(${ids}::int[], ${scores}::int[], ${reasons}::text[], ${mins}::bigint[], ${maxs}::bigint[])
        as v(id, score, reason, smin, smax)
      where jobs.id = v.id`;
  }

  return { updated: ids.length, pending: await countJobs(pendingFilter(settings)) };
}

// ---------- Estadísticas ----------

export async function getStats(settings: Settings) {
  const [totals] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where created_at > now() - interval '24 hours')::int as last24h,
      count(*) filter (where notified)::int as notified,
      count(*) filter (where status = 'saved')::int as saved,
      count(*) filter (where status = 'applied')::int as applied,
      count(*) filter (where status = 'discarded')::int as discarded,
      count(*) filter (where salary_min_usd is not null or salary_max_usd is not null)::int as with_salary
    from jobs`;

  const bySource = await sql`
    select source, count(*)::int as n from jobs
    where created_at > now() - interval '7 days'
    group by source order by n desc`;

  const [median] = await sql`
    select
      percentile_cont(0.5) within group (
        order by (coalesce(salary_min_usd, salary_max_usd) + coalesce(salary_max_usd, salary_min_usd)) / 2.0
      ) as annual,
      count(*)::int as n
    from jobs
    where created_at > now() - interval '30 days'
      and score > ${BLOCKED_SCORE + 1}
      and (salary_min_usd is not null or salary_max_usd is not null)`;

  // Demanda de tecnologías (últimos 14 días, vacantes elegibles)
  const recent = await sql`
    select title, description from jobs
    where created_at > now() - interval '14 days' and score > ${BLOCKED_SCORE + 1}
    order by id desc limit 1000`;
  const demand = new Map<string, number>();
  for (const r of recent) {
    for (const t of detectTech(r.title, `${r.title} ${r.description ?? ""}`, 12)) {
      demand.set(t, (demand.get(t) ?? 0) + 1);
    }
  }
  const topTech = [...demand.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, n]) => ({
      name,
      n,
      mine: inUserStack(name, settings.stack),
      pct: recent.length ? Math.round((n / recent.length) * 100) : 0,
    }));

  return {
    totals,
    bySource: bySource as { source: string; n: number }[],
    medianAnnual: median?.annual != null ? Number(median.annual) : null,
    medianCount: Number(median?.n ?? 0),
    topTech,
    sample: recent.length,
    pending: await countJobs(pendingFilter(settings)),
  };
}
