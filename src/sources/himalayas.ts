import { type Source, UA, stripHtml } from "./types.js";

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
  seniority?: string;
  employmentType?: string;
  locationRestrictions?: string[];
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
        const salary =
          job.minSalary != null
            ? `${job.currency ?? ""} ${job.minSalary}-${job.maxSalary ?? job.minSalary} ${job.salaryPeriod ?? "annual"}`
            : "Salary not disclosed";

        const locations = job.locationRestrictions?.length
          ? job.locationRestrictions.join(", ")
          : "Worldwide";

        return {
          source: "Himalayas",
          url: job.applicationLink!,
          title: job.title!,
          company: job.companyName ?? "",
          description: [
            stripHtml(job.description ?? job.excerpt ?? ""),
            `Salary: ${salary}`,
            `Seniority: ${job.seniority ?? "Not specified"}`,
            `Employment: ${job.employmentType ?? "Not specified"}`,
            `Eligible locations: ${locations}`,
            `Source: Himalayas`,
          ].join("\n"),
        };
      });
  },
};