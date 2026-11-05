export type JobStatus = "new" | "saved" | "applied" | "discarded";

// Fila de la tabla `jobs` tal como la usa el bot
export type JobRow = {
  id: number;
  source: string;
  url: string;
  title: string;
  company: string;
  description: string;
  score: number;
  reason: string;
  notified: boolean;
  status: JobStatus;
  location: string | null;
  seniority: string | null;
  employment_type: string | null;
  tags: string[] | null;
  posted_at: string | null;
  created_at: string;
  salary_text: string | null;
  // Sueldo normalizado a USD anuales (para filtrar/comparar)
  salary_min_usd: number | null;
  salary_max_usd: number | null;
};
