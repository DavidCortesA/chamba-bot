import type { Salary } from "../salary.js";

export type Job = {
  source: string;
  url: string;
  title: string;
  company: string;
  description: string;
  // Datos estructurados (opcionales: no todas las fuentes los traen)
  location?: string;
  seniority?: string;
  employmentType?: string;
  tags?: string[];
  postedAt?: Date | null;
  salary?: Salary | null;
};

export type Source = {
  name: string;
  fetch: () => Promise<Job[]>;
};

export const UA = "ChambaBot/1.0 (personal job alerts)";

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  ndash: "–",
  mdash: "—",
  amp: "&",
};

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/**
 * Repara UTF-8 que llegó leído como Latin-1 ("MÃ©xico" → "México", "â" → "–").
 * Solo se intenta si hay señales claras y el resultado es UTF-8 válido.
 */
export function fixMojibake(s = ""): string {
  if (!/[ÂÃâ][\u0080-¿]/.test(s)) return s;
  if ([...s].some((c) => c.charCodeAt(0) > 0xff)) return s;
  const fixed = Buffer.from(s, "latin1").toString("utf8");
  return fixed.includes("�") ? s : fixed;
}

/** HTML → texto plano conservando saltos de línea y viñetas (sirve para extraer secciones) */
export function stripHtml(html = ""): string {
  // Algunos feeds (WeWorkRemotely) traen el HTML escapado dos veces: &lt;p&gt;…
  html = fixMojibake(html);
  const src = /&lt;\/?[a-z][^&]*?&gt;/i.test(html) ? decodeEntities(html) : html;

  return decodeEntities(
    src
      .replace(/<\s*(?:br|\/p|\/div|\/h[1-6]|\/ul|\/ol|\/tr)\s*\/?>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "\n• ")
      .replace(/<[^>]*>/g, " ")
      // Las URLs no aportan y ensucian la detección (p. ej. "imgix.net" ≠ .NET)
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " "),
  )
    .replace(/[ \t\r\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/** Acepta ISO, epoch en segundos o en milisegundos */
export function toDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
