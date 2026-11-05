export type SalaryPeriod = "year" | "month" | "week" | "day" | "hour";

export type Salary = {
  min: number | null;
  max: number | null;
  currency: string;
  period: SalaryPeriod;
};

export type AnnualRange = {
  minAnnual: number | null;
  maxAnnual: number | null;
};

// Tipos de cambio APROXIMADOS, solo para poder comparar vacantes entre sí.
const FX_TO_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.65,
  CHF: 1.13,
  MXN: 0.055,
  BRL: 0.18,
  ARS: 0.001,
  COP: 0.00025,
  CLP: 0.0011,
  PEN: 0.27,
  INR: 0.012,
};

const PERIODS_PER_YEAR: Record<SalaryPeriod, number> = {
  year: 1,
  month: 12,
  week: 52,
  day: 260,
  hour: 2080,
};

const SYMBOLS: Record<string, string> = { $: "USD", "US$": "USD", "€": "EUR", "£": "GBP" };

export function normalizeCurrency(c?: string | null): string {
  const raw = (c ?? "").trim();
  if (!raw) return "USD";
  return SYMBOLS[raw] ?? raw.toUpperCase();
}

export function normalizePeriod(p?: string | null): SalaryPeriod {
  const s = (p ?? "").toLowerCase();
  if (/hour|\bhr\b|hora/.test(s)) return "hour";
  if (/week|semana/.test(s)) return "week";
  if (/\bday\b|daily|dia|día/.test(s)) return "day";
  if (/month|\bmo\b|\bmes/.test(s)) return "month";
  return "year";
}

/** Convierte un sueldo a USD anuales. Devuelve null si es inválido o no creíble. */
export function toAnnualUsd(s?: Salary | null): { min: number | null; max: number | null } | null {
  if (!s) return null;
  const fx = FX_TO_USD[normalizeCurrency(s.currency)];
  if (!fx) return null;
  const k = fx * PERIODS_PER_YEAR[s.period];
  let min = s.min && s.min > 0 ? Math.round(s.min * k) : null;
  let max = s.max && s.max > 0 ? Math.round(s.max * k) : null;
  if (min == null && max == null) return null;
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const ref = max ?? min!;
  if (ref < 3_000 || ref > 3_000_000) return null; // basura (0, 1, 99999999...)
  return { min, max };
}

// ---------- Parseo de sueldos escritos en texto libre ----------

const CUR = "(?:USD|EUR|GBP|CAD|AUD|MXN|BRL|US\\$|\\$|€|£)";
const NUM = "(\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:\\.\\d+)?)\\s?(k\\b)?";
const PER = "(year|yr|annum|annually|annual|month|monthly|mo|hour|hourly|hr|week)\\b";

// "$80k - $100k", "USD 5,000 – 7,000 per month"
const RANGE_RE = new RegExp(
  `(${CUR})\\s?${NUM}\\s*(?:-|–|—|to)\\s*(?:${CUR}\\s?)?${NUM}` +
    // "$5-10M" (financiamiento): sin esto el regex retrocede y lee "$5-$1"
    `(?!\\d|\\s*(?:m\\b|mm\\b|million|billion|bn\\b|b\\b))` +
    `(?:\\s*(?:/|per\\s|a\\s)?\\s*${PER})?`,
  "i",
);
// "$50/hr", "$5,000 per month" (solo si trae periodo explícito)
const SINGLE_RE = new RegExp(`(${CUR})\\s?${NUM}\\s*(?:/|per\\s|a\\s)\\s*${PER}`, "i");

function toNumber(raw: string, k?: string): number {
  const n = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, "")) : parseFloat(raw);
  return k ? n * 1000 : n;
}

export function parseSalaryText(text = ""): Salary | null {
  const r = RANGE_RE.exec(text);
  if (r) {
    let min = toNumber(r[2], r[3]);
    const max = toNumber(r[4], r[5]);
    if (r[5] && !r[3] && min < 1000) min *= 1000; // "$80-100k"
    const period = r[6]
      ? normalizePeriod(r[6])
      : max < 300
        ? "hour"
        : max < 20_000
          ? "month"
          : "year";
    return { min, max, currency: normalizeCurrency(r[1]), period };
  }
  const s = SINGLE_RE.exec(text);
  if (s) {
    return {
      min: toNumber(s[2], s[3]),
      max: null,
      currency: normalizeCurrency(s[1]),
      period: normalizePeriod(s[4]),
    };
  }
  return null;
}

