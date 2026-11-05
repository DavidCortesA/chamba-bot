import { normalizePeriod } from "../salary.js";
import { type Source, UA, asList, stripHtml, toDate } from "./types.js";

type HimalayasJob = {
  title?: string;
  companyName?: string;
  description?: string;
  excerpt?: string;
  applicationLink?: string;
  guid?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string;
  salaryPeriod?: string;
  seniority?: string | string[];
  employmentType?: string;
  locationRestrictions?: string[];
  categories?: string[];
  pubDate?: number | string;
};

type HimalayasResponse = {
  jobs?: HimalayasJob[];
  nextCursor?: string;
};

export const himalayas: Source = {
  name: "Himalayas",

  async fetch() {
    const jobs: HimalayasJob[] = [];
    let cursor: string | undefined;
    const maxPages = 5;

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ limit: "20" });

      if (cursor) {
        params.set("cursor", cursor);
      }

      const res = await fetch(
        `https://himalayas.app/jobs/api?${params}`,
        { headers: { "User-Agent": UA } }
      );

      if (!res.ok) {
        throw new Error(`Himalayas ${res.status}`);
      }

      const data = (await res.json()) as HimalayasResponse;

      jobs.push(...(data.jobs ?? []));

      cursor = data.nextCursor;

      if (!cursor) break;
    }

    return jobs
      .filter((job) => job.title && job.applicationLink)
      .map((job) => {
        const hasSalary = job.minSalary != null || job.maxSalary != null;
        const locations = asList(job.locationRestrictions);

        return {
          source: "Himalayas",
          url: job.applicationLink!,
          title: job.title!,
          company: job.companyName ?? "",
          description: stripHtml(job.description ?? job.excerpt ?? ""),
          // Sin restricciones = abierto al mundo
          location: locations.length ? locations.join(", ") : "Worldwide",
          seniority: asList(job.seniority).join(", ") || undefined,
          employmentType: job.employmentType || undefined,
          tags: asList(job.categories),
          postedAt: toDate(job.pubDate),
          salary: hasSalary
            ? {
                min: job.minSalary ?? null,
                max: job.maxSalary ?? null,
                currency: job.currency ?? "USD",
                period: normalizePeriod(job.salaryPeriod),
              }
            : null,
        };
      });
  },
};
