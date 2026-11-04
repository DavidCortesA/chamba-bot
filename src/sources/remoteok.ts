import { Source, UA, stripHtml } from "./types.js";

type Item = {
  url?: string;
  position?: string;
  company?: string;
  description?: string;
  tags?: string[];
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
        title: i.position!,
        company: i.company ?? "",
        description: `${(i.tags ?? []).join(" ")} ${stripHtml(i.description)}`,
      }));
  },
};