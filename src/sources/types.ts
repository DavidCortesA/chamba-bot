export type Job = {
  source: string;
  url: string;
  title: string;
  company: string;
  description: string;
};

export type Source = {
  name: string;
  fetch: () => Promise<Job[]>;
};

export const UA = "ChambaBot/1.0 (personal job alerts)";

export function stripHtml(html = ""): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}