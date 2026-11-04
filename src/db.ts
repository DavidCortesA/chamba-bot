import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");

export const sql = neon(url);

export type JobRow = {
  id: number;
  source: string;
  url: string;
  title: string;
  company: string;
  score: number;
  reason: string;
};

// Inserta y devuelve true si era nueva (dedupe por url única)
export async function insertJob(j: {
  source: string;
  url: string;
  title: string;
  company: string;
  description: string;
  score: number;
  reason: string;
}): Promise<boolean> {
  const rows = await sql`
    insert into jobs (source, url, title, company, description, score, reason)
    values (${j.source}, ${j.url}, ${j.title}, ${j.company},
            ${j.description.slice(0, 4000)}, ${j.score}, ${j.reason})
    on conflict (url) do nothing
    returning id`;
  return rows.length > 0;
}

export async function getPending(minScore: number, limit: number) {
  return (await sql`
    select id, source, url, title, company, score, reason
    from jobs
    where notified = false and score >= ${minScore}
    order by score desc, created_at desc
    limit ${limit}`) as JobRow[];
}

export async function markNotified(ids: number[]) {
  if (!ids.length) return;
  await sql`update jobs set notified = true where id = any(${ids})`;
}