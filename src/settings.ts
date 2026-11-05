import type { ScoreContext } from "./score.js";
import { DEFAULT_AVOID, DEFAULT_STACK, type StackItem } from "./stack.js";

export type Settings = {
  stack: StackItem[];
  avoid: string[];
  minScore: number;
  maxPerRun: number;
  // Filtro de sueldo en USD ANUALES (null = sin límite)
  minSalaryAnnual: number | null;
  maxSalaryAnnual: number | null;
  // ¿Avisar de vacantes que no publican sueldo? (solo aplica si hay filtro de sueldo)
  includeNoSalary: boolean;
  // Descartar vacantes cuyo campo "location" no es abierto a LATAM/mundo
  strictLocation: boolean;
  paused: boolean;
};

export function defaultSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    stack: DEFAULT_STACK,
    avoid: DEFAULT_AVOID,
    minScore: Number(env.MIN_SCORE ?? 5),
    maxPerRun: Number(env.MAX_PER_RUN ?? 10),
    minSalaryAnnual: null,
    maxSalaryAnnual: null,
    includeNoSalary: true,
    strictLocation: true,
    paused: false,
  };
}

/** MIN_SCORE/MAX_PER_RUN del entorno son el valor por defecto; lo guardado en la BD manda */
export function mergeSettings(overrides: Partial<Settings> | null): Settings {
  return { ...defaultSettings(), ...(overrides ?? {}) };
}

export const toScoreContext = (s: Settings): ScoreContext => ({
  stack: s.stack,
  avoid: s.avoid,
  strictLocation: s.strictLocation,
});

export const hasSalaryFilter = (s: Settings) =>
  s.minSalaryAnnual != null || s.maxSalaryAnnual != null;
