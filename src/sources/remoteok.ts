import { Source, UA, fixMojibake, stripHtml, toDate } from "./types.js";

type Item = {
  url?: string;
  position?: string;
  company?: string;
  description?: string;
  tags?: string[];
  location?: string;
  date?: string;
  salary_min?: number;
  salary_max?: number;
};

export const remoteok: Source = {
  name: "RemoteOK",
  async fetch() {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`RemoteOK ${res.status}`);
    const data = (await res.json()) as Item[];
    // El primer elemento es un aviso legal, sin "position"
    return data
      .filter((i) => i.position && i.url)
      .map((i) => ({
        source: "RemoteOK",
        url: i.url!,
        title: fixMojibake(i.position!),
        company: fixMojibake(i.company ?? ""),
        description: stripHtml(i.description),
        location: fixMojibake(i.location?.trim() ?? "") || undefined,
        tags: i.tags ?? [],
        postedAt: toDate(i.date),
        // RemoteOK publica USD anuales (0 = no disponible)
        salary:
          i.salary_min || i.salary_max
            ? {
                min: i.salary_min || null,
                max: i.salary_max || null,
                currency: "USD",
                period: "year" as const,
              }
            : null,
      }));
  },
};