// ---------- Argumentos de usuario: "3000-6000", "3k+", "40k-80k anual" ----------

const NUM_ARG = "(\\d[\\d.,]*)\\s?(k)?";

/**
 * Extrae un rango de sueldo de un texto escrito por el usuario.
 * Por defecto los montos se interpretan como USD MENSUALES (anual si dice
 * "anual", "year", "año"...). Devuelve el rango en USD anuales + el texto restante.
 */
export function parseSalaryArg(
  input: string,
  opts: { allowBare?: boolean } = {},
): { range: AnnualRange; rest: string } | null {
  let work = input.toLowerCase().replace(/[–—]/g, "-");

  const annual = /\b(anual(?:es)?|annual|year|yr|año|ano)\b/.test(work);
  work = work
    .replace(/\b(anual(?:es)?|annual|year|yr|año|ano|mensual(?:es)?|monthly|month|mes|mo)\b/g, " ")
    .replace(/\b(usd|dolares|dólares|por|per)\b|us\$|\$|\//g, " ");

  const rangeRe = new RegExp(`(?<![\\w.])${NUM_ARG}\\s*-\\s*${NUM_ARG}(?![\\w])`);
  const plusRe = new RegExp(`(?<![\\w.])${NUM_ARG}\\s*\\+`);
  const bareRe = new RegExp(`(?<![\\w.])${NUM_ARG}(?![\\w])`);

  let min: number | null = null;
  let max: number | null = null;
  let match: RegExpExecArray | null;

  if ((match = rangeRe.exec(work))) {
    min = toNumber(match[1], match[2]);
    max = toNumber(match[3], match[4]);
    if (match[4] && !match[2] && min < 1000) min *= 1000;
  } else if ((match = plusRe.exec(work))) {
    min = toNumber(match[1], match[2]);
  } else if (opts.allowBare && (match = bareRe.exec(work))) {
    min = toNumber(match[1], match[2]);
  } else {
    return null;
  }

  if (min != null && max != null && min > max) [min, max] = [max, min];
  const k = annual ? 1 : 12;
  const rest = (work.slice(0, match.index) + " " + work.slice(match.index + match[0].length))
    .replace(/\s+/g, " ")
    .trim();

  return {
    range: {
      minAnnual: min != null ? Math.round(min * k) : null,
      maxAnnual: max != null ? Math.round(max * k) : null,
    },
    rest,
  };
}

// ---------- Formato ----------

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const usdK = (n: number) => (n >= 10_000 ? `$${Math.round(n / 1000)}k` : usd(n));
const round10 = (n: number) => Math.round(n / 10) * 10;

function rangeText(min: number | null, max: number | null, f: (n: number) => string): string {
  if (min != null && max != null) return min === max ? f(min) : `${f(min)}–${f(max)}`;
  if (min != null) return `desde ${f(min)}`;
  if (max != null) return `hasta ${f(max)}`;
  return "";
}

/** "$5,000–$7,500 USD/mes (≈ $60k–$90k/año)" a partir de USD anuales */
export function formatAnnualRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return "";
  const monthly = rangeText(
    min != null ? round10(min / 12) : null,
    max != null ? round10(max / 12) : null,
    usd,
  );
  const yearly = rangeText(min, max, usdK);
  return `${monthly} USD/mes (≈ ${yearly}/año)`;
}

/** Sueldo original tal como lo publicó la fuente: "EUR 60,000–80,000 /year" */
export function salaryTextOf(s: Salary): string {
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const body =
    s.min != null && s.max != null
      ? s.min === s.max
        ? f(s.min)
        : `${f(s.min)}–${f(s.max)}`
      : s.min != null
        ? `desde ${f(s.min)}`
        : s.max != null
          ? `hasta ${f(s.max)}`
          : "";
  return `${normalizeCurrency(s.currency)} ${body} /${s.period}`.trim();
}
