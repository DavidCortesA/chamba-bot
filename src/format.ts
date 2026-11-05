import { formatAnnualRange, parseSalaryText, toAnnualUsd } from "./salary.js";
import { BLOCKED_SCORE, statusOf, type ScoreStatus } from "./score.js";
import { detectTech, inUserStack, type StackItem } from "./stack.js";
import type { JobRow, JobStatus } from "./types.js";

export const esc = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const truncate = (s: string, max: number) =>
  s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";

const STATUS_EMOJI: Record<ScoreStatus, string> = {
  excellent: "🔥",
  good: "✅",
  moderate: "👍",
  low: "🤏",
  rejected: "🚫",
};

const STATUS_BARS: Record<ScoreStatus, number> = {
  excellent: 5,
  good: 4,
  moderate: 3,
  low: 2,
  rejected: 0,
};

export function timeAgo(iso?: string | null, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d > 30 ? "hace +30 d" : `hace ${d} d`;
}

// ---------- Extracción de información de la descripción ----------

const META_LINE =
  /^(?:salary|seniority|employment|eligible locations|location|published|source|headquarters|hq):/i;

const REQ_HEADING =
  /^[#*\-•\s]*(?:key\s+)?(?:requirements?|qualifications?|what you(?:'|’)?ll need|what we(?:'|’)?re looking for|you have|you bring|who you are|must[- ]haves?|your profile|about you|required skills|skills(?: & experience)?)\b[^\n]{0,40}$/i;

const STOP_HEADING =
  /^[#*\-•\s]*(?:benefits?|perks|what we offer|nice[- ]to[- ]haves?|bonus|responsibilities|about (?:us|the)|how to apply|compensation|why )/i;

const cleanLines = (description: string) =>
  description
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !META_LINE.test(l));

export function extractSummary(description: string, max = 300): string {
  const all = cleanLines(description).filter((l) => l.length > 40 && !REQ_HEADING.test(l));
  // Preferimos párrafos; las viñetas (requisitos, beneficios) van en su propia sección
  const prose = all.filter((l) => !l.startsWith("•"));
  const text = (prose.length ? prose : all).join(" ").replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : truncate(cut, max);
}

export function extractRequirements(description: string, maxItems = 4): string[] {
  const lines = cleanLines(description);
  const start = lines.findIndex((l) => l.length <= 70 && REQ_HEADING.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1, start + 12)) {
    if (STOP_HEADING.test(line) || (line.length < 40 && line.endsWith(":"))) break;
    const clean = line.replace(/^(?:[•\-*]|\d{1,2}[.)])\s*/, "").trim();
    if (clean.length < 8) continue;
    out.push(truncate(clean, 120));
    if (out.length >= maxItems) break;
  }
  return out;
}

export function extractExperience(text: string): string {
  const m =
    /(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?\+?\s*(?:years?|yrs?)\b[^.\n]{0,30}?(?:experience|exp\b)/i.exec(
      text,
    );
  return m ? `${m[1]}+ años` : "";
}

// ---------- Mensaje ----------

function salaryLine(j: JobRow): string {
  let min = j.salary_min_usd;
  let max = j.salary_max_usd;
  if (min == null && max == null) {
    // Filas viejas sin sueldo estructurado: intentamos leerlo del texto
    const parsed = toAnnualUsd(parseSalaryText(j.description));
    min = parsed?.min ?? null;
    max = parsed?.max ?? null;
  }
  if (min == null && max == null) return "💰 <i>Sueldo no publicado</i>";
  const original =
    j.salary_text && !/^USD\b/.test(j.salary_text) ? ` <i>(orig: ${esc(j.salary_text)})</i>` : "";
  return `💰 <b>${esc(formatAnnualRange(min, max))}</b>${original}`;
}

export function buildJobMessage(j: JobRow, stack: StackItem[]): string {
  const status = statusOf(j.score, j.score > BLOCKED_SCORE);
  const when = timeAgo(j.posted_at ?? j.created_at);
  const tech = detectTech(j.title, `${j.title} ${j.description}`, 10);
  const experience = extractExperience(j.description);
  const summary = extractSummary(j.description);
  const reqs = extractRequirements(j.description);

  const lines: string[] = [];
  lines.push(`${STATUS_EMOJI[status]} <b>${esc(j.title)}</b>`);
  lines.push(
    `🏢 ${esc(j.company || "—")} · 📡 ${esc(j.source)}${when ? ` · 🕒 ${when}` : ""}`,
  );
  lines.push("");
  lines.push(salaryLine(j));

  const meta = [
    j.location && `📍 ${esc(truncate(j.location, 60))}`,
    j.seniority && `🧭 ${esc(j.seniority)}`,
    j.employment_type && `📄 ${esc(j.employment_type)}`,
    experience && `🎓 ${experience}`,
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "));

  if (tech.length) {
    const chips = tech.map((t) => (inUserStack(t, stack) ? `✅ ${esc(t)}` : esc(t)));
    lines.push(`🛠 <b>Piden:</b> ${chips.join(" · ")}`);
  }

  const bars = STATUS_BARS[status];
  lines.push(
    `🎯 <b>Match ${j.score}</b> ${"▰".repeat(bars)}${"▱".repeat(5 - bars)}` +
      (j.reason ? ` <i>${esc(truncate(j.reason, 160))}</i>` : ""),
  );

  if (summary) {
    lines.push("", `📝 ${esc(summary)}`);
  }
  if (reqs.length) {
    lines.push("", "📋 <b>Requisitos:</b>", ...reqs.map((r) => `• ${esc(r)}`));
  }

  return lines.join("\n");
}

export function buildKeyboard(j: { id: number; url: string; status: JobStatus }) {
  const mark = (target: JobStatus, on: string, off: string) =>
    j.status === target ? `${on} ✓` : off;
  return {
    inline_keyboard: [
      [{ text: "Ver vacante →", url: j.url }],
      [
        { text: mark("saved", "⭐ Guardada", "⭐ Guardar"), callback_data: `s:${j.id}` },
        { text: mark("applied", "✅ Aplicada", "✅ Apliqué"), callback_data: `a:${j.id}` },
        { text: mark("discarded", "🙈 Descartada", "🙈 Descartar"), callback_data: `d:${j.id}` },
      ],
    ],
  };
}

/** Línea compacta para listados: título linkeado, empresa, sueldo y atajo /ver_ID */
export function formatCompactLine(j: JobRow, index: number): string {
  let min = j.salary_min_usd;
  let max = j.salary_max_usd;
  if (min == null && max == null) {
    const parsed = toAnnualUsd(parseSalaryText(j.description));
    min = parsed?.min ?? null;
    max = parsed?.max ?? null;
  }
  const salary = min != null || max != null ? ` · 💰 ${esc(formatAnnualRange(min, max).split(" (")[0])}` : "";
  const statusIcon = { new: "", saved: "⭐ ", applied: "✅ ", discarded: "🙈 " }[j.status];
  return (
    `${index}. ${statusIcon}<a href="${esc(j.url)}">${esc(truncate(j.title, 70))}</a>` +
    ` — ${esc(j.company || "—")}\n` +
    `    🎯 ${j.score}${salary} · /ver_${j.id}`
  );
}
