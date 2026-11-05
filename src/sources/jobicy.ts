import { normalizePeriod } from "../salary.js";
import { type Source, UA, asList, stripHtml, toDate } from "./types.js";

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
  jobIndustry?: string[];
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
        const hasSalary = job.salaryMin != null || job.salaryMax != null;

        return {
          source: "Jobicy",
          url: job.url!,
          title: job.jobTitle!,
          company: job.companyName ?? "",
          description: stripHtml(job.jobDescription ?? job.jobExcerpt ?? ""),
          location: job.jobGeo?.trim() || undefined,
          seniority: job.jobLevel || undefined,
          employmentType: asList(job.jobType).join(", ") || undefined,
          tags: asList(job.jobIndustry),
          postedAt: toDate(job.pubDate),
          salary: hasSalary
            ? {
                min: job.salaryMin ?? null,
                max: job.salaryMax ?? null,
                currency: job.salaryCurrency ?? "USD",
                period: normalizePeriod(job.salaryPeriod),
              }
            : null,
        };
      });
  },
};
