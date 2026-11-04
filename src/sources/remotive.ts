import { Source, UA, stripHtml } from "./types.js";

type Item = {
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string;
  description?: string;
  tags?: string[];
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
      description: `${i.candidate_required_location ?? ""} ${(i.tags ?? []).join(" ")} ${stripHtml(i.description)}`,
    }));
  },
};