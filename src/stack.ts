export type StackItem = {
  name: string;
  weight: number;
  // Fuente de la RegExp (se compila con flag "i")
  pattern: string;
};

// Tu stack por defecto (lo mismo que tenías en score.ts). Se puede editar con /stack.
export const DEFAULT_STACK: StackItem[] = [
  // Frontend principal
  { name: "react", weight: 3, pattern: "\\breact\\b" },
  { name: "next.js", weight: 3, pattern: "next\\.?js" },
  { name: "typescript", weight: 2, pattern: "typescript" },
  { name: "react native", weight: 2, pattern: "react native|expo" },
  { name: "frontend", weight: 2, pattern: "front-?end" },
  // Ecosistema
  { name: "tailwind", weight: 1, pattern: "tailwind" },
  { name: "supabase", weight: 1, pattern: "supabase" },
  { name: "graphql", weight: 1, pattern: "graphql" },
  { name: "node.js", weight: 2, pattern: "\\bnode\\.?js\\b|express\\.?js|\\bnode\\b[^.\\n]{0,20}\\bexpress\\b" },
  { name: "postgresql", weight: 1, pattern: "postgres(?:ql)?" },
];

// Tecnologías que penalizan (cada entrada admite alias con "|": "vue|vuejs")
export const DEFAULT_AVOID = [
  "php",
  "java",
  ".net|asp.net|dotnet",
  "ruby",
  "django",
  "angular",
  "vue",
  "wordpress",
  "salesforce",
];

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Construye un patrón seguro a partir de uno o varios términos/alias */
export function patternFromTerms(terms: string[]): string {
  const alts = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => escapeRegExp(t).replace(/\s+/g, "[\\s-]?"));
  return `(?<![a-z0-9])(?:${alts.join("|")})(?:\\.?js)?(?![a-z0-9])`;
}

export function avoidTerms(entry: string): string[] {
  return entry.split("|").map((t) => t.trim()).filter(Boolean);
}

export function compileSafe(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

// ---------- Detección del stack que pide una vacante ----------

const TECH: [string, string][] = [
  ["JavaScript", "javascript|\\bes6\\b"],
  ["TypeScript", "typescript"],
  ["React", "\\breact(?:\\.?js)?\\b"],
  ["Next.js", "next\\.?js"],
  ["React Native", "react[ -]native"],
  ["Expo", "\\bexpo\\b"],
  ["Vue", "\\bvue(?:\\.?js)?\\b"],
  ["Angular", "\\bangular(?:js)?\\b"],
  ["Svelte", "svelte"],
  ["Node.js", "\\bnode\\.?js\\b|\\bnode\\b(?=[ ,/])"],
  ["Express", "express\\.?js|\\bexpress\\b(?=[ ,/]*(?:api|server|framework|node))"],
  ["NestJS", "nest\\.?js"],
  ["Python", "\\bpython\\b"],
  ["Django", "django"],
  ["FastAPI", "fastapi"],
  ["Flask", "\\bflask\\b"],
  ["Java", "\\bjava\\b"],
  ["Spring", "spring ?boot|spring framework"],
  ["Kotlin", "kotlin"],
  ["Swift", "\\bswift(?:ui)?\\b"],
  ["Go", "golang|\\bgo (?:developer|engineer|backend)"],
  ["Rust", "\\brust\\b"],
  ["PHP", "\\bphp\\b"],
  ["Laravel", "laravel"],
  ["Ruby", "\\bruby\\b"],
  // "rails" a secas es una palabra común ("financial rails"): exigimos contexto
  ["Rails", "ruby on rails|ruby/rails|\\brails (?:developer|engineer|app|application|backend|migration|framework|experience)"],
  ["C#", "c#|csharp"],
  [".NET", "asp\\.net|(?<![a-z0-9-])\\.net\\b|dotnet"],
  ["C++", "c\\+\\+"],
  ["Elixir", "elixir"],
  ["Scala", "\\bscala\\b"],
  ["Flutter", "flutter"],
  ["GraphQL", "graphql"],
  ["REST", "restful|\\brest(?:ful)? apis?"],
  ["SQL", "\\bsql\\b"],
  ["PostgreSQL", "postgres(?:ql)?"],
  ["MySQL", "mysql"],
  ["MongoDB", "mongo(?:db)?"],
  ["Redis", "\\bredis\\b"],
  ["Supabase", "supabase"],
  ["Firebase", "firebase"],
  ["Prisma", "prisma"],
  ["AWS", "\\baws\\b|amazon web services"],
  ["GCP", "\\bgcp\\b|google cloud"],
  ["Azure", "\\bazure\\b"],
  ["Docker", "docker"],
  ["Kubernetes", "kubernetes|\\bk8s\\b"],
  ["Terraform", "terraform"],
  ["CI/CD", "ci ?/ ?cd|\\bcicd\\b"],
  ["Linux", "\\blinux\\b"],
  ["Tailwind", "tailwind"],
  ["Sass", "\\bsass\\b|\\bscss\\b"],
  ["Redux", "redux"],
  ["Zustand", "zustand"],
  ["Jest", "\\bjest\\b"],
  ["Cypress", "cypress"],
  ["Playwright", "playwright"],
  ["Vite", "\\bvite\\b"],
  ["Webpack", "webpack"],
  ["Storybook", "storybook"],
  ["Figma", "figma"],
  ["Electron", "electron"],
  ["Kafka", "kafka"],
  ["RabbitMQ", "rabbitmq"],
  ["Stripe", "stripe"],
  ["Shopify", "shopify"],
  ["WordPress", "wordpress"],
  ["Salesforce", "salesforce"],
  ["AI/LLM", "\\bllms?\\b|openai|langchain|generative ai"],
];

const TECH_RE = TECH.map(([name, p]) => ({ name, re: new RegExp(p, "ig"), titleRe: new RegExp(p, "i") }));

/** Tecnologías mencionadas, las del título primero y luego por frecuencia */
export function detectTech(title: string, text: string, limit = 10): string[] {
  const found: { name: string; inTitle: boolean; count: number }[] = [];
  for (const t of TECH_RE) {
    t.re.lastIndex = 0;
    const count = (text.match(t.re) ?? []).length;
    const inTitle = t.titleRe.test(title);
    if (count || inTitle) found.push({ name: t.name, inTitle, count });
  }
  return found
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.count - a.count)
    .slice(0, limit)
    .map((f) => f.name);
}

/** ¿Esta tecnología detectada forma parte de TU stack (peso > 0)? */
export function inUserStack(techName: string, stack: StackItem[]): boolean {
  return stack.some((s) => {
    if (s.weight <= 0) return false;
    const re = compileSafe(s.pattern);
    return !!re && re.test(techName);
  });
}
