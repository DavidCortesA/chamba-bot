import {
  DEFAULT_AVOID,
  DEFAULT_STACK,
  avoidTerms,
  compileSafe,
  patternFromTerms,
  type StackItem,
} from "./stack.js";

export type ScoreStatus = "excellent" | "good" | "moderate" | "low" | "rejected";

export type ScoreResult = {
  total: number;
  reason: string;
  hits: string[];
  eligible: boolean;
  status: ScoreStatus;
};

// Lo que cambia según tu configuración (/stack, /evitar, /ubicacion)
export type ScoreContext = {
  stack: StackItem[];
  avoid: string[];
  strictLocation: boolean;
};

export const DEFAULT_CONTEXT: ScoreContext = {
  stack: DEFAULT_STACK,
  avoid: DEFAULT_AVOID,
  strictLocation: true,
};

// Reglas fijas (modalidad y contratación). El stack vive en ScoreContext.
const RULES: [RegExp, number, string][] = [
  // Modalidad y contratación
  [/remote|latam|latin america|worldwide|anywhere/i, 2, "remote"],
  [/international|global hiring/i, 2, "international"],
  [/contractor|contract position/i, 1, "contractor"],
  [/\bUSD\b|\$\s?\d/i, 1, "salary USD"],

  // Nivel profesional
  [/\bmid[- ]level\b|\bmid[- ]senior\b/i, 2, "mid-level"],
];

// Solo se evalúa en el TÍTULO: "work with senior engineers" no debe penalizar
const SENIOR_TITLE = /\b(senior|sr|lead|staff|principal|head)\b/i;

const BLOCKED_RULES: [RegExp, string][] = [
  [
    /us only|usa only|u\.s\. only|us citizens|must reside in the us|united states only/i,
    "Solo candidatos de Estados Unidos",
  ],
  [
    /\b(?:eu|europe|uk|canada|emea|apac)[- ]only\b|must (?:be|reside) (?:based )?in (?:the )?(?:eu|europe|uk|canada)/i,
    "Restringido a otra región (UE/UK/Canadá…)",
  ],
];

// Campo "location" estructurado: si no es abierto, la vacante no es para ti
const OPEN_LOCATION =
  /worldwide|anywhere|global|latam|latin america|americas|mexico|méxico|north america|^\s*remote\s*$|^\s*any/i;

type Compiled = {
  stack: { re: RegExp; weight: number; name: string }[];
  avoid: { re: RegExp; name: string }[];
};

const cache = new WeakMap<ScoreContext, Compiled>();

function compiled(ctx: ScoreContext): Compiled {
  let c = cache.get(ctx);
  if (c) return c;
  c = { stack: [], avoid: [] };
  for (const s of ctx.stack) {
    const re = compileSafe(s.pattern);
    if (re) c.stack.push({ re, weight: s.weight, name: s.name });
  }
  for (const entry of ctx.avoid) {
    const terms = avoidTerms(entry);
    if (!terms.length) continue;
    const re = compileSafe(patternFromTerms(terms));
    if (re) c.avoid.push({ re, name: terms[0] });
  }
  cache.set(ctx, c);
  return c;
}

export function statusOf(total: number, eligible = true): ScoreStatus {
  if (!eligible) return "rejected";
  if (total >= 12) return "excellent";
  if (total >= 8) return "good";
  if (total >= 4) return "moderate";
  return "low";
}

export function score(
  title: string,
  desc = "",
  ctx: ScoreContext = DEFAULT_CONTEXT,
  location = "",
): ScoreResult {
  const c = compiled(ctx);
  const text = `${title} ${desc} ${location}`;

  let total = 0;
  const hits: string[] = [];
  const add = (points: number, label: string) => {
    total += points;
    hits.push(`${points > 0 ? "+" : ""}${points} ${label}`);
  };

  // Stack: si aparece en el título pesa +1 extra (el título cuenta más)
  for (const s of c.stack) {
    if (!s.re.test(text)) continue;
    const inTitle = s.weight > 0 && s.re.test(title);
    add(s.weight + (inTitle ? 1 : 0), inTitle ? `${s.name} (título)` : s.name);
  }

  for (const [regex, points, label] of RULES) {
    if (regex.test(text)) add(points, label);
  }

  // Penalizaciones
  if (SENIOR_TITLE.test(title)) add(-2, "senior+");

  const avoided = c.avoid.filter((a) => a.re.test(`${title} ${desc}`)).map((a) => a.name);
  if (avoided.length) add(-3, `otro stack (${avoided.join(", ")})`);

  // Bloqueos: la vacante no es elegible sin importar el puntaje
  const blockedText = BLOCKED_RULES.find(([regex]) => regex.test(`${title} ${desc}`))?.[1];
  const blockedLocation =
    ctx.strictLocation && location.trim() && !OPEN_LOCATION.test(location)
      ? `Restringido a: ${location.trim().slice(0, 60)}`
      : undefined;
  const blockedReason = blockedText ?? blockedLocation;

  const eligible = !blockedReason;

  return {
    total,
    reason: blockedReason ?? hits.join(", "),
    hits,
    eligible,
    status: statusOf(total, eligible),
  };
}

/** Lo que se guarda en la BD: las vacantes bloqueadas quedan con -99 y jamás se envían */
export const BLOCKED_SCORE = -99;
export const storedScore = (r: ScoreResult): number => (r.eligible ? r.total : BLOCKED_SCORE);
