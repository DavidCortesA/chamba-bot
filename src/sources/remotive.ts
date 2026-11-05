import { parseSalaryText } from "../salary.js";
import { Source, UA, stripHtml, toDate } from "./types.js";

type Item = {
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  description?: string;
  tags?: string[];
  salary?: string;
  job_type?: string;
  publication_date?: string;
};

export const remotive: Source = {
  name: "Remotive",
  async fetch() {
    const res = await fetch(
      "https://remotive.com/api/remote-jobs?category=software-dev&limit=100",
      { headers: { "User-Agent": UA } },
    );
    if (!res.ok) throw new Error(`Remotive ${res.status}`);
    const data = (await res.json()) as { jobs: Item[] };
    return data.jobs.map((i) => ({
      source: "Remotive",
      url: i.url,
      title: i.title,
      company: i.company_name,
      description: stripHtml(i.description),
      location: i.candidate_required_location?.trim() || undefined,
      employmentType: i.job_type?.replace(/_/g, " ") || undefined,
      tags: i.tags ?? [],
      postedAt: toDate(i.publication_date),
      // Campo de texto libre: "$80k - $100k", "50-70 USD/hour"...
      salary: i.salary ? parseSalaryText(i.salary) : null,
    }));
  },
};
