import { type Source, UA, stripHtml } from "./types.js";

type JobicyJob = {
  id?: number;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobDescription?: string;
  jobExcerpt?: string;
  jobGeo?: string;
  jobLevel?: string;
  jobType?: string[];
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
  pubDate?: string;
};

type JobicyResponse = {
  jobs?: JobicyJob[];
  nextCursor?: string | null;
  success?: boolean;
  error?: string;
};

export const jobicy: Source = {
  name: "Jobicy",

  async fetch() {
    const jobs: JobicyJob[] = [];
    const params = new URLSearchParams({
      count: "100",
      industry: "engineering",
    });

    let cursor: string | null = null;
    const maxPages = 3;

    for (let page = 0; page < maxPages; page++) {
      if (cursor) {
        params.set("cursor", cursor);
      }

      const res = await fetch(
        `https://jobicy.com/api/jobs?${params}`,
        {
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
          },
        }
      );

      if (!res.ok) {
        throw new Error(`Jobicy ${res.status}`);
      }

      const data = (await res.json()) as JobicyResponse;

      if (data.success === false) {
        throw new Error(data.error ?? "Jobicy API error");
      }

      jobs.push(...(data.jobs ?? []));

      cursor = data.nextCursor ?? null;

      if (!cursor) break;
    }

    return jobs
      .filter((job) => job.jobTitle && job.url)
      .map((job) => {
        const salary =
          job.salaryMin != null
            ? `${job.salaryCurrency ?? ""} ${job.salaryMin}-${job.salaryMax ?? job.salaryMin} ${job.salaryPeriod ?? "unknown"}`
            : "Salary not disclosed";

        return {
          source: "Jobicy",
          url: job.url!,
          title: job.jobTitle!,
          company: job.companyName ?? "",
          description: [
            stripHtml(job.jobDescription ?? job.jobExcerpt ?? ""),
            `Salary: ${salary}`,
            `Location: ${job.jobGeo ?? "Not specified"}`,
            `Seniority: ${job.jobLevel ?? "Not specified"}`,
            `Employment: ${job.jobType?.join(", ") ?? "Not specified"}`,
            `Published: ${job.pubDate ?? "Not specified"}`,
            `Source: Jobicy`,
          ].join("\n"),
        };
      });
  },
};