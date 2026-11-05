import { Source, UA, stripHtml, toDate } from "./types.js";

const FEEDS = [
  "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
];

const tag = (block: string, name: string) => {
  const m = block.match(
    new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i"),
  );
  return m ? m[1].trim() : "";
};

export const wwr: Source = {
  name: "WeWorkRemotely",
  async fetch() {
    const out = [];
    for (const feed of FEEDS) {
      const res = await fetch(feed, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
      for (const it of items) {
        const raw = stripHtml(tag(it, "title")); // "Empresa: Puesto"
        const idx = raw.indexOf(":");
        const company = idx > 0 ? raw.slice(0, idx).trim() : "";
        const title = idx > 0 ? raw.slice(idx + 1).trim() : raw;
        const url = tag(it, "link") || tag(it, "guid");
        if (!url) continue;

        // El RSS trae campos extra: <region>, <country>, <skills>, <type>
        const location = [tag(it, "region"), tag(it, "country")]
          .map((s) => stripHtml(s))
          .filter(Boolean)
          .join(", ");
        const skills = stripHtml(tag(it, "skills"))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        out.push({
          source: "WeWorkRemotely",
          url,
          title,
          company,
          description: stripHtml(tag(it, "description")),
          location: location || undefined,
          employmentType: stripHtml(tag(it, "type")) || undefined,
          tags: skills,
          postedAt: toDate(tag(it, "pubDate")),
        });
      }
    }
    return out;
  },
};
